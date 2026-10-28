import { ObjectId } from 'mongodb';

import { UserStatusEnum } from 'src/shared/enums/status.enum';

import { FakeCollection, fakeConnection } from '../__test-utils__/fake-db';
import { TokenService } from './token.service';

/**
 * Invite tokens are bound to a purpose claim and to the address they were
 * mailed to.
 *
 * Without the purpose claim, any token signed with `RESET_TOKEN_SECRET` is
 * redeemable as an invite for whatever `sub` it carries. Without the email
 * binding, an invite stays live after an admin corrects a typo'd address, so
 * whoever received the original mail can activate an account now pointed at
 * someone else.
 */
describe('TokenService — invite token binding', () => {
  const userObjectId = new ObjectId();
  const userIdString = userObjectId.toHexString();
  const invitedEmail = 'invited@example.com';

  function buildService(opts: {
    payload: Record<string, unknown>;
    userEmail?: string | null;
    status?: UserStatusEnum;
  }) {
    const user = {
      _id: userObjectId,
      id: userIdString,
      email: opts.userEmail === undefined ? invitedEmail : opts.userEmail,
      emailVerified: false,
      status: opts.status ?? UserStatusEnum.PASSWORD_MISSING,
      save: async function () {
        return this;
      },
    };

    const service = new TokenService(
      {} as never,
      { findById: async () => user } as never,
      fakeConnection({ accounts: new FakeCollection() }) as never,
      { verifyAsync: async () => opts.payload } as never,
      { get: () => 'test-secret' } as never,
      { get: () => ({}) } as never,
    );

    return { service, user };
  }

  const validPayload = { sub: userIdString, email: invitedEmail, typ: 'invite' };

  it('accepts an invite whose email still matches the account', async () => {
    const { service, user } = buildService({ payload: validPayload });

    await expect(service.acceptInvite('tok', 'N3w-Passw0rd!')).resolves.toEqual({
      message: 'Account activated successfully',
    });
    expect(user.status).toBe(UserStatusEnum.ACTIVE);
  });

  it('marks the address verified — redeeming the invite proves control of it', async () => {
    const { service, user } = buildService({ payload: validPayload });

    await service.acceptInvite('tok', 'N3w-Passw0rd!');

    expect(user.emailVerified).toBe(true);
  });

  it('rejects an invite after the address was changed', async () => {
    const { service } = buildService({
      payload: validPayload,
      userEmail: 'corrected@example.com',
    });

    await expect(service.acceptInvite('tok', 'N3w-Passw0rd!')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects an invite for an account that has no address at all', async () => {
    const { service } = buildService({ payload: validPayload, userEmail: null });

    await expect(service.acceptInvite('tok', 'N3w-Passw0rd!')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects a validly-signed token that is not an invite', async () => {
    // Same secret, same subject, different purpose — e.g. a reset token.
    const { service } = buildService({
      payload: { sub: userIdString, email: invitedEmail, typ: 'reset' },
    });

    await expect(service.acceptInvite('tok', 'N3w-Passw0rd!')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects a token carrying no purpose claim', async () => {
    const { service } = buildService({
      payload: { sub: userIdString, email: invitedEmail },
    });

    await expect(service.acceptInvite('tok', 'N3w-Passw0rd!')).rejects.toMatchObject({
      status: 400,
    });
  });
});
