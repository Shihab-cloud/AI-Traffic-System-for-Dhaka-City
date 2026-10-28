import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import type { Connection } from 'mongoose';
import { BETTER_AUTH, type BetterAuthInstance } from 'src/lib/providers/better-auth.tokens';
import { InvalidatedToken, InvalidatedTokenModel } from 'src/schemas/auth/token.schema';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { UserStatusEnum } from 'src/shared/enums/status.enum';
import { hashPassword } from 'src/utils/password.util';
import {
  MFA_PASSWORD_CHANGE_LISTENER,
  type MfaPasswordChangeListener,
} from '../mfa/mfa.password-change.token';

/**
 * Purpose claim on first-login invite tokens. Asserted on verify so a token
 * signed with `RESET_TOKEN_SECRET` for some other purpose cannot be redeemed as
 * an invite.
 */
const INVITE_TOKEN_TYPE = 'invite';

@Injectable()
export class TokenService {
  constructor(
    @InjectModel(InvalidatedToken.name)
    private invalidatedTokenModel: InvalidatedTokenModel,
    @InjectModel(User.name) private userModel: UserModel,
    @InjectConnection() private connection: Connection,
    private jwtService: JwtService,
    private configService: ConfigService,
    // Resolved lazily (not a constructor dependency) to break the DI cycle:
    // BETTER_AUTH → MfaService → TokenService → BETTER_AUTH. The BETTER_AUTH
    // provider is @Global so ModuleRef can reach it with `strict: false`.
    private readonly moduleRef: ModuleRef,
  ) {}

  private get db() {
    const db = this.connection.db;
    if (!db) throw new Error('Mongoose connection is not established (connection.db is undefined)');
    return db;
  }

  /**
   * Signs a first-login invite.
   *
   * `typ: 'invite'` is asserted on verify. Without it, any token ever signed
   * with `RESET_TOKEN_SECRET` — for any purpose, now or later — was accepted as
   * an invite for whatever `sub` it carried.
   */
  async getFirstLoginInviteToken(userId: string, email: string) {
    return await this.jwtService.signAsync(
      { sub: userId, email, typ: INVITE_TOKEN_TYPE },
      {
        secret: this.configService.get('RESET_TOKEN_SECRET'),
        expiresIn: this.configService.get('RESET_TOKEN_EXPIRATION_TIME'),
      },
    );
  }

  async verifyResetPasswordToken(token: string) {
    // Type the projection: the driver's untyped collection returns `Document`,
    // whose indexed fields are `any`.
    const record = await this.db
      .collection('verifications')
      .findOne<{ expiresAt: Date | string }>({ identifier: `reset-password:${token}` });

    if (!record) {
      throw new HttpException('Invalid reset link', HttpStatus.BAD_REQUEST);
    }

    if (new Date(record.expiresAt) < new Date()) {
      throw new HttpException('Reset link has expired', HttpStatus.GONE);
    }

    return { valid: true };
  }

  async verifyInviteToken(token: string): Promise<{ sub: string; email: string }> {
    let payload: { sub: string; email: string; typ?: string; exp?: number };

    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get('RESET_TOKEN_SECRET'),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new HttpException('Invite link has expired', HttpStatus.GONE);
      }
      throw new HttpException('Invalid invite token', HttpStatus.BAD_REQUEST);
    }

    // Outside the catch: a valid signature on the wrong *kind* of token is a
    // rejection, not a verification failure, and must not be reported as an
    // expiry.
    if (payload.typ !== INVITE_TOKEN_TYPE) {
      throw new HttpException('Invalid invite token', HttpStatus.BAD_REQUEST);
    }

    return { sub: payload.sub, email: payload.email };
  }

  async acceptInvite(token: string, newPassword: string) {
    const { sub, email } = await this.verifyInviteToken(token);

    const user = await this.userModel.findById(sub);

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // The token is bound to the address it was mailed to.
    //
    // Only `sub` was checked before, so an invite stayed live after an admin
    // corrected a typo'd address — whoever received the original mail could
    // still activate the account, now pointed at someone else's address.
    if (!user.email || user.email !== email) {
      throw new HttpException(
        'This invite is no longer valid for this account',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (user.status !== UserStatusEnum.PASSWORD_MISSING) {
      throw new HttpException('Account already activated', HttpStatus.CONFLICT);
    }

    const hashedPassword = await hashPassword(newPassword);

    // The insert is the gate, not a preceding read. `accounts.userId` is an
    // ObjectId reference (query with `user._id`, not the string `user.id`), and
    // the unique index created in `onModuleInit` is what makes two concurrent
    // redemptions resolve to one winner and one 409 rather than two credential
    // rows.
    try {
      await this.db.collection('accounts').insertOne({
        accountId: String(user.id),
        providerId: 'credential',
        userId: user._id,
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (e) {
      if (isDuplicateKeyError(e)) {
        throw new HttpException('Account already activated', HttpStatus.CONFLICT);
      }
      throw e;
    }

    user.status = UserStatusEnum.ACTIVE;
    // Redeeming the invite proves control of the address it was mailed to, and
    // the token is now bound to that address — so this is the one place an
    // address becomes verified without a separate verification click.
    user.emailVerified = true;
    await user.save();

    return { message: 'Account activated successfully' };
  }

  /**
   * Writes a credential account to better-auth's `accounts` collection so BA
   * can authenticate an admin-created user (mirrors backend-drizzle's direct
   * accounts insert). `hashedPassword` must already be bcrypt-hashed (BA's
   * password.verify hook uses the same util). No-op-safe: skips if a credential
   * account already exists for the user.
   *
   * `userId` is stored as an ObjectId: better-auth's mongo adapter treats
   * reference fields (account.userId → user.id) as ObjectId and queries them as
   * such, so a string userId would never match on sign-in ("Credential account
   * not found"). `accountId` is a plain (non-reference) string and stays a string.
   */
  async writeCredentialAccount(userId: string, hashedPassword: string): Promise<void> {
    const userObjectId = new ObjectId(userId);

    const existing = await this.db
      .collection('accounts')
      .findOne({ userId: userObjectId, providerId: 'credential' });

    if (existing) return;

    await this.db.collection('accounts').insertOne({
      accountId: userId,
      providerId: 'credential',
      userId: userObjectId,
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Upserts the bcrypt-hashed password on a user's better-auth credential
   * account. Used after an admin force-resets a user's password so BA can
   * authenticate them with the new credential. Inserts the credential account
   * if none exists yet.
   */
  /**
   * Write a new credential password and tear down what the old one authorised.
   *
   * The write goes to the driver, not through Better Auth, so
   * `databaseHooks.account.update.after` does not fire — the two side effects
   * it would have triggered are therefore done here. Without them a password
   * change leaves the intruder's session, JWT and 30-day trusted-device cookie
   * all still valid, which is the one thing the user changed it to stop.
   */
  async updateCredentialPassword(userId: string, hashedPassword: string): Promise<void> {
    const result = await this.db
      .collection('accounts')
      .updateOne(
        { userId: new ObjectId(userId), providerId: 'credential' },
        { $set: { password: hashedPassword, updatedAt: new Date() } },
      );
    if (result.matchedCount === 0) {
      await this.writeCredentialAccount(userId, hashedPassword);
    }

    await this.onCredentialChanged(userId);
  }

  /**
   * Tear down everything the previous password authorised.
   *
   * Every path that rotates a credential has to do this, and they do not all
   * go through `updateCredentialPassword` — provisioning's activation writes
   * the `accounts` row inside its own transaction. Without it the session,
   * JWT and 30-day trusted-device cookie established under the old password
   * all survive the change, which is the one thing changing it is meant to stop.
   */
  async onCredentialChanged(userId: string): Promise<void> {
    await this.invalidateAllUserSessions(userId);
    await this.revokeMfaDeviceTrust(userId);
  }

  /**
   * Resolved lazily by token, like BETTER_AUTH above: MfaModule imports
   * TokenModule, so a constructor dependency would close the cycle.
   */
  private async revokeMfaDeviceTrust(userId: string): Promise<void> {
    const mfa = this.moduleRef.get<MfaPasswordChangeListener>(MFA_PASSWORD_CHANGE_LISTENER, {
      strict: false,
    });
    await mfa.onPasswordChanged({ userId });
  }

  /**
   * The bcrypt hash on a user's Better Auth credential account, or `null` when
   * they have none (social-only, or an invite not yet accepted).
   *
   * `users.password` is only a mirror and is empty for invite-flow and
   * magic-link users, so anything verifying a *current* password has to read
   * this row — otherwise those accounts appear to have no password and the
   * check gets skipped.
   */
  async getCredentialHash(userId: string): Promise<string | null> {
    const account = await this.db
      .collection<{ password?: string }>('accounts')
      .findOne({ userId: new ObjectId(userId), providerId: 'credential' });
    return account?.password ?? null;
  }

  /**
   * Revoke every session held by a batch of users.
   *
   * The per-user `deleteUserSessions` call is Better Auth's own contract and
   * stays one call per user, but the blocklist rows go in a single
   * `insertMany` — a role edit on the default role touches every signed-up
   * user, and N separate inserts is the half of the cost that is ours to fix.
   */
  async invalidateAllUserSessionsBulk(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;

    const betterAuth = this.moduleRef.get<BetterAuthInstance>(BETTER_AUTH, { strict: false });
    const ctx = await betterAuth.auth.$context;
    await Promise.all(userIds.map((id) => ctx.internalAdapter.deleteUserSessions(id)));

    const invalidatedAt = new Date();
    await this.invalidatedTokenModel.insertMany(
      userIds.map((userId) => ({ userId, invalidatedAt })),
    );
  }

  async invalidateAllUserSessions(userId: string) {
    // Delete the user's better-auth sessions so the server-side session store
    // (and any cookie-cache refresh) can no longer mint fresh JWTs. Mirrors
    // backend-drizzle's revokeSessionsInternal, which calls the same internal
    // adapter. Resolved lazily to avoid the DI cycle through BETTER_AUTH.
    const betterAuth = this.moduleRef.get<BetterAuthInstance>(BETTER_AUTH, { strict: false });
    const ctx = await betterAuth.auth.$context;
    await ctx.internalAdapter.deleteUserSessions(userId);

    // Create a record of when this user's tokens were invalidated. AuthGuard
    // rejects any JWT whose `iat` predates this row (sign-out blocklist).
    await this.invalidatedTokenModel.create({
      userId,
      invalidatedAt: new Date(),
    });
  }
}

/** Mongo's duplicate-key code, which a unique-index collision surfaces as. */
function isDuplicateKeyError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
}
