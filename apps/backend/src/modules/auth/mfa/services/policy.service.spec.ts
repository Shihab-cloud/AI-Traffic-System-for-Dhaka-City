import { AmrEnum } from 'src/shared/enums/auth.enum';
import { MfaFactorStatusEnum, MfaFactorTypeEnum } from 'src/shared/enums/mfa.enum';

import { selectLean } from 'src/testing/db-mocks';
import { PolicyService } from './policy.service';

function build() {
  const factorModel = { find: jest.fn(), findOne: jest.fn() };
  const userModel = { findById: jest.fn() };
  return {
    factorModel,
    userModel,
    svc: new PolicyService(factorModel as never, userModel as never),
  };
}

const factors = (b: ReturnType<typeof build>, list: unknown[]) =>
  b.factorModel.find.mockReturnValue(selectLean(list));
const user = (b: ReturnType<typeof build>, doc: unknown) =>
  b.userModel.findById.mockReturnValue(selectLean(doc));

describe('PolicyService.evaluateLogin', () => {
  it('allows with PWD when the user has no active factor', async () => {
    const b = build();
    factors(b, []);
    await expect(b.svc.evaluateLogin({ userId: 'u', trustedDevice: false })).resolves.toEqual({
      kind: 'allow',
      amr: [AmrEnum.PWD],
    });
  });

  it('challenge_required listing active factors when not on a trusted device', async () => {
    const b = build();
    factors(b, [{ type: MfaFactorTypeEnum.TOTP, status: MfaFactorStatusEnum.ACTIVE }]);
    await expect(b.svc.evaluateLogin({ userId: 'u', trustedDevice: false })).resolves.toEqual({
      kind: 'challenge_required',
      availableFactors: [MfaFactorTypeEnum.TOTP],
    });
  });

  it('trusted device short-circuits an active-factor user to allow', async () => {
    const b = build();
    factors(b, [{ type: MfaFactorTypeEnum.TOTP, status: MfaFactorStatusEnum.ACTIVE }]);
    await expect(b.svc.evaluateLogin({ userId: 'u', trustedDevice: true })).resolves.toEqual({
      kind: 'allow',
      amr: [AmrEnum.PWD, AmrEnum.TRUSTED_DEVICE],
    });
  });

  it('drops EMAIL_OTP from the menu when the user has no email', async () => {
    const b = build();
    factors(b, [{ type: MfaFactorTypeEnum.EMAIL_OTP, status: MfaFactorStatusEnum.ACTIVE }]);
    user(b, { email: null });
    await expect(b.svc.evaluateLogin({ userId: 'u', trustedDevice: false })).resolves.toEqual({
      kind: 'allow',
      amr: [AmrEnum.PWD],
    });
  });

  it('keeps EMAIL_OTP when the user has an email', async () => {
    const b = build();
    factors(b, [{ type: MfaFactorTypeEnum.EMAIL_OTP, status: MfaFactorStatusEnum.ACTIVE }]);
    user(b, { email: 'u@example.com' });
    await expect(b.svc.evaluateLogin({ userId: 'u', trustedDevice: false })).resolves.toEqual({
      kind: 'challenge_required',
      availableFactors: [MfaFactorTypeEnum.EMAIL_OTP],
    });
  });

  it('ignores non-active factors', async () => {
    const b = build();
    factors(b, [{ type: MfaFactorTypeEnum.TOTP, status: MfaFactorStatusEnum.PENDING }]);
    await expect(b.svc.evaluateLogin({ userId: 'u', trustedDevice: false })).resolves.toMatchObject(
      {
        kind: 'allow',
      },
    );
  });
});

describe('PolicyService.canAnswerStepUp', () => {
  const activeFactor = (b: ReturnType<typeof build>, doc: unknown) =>
    b.factorModel.findOne.mockReturnValue(selectLean(doc));

  it('true when the user has an active factor', async () => {
    const b = build();
    activeFactor(b, { _id: 'f1' });
    await expect(b.svc.canAnswerStepUp('u')).resolves.toBe(true);
  });

  it('false for a verified email with no factor — the Email-OTP fallback is not built', async () => {
    const b = build();
    activeFactor(b, null);
    user(b, { email: 'u@example.com', emailVerified: true });
    await expect(b.svc.canAnswerStepUp('u')).resolves.toBe(false);
  });

  it('false when no active factor and email unverified', async () => {
    const b = build();
    activeFactor(b, null);
    user(b, { email: 'u@example.com', emailVerified: false });
    await expect(b.svc.canAnswerStepUp('u')).resolves.toBe(false);
  });

  it('queries only for ACTIVE factors — a PENDING enrollment cannot answer', async () => {
    const b = build();
    activeFactor(b, null);
    await b.svc.canAnswerStepUp('u');

    expect(b.factorModel.findOne).toHaveBeenCalledWith({
      userId: 'u',
      status: MfaFactorStatusEnum.ACTIVE,
    });
  });
});
