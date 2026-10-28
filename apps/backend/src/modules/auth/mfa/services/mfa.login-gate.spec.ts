import { APIError } from 'better-auth/api';

import { AmrEnum } from 'src/shared/enums/auth.enum';
import {
  MfaAuditEventEnum,
  MfaFactorStatusEnum,
  MfaFactorTypeEnum,
} from 'src/shared/enums/mfa.enum';
import { MfaService } from './mfa.service';

/**
 * Covers the login gate's trusted-device branch and the password-change hook.
 *
 * `MfaService` takes 16 constructor arguments, almost none of which this gate
 * touches, so it is built directly with stubs rather than through a Nest
 * testing module — the alternative is ~200 lines of provider wiring to exercise
 * two branches.
 */

interface Stubs {
  factors: { type: MfaFactorTypeEnum; status: MfaFactorStatusEnum }[];
  proof: { amr: AmrEnum[]; mfa_at: number } | null;
  trusted: { deviceId: string } | null;
}

function build(overrides: Partial<Stubs> = {}) {
  const stubs: Stubs = {
    factors: [],
    proof: null,
    trusted: null,
    ...overrides,
  };

  const setPending = jest.fn(async () => undefined);
  const mintAttempt = jest.fn(async () => 'attempt-token-1');
  const revokeAll = jest.fn(async () => undefined);
  const auditCreate = jest.fn(async () => undefined);
  const isTrusted = jest.fn(async () => stubs.trusted);

  const factorModel = {
    find: () => ({
      select: () => ({
        lean: async () => stubs.factors.map((f, i) => ({ _id: `f${i}`, ...f, isPreferred: false })),
      }),
    }),
  };

  const service = new MfaService(
    factorModel as never,
    {} as never, // secretModel
    {} as never, // challengeModel
    {} as never, // backupCodeModel
    { create: auditCreate } as never, // auditModel
    {} as never, // userModel
    [], // adapters
    { isTrusted, revokeAll } as never,
    {} as never, // recovery
    { consumeProof: async () => stubs.proof, mintAttempt } as never,
    { setPending } as never,
    {
      // Mirrors the real PolicyService: MFA is opt-in, trust skips the
      // challenge, an active factor otherwise means challenge_required.
      evaluateLogin: async ({ trustedDevice }: { trustedDevice: boolean }) => {
        const active = stubs.factors
          .filter((f) => f.status === MfaFactorStatusEnum.ACTIVE)
          .map((f) => f.type);
        if (active.length === 0) return { kind: 'allow', amr: [AmrEnum.PWD] };
        if (trustedDevice) {
          return { kind: 'allow', amr: [AmrEnum.PWD, AmrEnum.TRUSTED_DEVICE] };
        }
        return { kind: 'challenge_required', availableFactors: active };
      },
    } as never,
    { get: () => '2099-01-01' } as never, // config — grace deadline far future
    {} as never, // notificationService
    {} as never, // tokenService
    {} as never, // systemSettings
  );

  return { service, setPending, mintAttempt, revokeAll, auditCreate, isTrusted };
}

const session = { userId: 'u-1', ipAddress: '203.0.113.9', userAgent: 'UA/1.0' };

function requestWithCookie(value?: string): Request {
  return {
    headers: { get: (k: string) => (k === 'cookie' && value ? value : null) },
  } as unknown as Request;
}

describe('MfaService.onLoginSessionCreating — trusted device', () => {
  const activeTotp = [{ type: MfaFactorTypeEnum.TOTP, status: MfaFactorStatusEnum.ACTIVE }];

  it('skips the challenge and grants AAL2 when the device is trusted', async () => {
    const { service, setPending, mintAttempt } = build({
      factors: activeTotp,
      trusted: { deviceId: 'd-1' },
    });

    await service.onLoginSessionCreating!({
      session,
      request: requestWithCookie('mfa.trusted_device=signed-value'),
    });

    expect(mintAttempt).not.toHaveBeenCalled();
    expect(setPending).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({ aal: 2, amr: [AmrEnum.PWD, AmrEnum.TRUSTED_DEVICE] }),
    );
  });

  it('passes the cookie value off the raw request to the trusted-device check', async () => {
    const { service, isTrusted } = build({ factors: activeTotp, trusted: { deviceId: 'd-1' } });

    await service.onLoginSessionCreating!({
      session,
      request: requestWithCookie('other=x; mfa.trusted_device=signed-value; more=y'),
    });

    expect(isTrusted).toHaveBeenCalledWith(
      expect.objectContaining({ cookieValue: 'signed-value', userId: 'u-1' }),
    );
  });

  it('still challenges when the cookie is absent', async () => {
    const { service, mintAttempt } = build({ factors: activeTotp, trusted: null });

    await expect(
      service.onLoginSessionCreating!({ session, request: requestWithCookie() }),
    ).rejects.toBeInstanceOf(APIError);
    expect(mintAttempt).toHaveBeenCalled();
  });

  it('still challenges when the cookie is present but the device is not trusted', async () => {
    // Revoked, expired, or fingerprint-mismatched — isTrusted returns null and
    // the presence of a cookie must not by itself skip anything.
    const { service, mintAttempt } = build({ factors: activeTotp, trusted: null });

    await expect(
      service.onLoginSessionCreating!({
        session,
        request: requestWithCookie('mfa.trusted_device=stale-value'),
      }),
    ).rejects.toBeInstanceOf(APIError);
    expect(mintAttempt).toHaveBeenCalled();
  });

  it('does not run without a request — no request means no cookie, so no trust', async () => {
    const { service, mintAttempt } = build({ factors: activeTotp, trusted: null });

    await expect(
      service.onLoginSessionCreating!({ session, request: undefined }),
    ).rejects.toBeInstanceOf(APIError);
    expect(mintAttempt).toHaveBeenCalled();
  });

  it('allows at AAL1 when the user has no active factor', async () => {
    const { service, setPending } = build({ factors: [], trusted: null });

    await service.onLoginSessionCreating!({ session, request: requestWithCookie() });

    expect(setPending).toHaveBeenCalledWith('u-1', { aal: 1, amr: [AmrEnum.PWD] });
  });

  it('a consumed proof still wins over everything — that is the just-verified path', async () => {
    const { service, setPending, isTrusted } = build({
      factors: activeTotp,
      proof: { amr: [AmrEnum.TOTP], mfa_at: 1700000000 },
    });

    await service.onLoginSessionCreating!({ session, request: requestWithCookie() });

    expect(isTrusted).not.toHaveBeenCalled();
    expect(setPending).toHaveBeenCalledWith('u-1', {
      aal: 2,
      amr: [AmrEnum.TOTP],
      mfa_at: 1700000000,
    });
  });
});

describe('MfaService.onPasswordChanged', () => {
  it('revokes every trusted device so a reset evicts an intruder', async () => {
    const { service, revokeAll } = build();

    await service.onPasswordChanged!({ userId: 'u-1' });

    expect(revokeAll).toHaveBeenCalledWith('u-1');
  });

  it('writes an audit row naming the reason', async () => {
    const { service, auditCreate } = build();

    await service.onPasswordChanged!({ userId: 'u-1' });

    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-1',
        event: MfaAuditEventEnum.TRUST_DEVICE_REVOKED,
        metadata: { reason: 'password_changed', scope: 'all' },
      }),
    );
  });
});
