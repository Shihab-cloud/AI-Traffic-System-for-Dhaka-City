import { HttpException, HttpStatus } from '@nestjs/common';
import { ObjectId } from 'mongodb';

import { UserStatusEnum } from 'src/shared/enums/status.enum';

import { FakeCollection, fakeConnection } from '../__test-utils__/fake-db';
import { TokenService } from './token.service';
import { MFA_PASSWORD_CHANGE_LISTENER } from '../mfa/mfa.password-change.token';

/**
 * Regression tests for the double-activation guard in acceptInvite().
 *
 * `accounts.userId` is stored as an ObjectId. Prior to the fix the guard
 * queried it with the string `user.id` (and without a providerId filter), so
 * it never matched — an invite accepted twice inserted a duplicate credential
 * account instead of returning 409.
 */
describe('TokenService.acceptInvite (accounts.userId ObjectId regression)', () => {
  const userObjectId = new ObjectId();
  const userIdString = userObjectId.toHexString();

  function buildService(opts: { accounts: FakeCollection; userStatus: UserStatusEnum }) {
    const user = {
      _id: userObjectId,
      id: userIdString,
      // The invite token is bound to the address it was mailed to, so the user
      // row has to carry the same one for activation to be accepted.
      email: 'user@example.com',
      emailVerified: false,
      status: opts.userStatus,
      save: async function () {
        return this;
      },
    };
    const userModel = { findById: async () => user };
    const connection = fakeConnection({ accounts: opts.accounts });
    const jwtService = {
      // `typ` is asserted on verify — a token signed with the same secret for
      // some other purpose is no longer redeemable as an invite.
      verifyAsync: async () => ({ sub: userIdString, email: 'user@example.com', typ: 'invite' }),
    };
    const configService = { get: () => 'test-secret' };
    const moduleRef = { get: () => ({}) };

    const service = new TokenService(
      {} as never, // invalidatedTokenModel — unused by acceptInvite
      userModel as never,
      connection as never,
      jwtService as never,
      configService as never,
      moduleRef as never,
    );
    return { service, user };
  }

  it('lets only one of two concurrent invite redemptions create the credential', async () => {
    // Both pass every read-based guard; the unique index is the only thing
    // that decides a winner.
    const accounts = new FakeCollection([['userId', 'providerId']]);
    const { service } = buildService({ accounts, userStatus: UserStatusEnum.PASSWORD_MISSING });

    const outcomes = await Promise.allSettled([
      service.acceptInvite('token', 'Chosen-Passw0rd!'),
      service.acceptInvite('token', 'Chosen-Passw0rd!'),
    ]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(accounts.docs.filter((d) => d.providerId === 'credential')).toHaveLength(1);
  });

  it('rejects a second activation when a credential account already exists (ObjectId userId)', async () => {
    // Unique on (userId, providerId), as `TokenService.onModuleInit` creates —
    // the insert is the gate now, so the fake has to enforce it.
    const accounts = new FakeCollection([['userId', 'providerId']]);
    await accounts.insertOne({
      accountId: userIdString,
      providerId: 'credential',
      userId: userObjectId, // how better-auth / writeCredentialAccount store it
      password: 'existing-hash',
    });

    const { service } = buildService({
      accounts,
      userStatus: UserStatusEnum.PASSWORD_MISSING,
    });

    // Pre-fix behavior: guard queried with the string user.id, never matched,
    // and a duplicate credential account was inserted instead of a 409.
    await expect(service.acceptInvite('some-token', 'N3w-Passw0rd!')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
    await expect(service.acceptInvite('some-token', 'N3w-Passw0rd!')).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(accounts.docs).toHaveLength(1);
  });

  it('is not tripped by a linked social account — activation proceeds', async () => {
    const accounts = new FakeCollection();
    await accounts.insertOne({
      accountId: 'google-sub-123',
      providerId: 'google',
      userId: userObjectId,
    });

    const { service, user } = buildService({
      accounts,
      userStatus: UserStatusEnum.PASSWORD_MISSING,
    });

    await expect(service.acceptInvite('some-token', 'N3w-Passw0rd!')).resolves.toEqual({
      message: 'Account activated successfully',
    });

    const credential = accounts.docs.find((d) => d.providerId === 'credential') as {
      userId: unknown;
    };
    expect(credential).toBeDefined();
    expect(credential.userId).toBeInstanceOf(ObjectId);
    expect(user.status).toBe(UserStatusEnum.ACTIVE);
  });
});

describe('updateCredentialPassword side effects', () => {
  const userIdString = '507f1f77bcf86cd799439011';

  it('revokes sessions and device trust, which Better Auth hooks cannot do for a driver write', async () => {
    // The write goes straight to the `accounts` collection, so
    // `databaseHooks.account.update.after` never fires — a password change
    // would otherwise leave the intruder's session and trusted device alive.
    const accounts = { updateOne: jest.fn(async () => ({ matchedCount: 1 })) };
    const onPasswordChanged = jest.fn(async () => undefined);
    const invalidatedTokenModel = { create: jest.fn(async () => undefined) };
    const deleteUserSessions = jest.fn(async () => undefined);

    const service = new TokenService(
      invalidatedTokenModel as never,
      {} as never,
      { db: { collection: () => accounts } } as never,
      {} as never,
      { get: () => 'test-secret' } as never,
      {
        get: (token: unknown) =>
          token === MFA_PASSWORD_CHANGE_LISTENER
            ? { onPasswordChanged }
            : { auth: { $context: Promise.resolve({ internalAdapter: { deleteUserSessions } }) } },
      } as never,
    );

    await service.updateCredentialPassword(userIdString, 'hashed');

    expect(accounts.updateOne).toHaveBeenCalled();
    expect(deleteUserSessions).toHaveBeenCalledWith(userIdString);
    expect(invalidatedTokenModel.create).toHaveBeenCalled();
    expect(onPasswordChanged).toHaveBeenCalledWith({ userId: userIdString });
  });
});
