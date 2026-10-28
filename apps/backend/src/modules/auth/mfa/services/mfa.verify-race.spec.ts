import {
  MfaChallengePurposeEnum,
  MfaFactorStatusEnum,
  MfaFactorTypeEnum,
} from 'src/shared/enums/mfa.enum';
import { MfaService } from './mfa.service';

/**
 * Concurrency guards on challenge verification.
 *
 * Both were read-modify-write:
 *
 *  - `attemptsRemaining` was read, the code verified, then the decremented
 *    value written back. N requests fired at once all read the same starting
 *    value, so the 5-attempt cap became "5 per round trip" — enough concurrency
 *    turned it into effectively unlimited guessing.
 *  - The challenge was deleted on success without checking the delete won, so
 *    two requests carrying the same correct code both succeeded and one code
 *    produced two proofs.
 */

interface Challenge {
  _id: string;
  userId: string;
  purpose: MfaChallengePurposeEnum;
  factorType: MfaFactorTypeEnum;
  attemptsRemaining: number;
  expiresAt: Date;
  scope?: string | null;
  context?: unknown;
  payloadSalt?: string | null;
  payloadHash?: string | null;
}

function build(opts: {
  challenge: Challenge | null;
  codeIsValid: boolean;
  /** Seconds remaining on a per-user lockout, when one is in force. */
  lockedFor?: number;
}) {
  // One mutable row, so the atomic-claim filter is exercised against real state
  // rather than a fixed stub.
  let row: Challenge | null = opts.challenge ? { ...opts.challenge } : null;

  const findOneAndUpdate = jest.fn(
    (filter: { attemptsRemaining?: { $gt: number }; expiresAt?: { $gt: Date } }) => ({
      lean: async () => {
        if (!row) return null;
        if (filter.attemptsRemaining && row.attemptsRemaining <= filter.attemptsRemaining.$gt) {
          return null;
        }
        if (filter.expiresAt && row.expiresAt <= filter.expiresAt.$gt) return null;
        row = { ...row, attemptsRemaining: row.attemptsRemaining - 1 };
        return { ...row };
      },
    }),
  );

  const deleteOne = jest.fn(async () => {
    if (!row) return { deletedCount: 0 };
    row = null;
    return { deletedCount: 1 };
  });

  const challengeModel = {
    findOneAndUpdate,
    deleteOne,
    findById: () => ({
      select: () => ({ lean: async () => (row ? { ...row } : null) }),
      lean: async () => (row ? { ...row } : null),
    }),
    updateOne: jest.fn(async () => ({})),
  };

  const factorModel = {
    find: () => ({
      select: () => ({
        lean: async () => [
          {
            _id: 'f-1',
            type: MfaFactorTypeEnum.TOTP,
            status: MfaFactorStatusEnum.ACTIVE,
            createdAt: new Date(),
          },
        ],
      }),
    }),
  };

  const adapter = {
    type: MfaFactorTypeEnum.TOTP,
    verify: jest.fn(async () => opts.codeIsValid),
  };

  // Real enough to see the per-user ceiling: failures accumulate, and the
  // service is expected to consult it before touching the challenge.
  let failures = 0;
  const attempts = {
    lockoutRetryAfter: jest.fn(async () => opts.lockedFor ?? null),
    recordFailure: jest.fn(async () => ({ locked: false, failures: ++failures })),
    clearFailures: jest.fn(async () => {
      failures = 0;
    }),
  };

  const service = new MfaService(
    factorModel as never,
    {} as never,
    challengeModel as never,
    {} as never,
    { create: jest.fn() } as never,
    {} as never,
    [adapter] as never,
    {} as never,
    {} as never,
    attempts as never,
    {} as never,
    {} as never,
    { get: () => undefined } as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return {
    service,
    challengeModel,
    adapter,
    attempts,
    failureCount: () => failures,
    current: () => row,
  };
}

const challenge = (attemptsRemaining: number): Challenge => ({
  _id: 'c-1',
  userId: 'u-1',
  purpose: MfaChallengePurposeEnum.LOGIN,
  factorType: MfaFactorTypeEnum.TOTP,
  attemptsRemaining,
  expiresAt: new Date(Date.now() + 60_000),
  context: null,
});

describe('verifyChallenge — attempt claiming', () => {
  it('claims the attempt before verifying, not after', async () => {
    const { service, challengeModel, adapter } = build({
      challenge: challenge(5),
      codeIsValid: false,
    });

    await service.verifyChallenge({ challengeId: 'c-1', code: '000000' });

    // The decrement must be issued as part of the matched write, so a
    // concurrent request cannot observe the pre-decrement value.
    expect(challengeModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'c-1',
        attemptsRemaining: { $gt: 0 },
      }),
      { $inc: { attemptsRemaining: -1 } },
      expect.anything(),
    );
    expect(adapter.verify).toHaveBeenCalled();
  });

  it('spends exactly one attempt per concurrent request', async () => {
    const { service, current } = build({ challenge: challenge(5), codeIsValid: false });

    await Promise.all(
      Array.from({ length: 5 }, () =>
        service.verifyChallenge({ challengeId: 'c-1', code: '000000' }),
      ),
    );

    // Five wrong guesses exhaust a five-attempt challenge — the row is purged.
    expect(current()).toBeNull();
  });

  it('refuses a verification once the budget is gone', async () => {
    const { service, adapter } = build({ challenge: challenge(0), codeIsValid: true });

    await expect(service.verifyChallenge({ challengeId: 'c-1', code: '123456' })).resolves.toEqual({
      ok: false,
      reason: 'attempts_exhausted',
    });
    // Never even reaches the adapter — no free guess against a spent challenge.
    expect(adapter.verify).not.toHaveBeenCalled();
  });

  it('reports an expired challenge without spending an attempt', async () => {
    const expired = { ...challenge(5), expiresAt: new Date(Date.now() - 1000) };
    const { service, adapter } = build({ challenge: expired, codeIsValid: true });

    await expect(service.verifyChallenge({ challengeId: 'c-1', code: '123456' })).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(adapter.verify).not.toHaveBeenCalled();
  });

  it('reports a missing challenge', async () => {
    const { service } = build({ challenge: null, codeIsValid: true });

    await expect(service.verifyChallenge({ challengeId: 'c-1', code: '123456' })).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});

describe('verifyChallenge — single-use on success', () => {
  it('succeeds once for a correct code', async () => {
    const { service } = build({ challenge: challenge(5), codeIsValid: true });

    const result = await service.verifyChallenge({ challengeId: 'c-1', code: '123456' });

    expect(result.ok).toBe(true);
  });

  it('lets only one of two concurrent correct codes win', async () => {
    // The scenario: one phished code fired at /mfa/challenge/verify and
    // /mfa/step-up/verify at the same moment. Without the delete acting as the
    // gate, both returned ok and one code bought a login *and* a step-up token.
    const { service } = build({ challenge: challenge(5), codeIsValid: true });

    const results = await Promise.all([
      service.verifyChallenge({ challengeId: 'c-1', code: '123456' }),
      service.verifyChallenge({ challengeId: 'c-1', code: '123456' }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe('verifyChallenge — per-user ceiling', () => {
  it('refuses a locked-out user without touching the challenge', async () => {
    // The challenge cap only bounds one challenge. Without a per-user ceiling
    // a caller starts a fresh challenge after every wrong code, and the IP
    // limiter fails open whenever Redis is unreachable.
    const { service, challengeModel, adapter } = build({
      challenge: challenge(5),
      codeIsValid: true,
      lockedFor: 420,
    });

    const result = await service.verifyChallenge({ challengeId: 'c-1', code: '000000' });

    expect(result).toEqual({ ok: false, reason: 'locked_out', retryAfter: 420 });
    expect(challengeModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(adapter.verify).not.toHaveBeenCalled();
  });

  it('counts each wrong code against the user, not just the challenge', async () => {
    const { service, failureCount } = build({ challenge: challenge(5), codeIsValid: false });

    await service.verifyChallenge({ challengeId: 'c-1', code: '000000' });
    await service.verifyChallenge({ challengeId: 'c-1', code: '111111' });

    expect(failureCount()).toBe(2);
  });

  it('clears the counter on a correct code, so a typo does not accumulate forever', async () => {
    const { service, attempts } = build({ challenge: challenge(5), codeIsValid: true });

    await service.verifyChallenge({ challengeId: 'c-1', code: '123456' });

    expect(attempts.clearFailures).toHaveBeenCalledWith('u-1');
  });
});
