import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'mongodb';

import { UserStatusEnum } from 'src/shared/enums/status.enum';
import { verifyPassword } from 'src/utils/password.util';

import { FakeCollection, fakeConnection, leanQuery } from '../__test-utils__/fake-db';
import { RoleHierarchyPolicy } from '../rbac/role-hierarchy.policy';
import { ProvisioningService } from './provisioning.service';

// The real provider module transitively imports the ESM-only `jose` package
// (via the MFA token signer), which ts-jest cannot parse. The service only
// needs the injection token here.
jest.mock('src/lib/providers/better-auth.provider', () => ({
  BETTER_AUTH: 'BETTER_AUTH',
}));

/**
 * Regression tests for the string-vs-ObjectId mismatch on `accounts.userId`.
 *
 * better-auth stores `accounts.userId` as an ObjectId. Prior to the fix,
 * activate() and regenerateCredentials() queried it with the string user id,
 * which never matches in MongoDB:
 *   - activate() always threw 'No credential account found' — users could not
 *     replace their temp password after first login
 *   - regenerateCredentials() inserted an orphan duplicate account doc (string
 *     userId) that better-auth never reads, so the rotated temp password
 *     silently never applied
 */
describe('ProvisioningService (accounts.userId ObjectId regression)', () => {
  const userObjectId = new ObjectId();
  const userIdString = userObjectId.toHexString();

  function buildService(opts: {
    accounts: FakeCollection;
    user: Record<string, unknown> | null;
    onUserUpdate?: (filter: unknown, update: unknown) => void;
    /** Rank of the target's role; lower outranks. Defaults to below the caller. */
    targetRank?: number;
    /** Pass one in to assert the credential-change teardown fired. */
    tokenService?: { onCredentialChanged: jest.Mock };
  }) {
    const userModel = {
      findById: () => leanQuery(opts.user),
      findOne: () => leanQuery(null),
      updateOne: async (filter: unknown, update: unknown, _o?: unknown) => {
        opts.onUserUpdate?.(filter, update);
        return { matchedCount: 1, modifiedCount: 1 };
      },
    };
    const connection = fakeConnection({ accounts: opts.accounts });
    const betterAuth = { auth: { api: { sendVerificationEmail: async () => {} } } };
    const queue = { add: async () => {} };
    const configService = { get: () => undefined };

    // The real policy, against a stub target. Passing a no-op here would let
    // the privilege gate be deleted from `regenerateCredentials` with every
    // test in this file still green.
    const policyRoleModel = {
      findById: () => leanQuery({ rank: CALLER_RANK }),
    };
    const policyUserModel = {
      findById: () => ({
        populate: () => ({
          lean: async () => ({ role: { rank: opts.targetRank ?? CALLER_RANK + 10 } }),
        }),
      }),
    };
    const hierarchy = new RoleHierarchyPolicy(policyRoleModel as never, policyUserModel as never);

    const tokenService = opts.tokenService ?? {
      onCredentialChanged: jest.fn(async () => undefined),
    };

    return new ProvisioningService(
      userModel as never,
      connection as never,
      betterAuth as never,
      queue as never,
      configService as never,
      hierarchy,
      tokenService as never,
    );
  }

  const CALLER_RANK = 10;
  const caller = {
    id: 'caller-1',
    role: { id: 'r-caller', permissions: [], rank: CALLER_RANK },
  } as never;

  describe('activate()', () => {
    const caller = { id: userIdString, activation_required: true } as never;

    it('revokes what the temp password authorised', async () => {
      // An intercepted temp password may already have opened a session or
      // marked a device trusted; choosing a real password has to end both.
      const accounts = new FakeCollection();
      await accounts.insertOne({
        accountId: userIdString,
        providerId: 'credential',
        userId: userObjectId,
        password: 'temp-hash',
      });
      const tokenService = { onCredentialChanged: jest.fn(async () => undefined) };
      const service = buildService({
        accounts,
        user: { _id: userObjectId, email: 'u@example.com', mustResetPassword: true },
        tokenService,
      });

      await service.activate(caller, { newPassword: 'Chosen-Passw0rd!' });

      expect(tokenService.onCredentialChanged).toHaveBeenCalledWith(userIdString);
    });

    it('finds the credential account stored with an ObjectId userId and replaces the temp password', async () => {
      const accounts = new FakeCollection();
      await accounts.insertOne({
        accountId: userIdString,
        providerId: 'credential',
        userId: userObjectId, // how better-auth actually stores it
        password: 'old-temp-hash',
      });

      const service = buildService({
        accounts,
        user: {
          email: 'user@example.com',
          emailVerified: true,
          mustResetPassword: true,
          status: UserStatusEnum.ACTIVE,
        },
      });

      const result = await service.activate(caller, { newPassword: 'N3w-Passw0rd!' });

      expect(result).toEqual({ ok: true });
      const doc = accounts.docs[0] as { password: string };
      expect(doc.password).not.toBe('old-temp-hash');
      await expect(verifyPassword('N3w-Passw0rd!', doc.password)).resolves.toBe(true);
    });

    it('still rejects when no credential account exists at all', async () => {
      const service = buildService({
        accounts: new FakeCollection(),
        user: {
          email: 'user@example.com',
          emailVerified: true,
          mustResetPassword: true,
          status: UserStatusEnum.ACTIVE,
        },
      });

      await expect(service.activate(caller, { newPassword: 'N3w-Passw0rd!' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('regenerateCredentials()', () => {
    it('refuses a target the caller does not outrank', async () => {
      // The route returns the new plaintext password, so without this any
      // UPDATE:USER holder could rotate a superior's credential and read it.
      const service = buildService({
        accounts: new FakeCollection(),
        user: { _id: userObjectId, email: null, mustResetPassword: true },
        targetRank: CALLER_RANK - 1,
      });

      await expect(service.regenerateCredentials(userIdString, caller)).rejects.toThrow(
        /equal or higher rank/,
      );
    });

    it('updates the existing ObjectId-keyed credential account in place — no orphan duplicate', async () => {
      const accounts = new FakeCollection();
      await accounts.insertOne({
        accountId: userIdString,
        providerId: 'credential',
        userId: userObjectId,
        password: 'old-temp-hash',
      });

      const service = buildService({
        accounts,
        user: { email: null, mustResetPassword: true },
      });

      const { tempPassword } = await service.regenerateCredentials(userIdString, caller);

      // Pre-fix behavior: findOne missed → a second doc with a string userId
      // was inserted; better-auth kept reading the old one, so the new temp
      // password never worked.
      expect(accounts.docs).toHaveLength(1);
      const doc = accounts.docs[0] as { userId: unknown; password: string };
      expect(doc.userId).toBeInstanceOf(ObjectId);
      await expect(verifyPassword(tempPassword, doc.password)).resolves.toBe(true);
    });

    it('inserts the credential account with an ObjectId userId when none exists', async () => {
      const accounts = new FakeCollection();
      const service = buildService({
        accounts,
        user: { email: null, mustResetPassword: true },
      });

      const { tempPassword } = await service.regenerateCredentials(userIdString, caller);

      expect(accounts.docs).toHaveLength(1);
      const doc = accounts.docs[0] as { userId: unknown; accountId: unknown; password: string };
      // userId is a reference field → ObjectId; accountId is not → stays a string.
      expect(doc.userId).toBeInstanceOf(ObjectId);
      expect((doc.userId as ObjectId).equals(userObjectId)).toBe(true);
      expect(doc.accountId).toBe(userIdString);
      await expect(verifyPassword(tempPassword, doc.password)).resolves.toBe(true);
    });
  });
});
