import { HttpException } from '@nestjs/common';

import { hashPassword } from 'src/utils/password.util';
import { UserService } from './user.service';

function build(opts: { storedHash?: string; credentialHash?: string | null } = {}) {
  const userDoc = {
    id: 'u-1',
    password: opts.storedHash,
    updateOne: jest.fn(async () => undefined),
  };
  const userModel = {
    findById: jest.fn(() => ({
      populate: () => ({ lean: async () => userDoc }),
      lean: async () => userDoc,
      then: (resolve: (value: unknown) => unknown) => resolve(userDoc),
    })),
    isEmailTaken: jest.fn(async () => false),
  };
  const tokenService = {
    getCredentialHash: jest.fn(async () => opts.credentialHash ?? null),
    updateCredentialPassword: jest.fn(async () => undefined),
  };
  const service = new UserService(userModel as never, tokenService as never);
  jest.spyOn(service, 'getUserById').mockResolvedValue(userDoc as never);
  return { service, tokenService, userDoc };
}

describe('UserService.updatePassword', () => {
  it('refuses an account that has no password to change', async () => {
    // Otherwise a stolen session alone mints the first password for a
    // social-only or magic-link account.
    const { service, tokenService } = build({ credentialHash: null });

    await expect(
      service.updatePassword('u-1', { oldPassword: '', newPassword: 'NewPassw0rd!' }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(tokenService.updateCredentialPassword).not.toHaveBeenCalled();
  });

  it('refuses a wrong current password', async () => {
    const { service, tokenService } = build({ credentialHash: await hashPassword('Correct1!') });

    await expect(
      service.updatePassword('u-1', {
        oldPassword: 'Wrong1!',
        newPassword: 'NewPassw0rd!',
      }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(tokenService.updateCredentialPassword).not.toHaveBeenCalled();
  });

  it('writes the credential row Better Auth reads and clears the mirror', async () => {
    const { service, tokenService, userDoc } = build({
      credentialHash: await hashPassword('Correct1!'),
    });

    await service.updatePassword('u-1', {
      oldPassword: 'Correct1!',
      newPassword: 'NewPassw0rd!',
    });

    expect(tokenService.updateCredentialPassword).toHaveBeenCalledWith('u-1', expect.any(String));
    // Both plaintext-adjacent fields go: the mirrored hash nothing reads, and
    // the admin-issued temp password that is stored in the clear.
    expect(userDoc.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ $unset: { password: 1, pendingTempPassword: 1 } }),
    );
  });
});
