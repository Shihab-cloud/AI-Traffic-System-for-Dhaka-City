import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import { MfaChallengePurposeEnum } from 'src/shared/enums/mfa.enum';

// MfaService transitively imports the ESM-only `better-auth`; the unit under
// test only needs an injected stub, so replace the module wholesale.
jest.mock('./mfa.service', () => ({ MfaService: class {} }));

import { StepUpService } from './step-up.service';

function build() {
  const tokenModel = { create: jest.fn(async () => ({})), findOneAndDelete: jest.fn() };
  const mfa = {
    startChallenge: jest.fn(async () => ({ challengeId: 'c-1' })),
    verifyChallenge: jest.fn(),
    audit: jest.fn(async () => {}),
  };
  const signer = { sign: jest.fn(async () => 'signed-token'), verify: jest.fn() };
  const policy = { canAnswerStepUp: jest.fn(async () => true) };
  const svc = new StepUpService(
    tokenModel as never,
    mfa as never,
    signer as never,
    policy as never,
  );
  return { tokenModel, svc, mfa, signer, policy };
}

describe('startGuardedChallenge', () => {
  it('401 when no sessionId', async () => {
    const { svc } = build();
    await expect(
      svc.startGuardedChallenge({ userId: 'u', sessionId: '', factorId: 'f' } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('400 when the user cannot answer step-up', async () => {
    const { svc, policy } = build();
    policy.canAnswerStepUp.mockResolvedValue(false);
    await expect(
      svc.startGuardedChallenge({ userId: 'u', sessionId: 's', factorId: 'f' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('starts the challenge when gates pass', async () => {
    const { svc, mfa } = build();
    await svc.startGuardedChallenge({
      userId: 'u',
      sessionId: 's',
      factorId: 'f',
      scope: 'role:create',
    } as never);
    expect(mfa.startChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: MfaChallengePurposeEnum.STEP_UP, sessionId: 's' }),
    );
  });
});

describe('verifyAndIssue', () => {
  const okChallenge = {
    ok: true,
    purpose: MfaChallengePurposeEnum.STEP_UP,
    scope: 'role:create',
    sessionId: 's-1',
    userId: 'u-1',
    factorType: 'totp',
  };

  it('fails when challenge verification fails', async () => {
    const { svc, mfa, tokenModel } = build();
    mfa.verifyChallenge.mockResolvedValue({ ok: false, reason: 'invalid_code' });
    await expect(
      svc.verifyAndIssue({ challengeId: 'c', code: '000', sessionId: 's-1' }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_code' });
    expect(tokenModel.create).not.toHaveBeenCalled();
  });

  it('fails with wrong_purpose when the challenge was not a step-up', async () => {
    const { svc, mfa } = build();
    mfa.verifyChallenge.mockResolvedValue({
      ...okChallenge,
      purpose: MfaChallengePurposeEnum.LOGIN,
    });
    await expect(
      svc.verifyAndIssue({ challengeId: 'c', code: '1', sessionId: 's-1' }),
    ).resolves.toEqual({ ok: false, reason: 'wrong_purpose' });
  });

  it('fails with wrong_session when the challenge session differs', async () => {
    const { svc, mfa } = build();
    mfa.verifyChallenge.mockResolvedValue({ ...okChallenge, sessionId: 's-OTHER' });
    await expect(
      svc.verifyAndIssue({ challengeId: 'c', code: '1', sessionId: 's-1' }),
    ).resolves.toEqual({ ok: false, reason: 'wrong_session' });
  });

  it('issues a signed token + persists the jti row on success', async () => {
    const { svc, mfa, signer, tokenModel } = build();
    mfa.verifyChallenge.mockResolvedValue(okChallenge);
    const res = await svc.verifyAndIssue({
      challengeId: 'c',
      code: '1',
      sessionId: 's-1',
    });
    expect(res.ok).toBe(true);
    expect(tokenModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1', sessionId: 's-1', scope: 'role:create' }),
    );
    expect(signer.sign).toHaveBeenCalled();
    expect(mfa.audit).toHaveBeenCalled();
  });
});

describe('consumeToken', () => {
  const input = {
    token: 'tok',
    expectedSub: 'u-1',
    expectedSid: 's-1',
    expectedScope: 'role:create',
    ip: null,
    userAgent: null,
  };
  const goodClaims = { sub: 'u-1', sid: 's-1', scope: 'role:create', jti: 'j-1', exp: 9999 };

  it('returns false on a bad signature and never touches the DB', async () => {
    const { svc, signer, tokenModel } = build();
    signer.verify.mockRejectedValue(new Error('bad sig'));
    expect(await svc.consumeToken(input as never)).toBe(false);
    expect(tokenModel.findOneAndDelete).not.toHaveBeenCalled();
  });

  it.each([
    ['sub', { ...goodClaims, sub: 'other' }],
    ['sid', { ...goodClaims, sid: 'other' }],
    ['scope', { ...goodClaims, scope: 'user:delete' }],
  ])('returns false when %s does not match, without DB delete', async (_label, claims) => {
    const { svc, signer, tokenModel } = build();
    signer.verify.mockResolvedValue(claims);
    expect(await svc.consumeToken(input as never)).toBe(false);
    expect(tokenModel.findOneAndDelete).not.toHaveBeenCalled();
  });

  it('returns false when the token row is already consumed (findOneAndDelete null)', async () => {
    const { svc, signer, tokenModel } = build();
    signer.verify.mockResolvedValue(goodClaims);
    tokenModel.findOneAndDelete.mockResolvedValue(null);
    expect(await svc.consumeToken(input as never)).toBe(false);
  });

  it('returns true and audits when the row is deleted', async () => {
    const { svc, signer, tokenModel, mfa } = build();
    signer.verify.mockResolvedValue(goodClaims);
    tokenModel.findOneAndDelete.mockResolvedValue({ jti: 'j-1' });
    expect(await svc.consumeToken(input as never)).toBe(true);
    expect(tokenModel.findOneAndDelete).toHaveBeenCalledWith({
      jti: 'j-1',
      userId: 'u-1',
      sessionId: 's-1',
      scope: 'role:create',
      // Expiry is part of the filter: Mongo's TTL sweep lags, so an expired
      // row can still be sitting there when a replay arrives.
      expiresAt: { $gt: expect.any(Date) },
    });
    expect(mfa.audit).toHaveBeenCalled();
  });
});
