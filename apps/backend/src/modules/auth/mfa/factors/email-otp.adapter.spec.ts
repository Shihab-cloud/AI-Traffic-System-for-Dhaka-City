import { MfaChallengePurposeEnum } from 'src/shared/enums/mfa.enum';

import { hashOtp } from '../crypto/hash';
import { EmailOtpAdapter } from './email-otp.adapter';

function build() {
  const factorModel = {
    create: jest.fn(async () => ({ _id: 'f-1' })),
    updateOne: jest.fn(async () => ({})),
  };
  const userModel = { findById: jest.fn() };
  const mail = { sendMfaCode: jest.fn(async (..._a: unknown[]) => {}) };
  return {
    factorModel,
    userModel,
    mail,
    adapter: new EmailOtpAdapter(factorModel as never, userModel as never, mail as never),
  };
}

describe('enroll', () => {
  it('creates a PENDING factor when the user has an email', async () => {
    const b = build();
    b.userModel.findById.mockReturnValue({
      select: () => ({ lean: async () => ({ email: 'u@x.com' }) }),
    });
    await expect(b.adapter.enroll('u-1')).resolves.toEqual({ factorId: 'f-1' });
    expect(b.factorModel.create).toHaveBeenCalled();
  });

  it('400 when the user has no email', async () => {
    const b = build();
    b.userModel.findById.mockReturnValue({
      select: () => ({ lean: async () => ({ email: null }) }),
    });
    await expect(b.adapter.enroll('u-1')).rejects.toMatchObject({ status: 400 });
    expect(b.factorModel.create).not.toHaveBeenCalled();
  });
});

describe('startChallenge', () => {
  const user = { id: 'u-1', email: 'u@x.com', firstName: 'Jo' };

  it('emails a 6-digit code and returns its salt/hash (never the plaintext)', async () => {
    const b = build();
    const res = await b.adapter.startChallenge({
      factorId: 'f-1',
      purpose: MfaChallengePurposeEnum.LOGIN,
      user,
    });
    expect(res.payloadSalt).toBeTruthy();
    expect(res.payloadHash).toBeTruthy();
    expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(b.mail.sendMfaCode).toHaveBeenCalledTimes(1);
    const sentCode = b.mail.sendMfaCode.mock.calls[0][1] as string;
    expect(sentCode).toMatch(/^\d{6}$/);
    expect(res.payloadHash).not.toBe(sentCode);
  });

  it('throws when the user has no email', async () => {
    const b = build();
    await expect(
      b.adapter.startChallenge({
        factorId: 'f-1',
        purpose: MfaChallengePurposeEnum.LOGIN,
        user: { id: 'u-1', email: null },
      }),
    ).rejects.toThrow(/requires a user email/);
  });
});

describe('verify', () => {
  it('accepts the correct code and touches lastUsedAt', async () => {
    const b = build();
    const { salt, hash } = hashOtp('123456');
    await expect(
      b.adapter.verify({
        factorId: 'f-1',
        userId: 'u-1',
        code: '123456',
        challenge: { payloadSalt: salt, payloadHash: hash },
      } as never),
    ).resolves.toBe(true);
    expect(b.factorModel.updateOne).toHaveBeenCalled();
  });

  it('tolerates whitespace', async () => {
    const b = build();
    const { salt, hash } = hashOtp('123456');
    await expect(
      b.adapter.verify({
        factorId: 'f-1',
        userId: 'u-1',
        code: '123 456',
        challenge: { payloadSalt: salt, payloadHash: hash },
      } as never),
    ).resolves.toBe(true);
  });

  it('rejects a wrong code without touching lastUsedAt', async () => {
    const b = build();
    const { salt, hash } = hashOtp('123456');
    await expect(
      b.adapter.verify({
        factorId: 'f-1',
        userId: 'u-1',
        code: '000000',
        challenge: { payloadSalt: salt, payloadHash: hash },
      } as never),
    ).resolves.toBe(false);
    expect(b.factorModel.updateOne).not.toHaveBeenCalled();
  });

  it('rejects a malformed shape and a missing challenge', async () => {
    const b = build();
    const { salt, hash } = hashOtp('123456');
    await expect(
      b.adapter.verify({
        factorId: 'f-1',
        userId: 'u-1',
        code: '12ab',
        challenge: { payloadSalt: salt, payloadHash: hash },
      } as never),
    ).resolves.toBe(false);
    await expect(
      b.adapter.verify({ factorId: 'f-1', userId: 'u-1', code: '123456' }),
    ).resolves.toBe(false);
  });
});
