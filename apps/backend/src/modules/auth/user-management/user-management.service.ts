import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CurrentUser } from 'src/lib/decorators/user.decorator';
import { LoggerService } from 'src/lib/logger/logger.service';
import { Role, RoleModel } from 'src/schemas/public/role.schema';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { PaginationQueryDto } from 'src/shared/dtos/query.dto';
import { MfaFactorStatusEnum } from 'src/shared/enums/mfa.enum';
import { NotificationChannelEnum } from 'src/shared/enums/notification-channel.enum';
import { UserStatusEnum } from 'src/shared/enums/status.enum';
import { MongoQueryBuilder } from 'src/utils/mongo-query-builder';
import { generateTempPassword, hashPassword } from 'src/utils/password.util';
import { UserCreateRequest, UserUpdateRequest } from '../../../lib/dto/request/user-management.req';
import { MailService } from '../../mail/mail.service';
import { NotificationService } from '../../notification/notification.service';
import { MfaService } from '../mfa/services/mfa.service';
import { RoleHierarchyPolicy } from '../rbac/role-hierarchy.policy';
import { RbacService } from '../rbac/rbac.service';
import { TokenService } from '../token/token.service';

@Injectable()
export class UserManagementService {
  private readonly context = UserManagementService.name;

  constructor(
    @InjectModel(User.name) private userModel: UserModel,
    @InjectModel(Role.name) private roleModel: RoleModel,
    private readonly mailService: MailService,
    private readonly tokenService: TokenService,
    private readonly rbacService: RbacService,
    private readonly hierarchy: RoleHierarchyPolicy,
    private readonly notificationService: NotificationService,
    private readonly logger: LoggerService,
    private readonly mfaService: MfaService,
  ) {}

  private async notifyUser(
    userId: string,
    title: string,
    message: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.notificationService.publishNotification({
        channel: NotificationChannelEnum.TO_USER,
        payload: { userId, title, message, metadata },
        overrides: { email: true, push: true },
      });
    } catch (err) {
      this.logger.error(
        'Failed to publish user-management notification',
        err instanceof Error ? err.stack : String(err),
        this.context,
        { userId, title },
      );
    }
  }

  private async assertUsernameAvailable(username: string, excludeUserId?: string): Promise<void> {
    // Query with the SAME collation as the unique index (strength:2 = case- and
    // accent-insensitive) so this pre-check catches `Alice` vs `alice` exactly
    // as the index would on insert — otherwise the index throws a raw E11000.
    const taken = await this.userModel
      .findOne({
        username,
        ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {}),
      })
      .collation({ locale: 'en', strength: 2 });
    if (!taken) return;
    throw new HttpException(
      { error: 'USERNAME_TAKEN', message: 'Username already in use' },
      HttpStatus.CONFLICT,
    );
  }

  async createUser(createUserDto: UserCreateRequest, accountMaker: CurrentUser) {
    if (createUserDto.email && (await this.userModel.isEmailTaken(createUserDto.email))) {
      throw new HttpException({ message: 'Email already in use' }, HttpStatus.CONFLICT);
    }

    if (createUserDto.username !== undefined) {
      await this.assertUsernameAvailable(createUserDto.username);
    }

    // The requested role must be strictly weaker than the caller's own —
    // otherwise `CREATE:USER` alone is enough to mint an admin account and
    // sign in as it.
    await this.hierarchy.assertOutranksRole(accountMaker, createUserDto.roleId);

    const user = await this.userModel.create({
      firstName: createUserDto.firstName,
      lastName: createUserDto.lastName,
      name: `${createUserDto.firstName} ${createUserDto.lastName}`,
      // OMIT the email key for emailless users — never write `null`. The partial
      // unique index on `email` only exempts missing keys / non-strings, so a
      // stored `null` would collide with other emailless users.
      ...(createUserDto.email ? { email: createUserDto.email } : {}),
      username: createUserDto.username,
      displayUsername: createUserDto.displayUsername,
      password: createUserDto.password,
      roleId: createUserDto.roleId,
      status: createUserDto.password ? UserStatusEnum.ACTIVE : UserStatusEnum.PASSWORD_MISSING,
    });

    // Admin-created users with a password get a credential written to
    // better-auth's `accounts` collection (providerId:'credential') so BA can
    // authenticate them. `user.password` is already bcrypt-hashed by the
    // schema pre-save hook (same util BA's password.verify uses).
    if (createUserDto.password && user.password) {
      await this.tokenService.writeCredentialAccount(String(user.id), user.password);
    }

    if (createUserDto.password && createUserDto.sendWelcomeEmail && user.email) {
      await this.mailService.sendWelcomeEmail(user.email, user.fullName, createUserDto.password);
    }

    if (!createUserDto.password && user.email && accountMaker.email) {
      const token = await this.tokenService.getFirstLoginInviteToken(String(user.id), user.email);
      await this.mailService.sendFirstLoginInvite(user.email, token, accountMaker.email);
    }

    this.logger.log(`User successfully created with ID: ${user.id}`, this.context, {
      userId: user.id,
      email: user.email,
    });

    return user;
  }

  /**
   * Bootstrap the first administrator.
   *
   * The password is generated and returned to the caller exactly once — it is
   * hashed on write and never recoverable afterwards.
   */
  async createAdmin() {
    const email = 'admin@localhost.com';

    if (await this.userModel.isEmailTaken(email)) {
      throw new HttpException('Admin user with default email already exists', HttpStatus.CONFLICT);
    }

    const adminRole = await this.rbacService.findOrCreateAdminRole();
    const password = generateTempPassword();

    const user = await this.userModel.create({
      email,
      password,
      firstName: 'Admin',
      lastName: 'User',
      name: 'Admin User',
      // Mongoose 9's `create()` typing no longer accepts a whole document for an
      // ObjectId path — pass the id itself (same runtime value after casting).
      roleId: adminRole._id,
      status: UserStatusEnum.ACTIVE,
    });

    // Mirror createUser: write the bcrypt-hashed credential to better-auth's
    // accounts collection so the seeded admin can authenticate via better-auth.
    if (user.password) {
      await this.tokenService.writeCredentialAccount(String(user._id), user.password);
    }

    this.logger.log(`Bootstrap admin created with ID: ${user.id}`, this.context, {
      userId: user.id,
      email: user.email,
    });

    // Plaintext returned once, and only here. It is never stored in the clear
    // and cannot be retrieved again — the caller must capture it now and sign
    // in to change it.
    return { user, password };
  }

  async updateUser(userId: string, updateUserDto: UserUpdateRequest, caller: CurrentUser) {
    await this.hierarchy.assertOutranksUser(caller, userId);

    if (await this.userModel.isEmailTaken(updateUserDto.email, userId))
      throw new HttpException('Email address is already registered', HttpStatus.CONFLICT);

    if (updateUserDto.username !== undefined) {
      await this.assertUsernameAvailable(updateUserDto.username, userId);
    }

    const [previousUser, newRole] = await Promise.all([
      this.userModel.findById(userId).select('roleId email'),
      this.roleModel.findById(updateUserDto.roleId).select('name'),
    ]);

    // `assertOutranksUser` above checks the target's *current* role,
    // not the one being assigned — without this a manager could promote a
    // subordinate above themselves.
    await this.hierarchy.assertOutranksRole(caller, updateUserDto.roleId);

    const emailChanged = previousUser?.email !== updateUserDto.email;

    const user = await this.userModel.findByIdAndUpdate(
      userId,
      {
        firstName: updateUserDto.firstName,
        lastName: updateUserDto.lastName,
        name: `${updateUserDto.firstName} ${updateUserDto.lastName}`,
        email: updateUserDto.email,
        roleId: updateUserDto.roleId,
        // An admin correcting an address must not leave it marked verified —
        // `sendResetPassword` skips unverified addresses, and that guard is the
        // only thing keeping a reset link from reaching an address the account
        // holder does not own.
        ...(emailChanged ? { emailVerified: false } : {}),
        ...(updateUserDto.username !== undefined
          ? {
              username: updateUserDto.username,
              displayUsername: updateUserDto.displayUsername,
            }
          : {}),
      },
      { returnDocument: 'after' },
    );

    if (!user) throw new HttpException('User not found', HttpStatus.NOT_FOUND);

    if (previousUser && String(previousUser.roleId) !== String(user.roleId)) {
      const newRoleName = newRole?.name ?? 'a new role';

      // Revoke their sessions so the role change takes effect now:
      // `PermissionsGuard` reads permissions off the JWT, baked at mint time.
      await this.tokenService.invalidateAllUserSessions(userId);

      await this.notifyUser(
        userId,
        'Your role was changed',
        `Your role was changed to ${newRoleName}.`,
        {
          event: 'user.role.changed',
          actorId: caller.id,
          previousRoleId: String(previousUser.roleId),
          newRoleId: String(user.roleId),
        },
      );
    }

    return user;
  }

  async getUserById(userId: string) {
    const user = await this.userModel.findById(userId).populate('role');

    if (!user) throw new HttpException('User not found', HttpStatus.NOT_FOUND);

    return user;
  }

  async getUsers(query: PaginationQueryDto) {
    // Joined list (mirrors drizzle's users-JOIN-roles list): use an aggregation
    // pipeline + aggregatePaginate so the response carries the full `role`
    // object under `role` — matching drizzle's projected shape byte-for-byte.
    const pipeline = this.userModel.aggregate([
      { $match: { ...query.filter, ...MongoQueryBuilder.buildSearch(query.search, User) } },
      {
        $lookup: {
          from: 'roles',
          localField: 'roleId',
          foreignField: '_id',
          as: 'role',
        },
      },
      { $unwind: { path: '$role', preserveNullAndEmptyArrays: true } },
      // Derived `mfaEnabled` flag (mirrors drizzle's EXISTS on ACTIVE mfa
      // factors). mfa_factors.userId is stored as an ObjectId-hex STRING, while
      // users._id is an ObjectId — so stringify _id before matching. Filter to
      // ACTIVE factors only; presence of ≥1 row ⇒ mfaEnabled true.
      {
        $lookup: {
          from: 'mfa_factors',
          let: { userIdStr: { $toString: '$_id' } },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$userId', '$$userIdStr'] },
                    { $eq: ['$status', MfaFactorStatusEnum.ACTIVE] },
                  ],
                },
              },
            },
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          as: 'activeMfaFactors',
        },
      },
      { $addFields: { mfaEnabled: { $gt: [{ $size: '$activeMfaFactors' }, 0] } } },
      { $project: { activeMfaFactors: 0 } },
      { $sort: query.sortBy ?? { createdAt: -1 } },
    ]);

    return this.userModel.aggregatePaginate(pipeline, {
      page: query.page,
      limit: query.limit,
    });
  }

  async revokeSessions(targetUserId: string, caller: CurrentUser) {
    await this.hierarchy.assertOutranksUser(caller, targetUserId);

    const result = await this.revokeSessionsInternal(targetUserId);

    await this.notifyUser(
      targetUserId,
      'All sessions revoked',
      `All of your active sessions were revoked. You'll need to sign in again.`,
      { event: 'user.sessions.revoked', actorId: caller.id },
    );

    return result;
  }

  /**
   * Remove every MFA factor from another user's account.
   *
   * The recovery path for a lost authenticator. Without it the user is locked
   * out permanently: backup codes cannot answer a login challenge, `/mfa/disable`
   * requires the factor they no longer have, and resetting their password leaves
   * the same challenge in front of them.
   *
   * Guarded by `UPDATE:USER`, a rank check, and a step-up challenge — the acting
   * admin proves possession of their own second factor before removing someone
   * else's.
   */
  async resetMfa(targetUserId: string, caller: CurrentUser) {
    await this.hierarchy.assertOutranksUser(caller, targetUserId);

    const user = await this.userModel.findById(targetUserId).select('_id').lean();
    if (!user) throw new HttpException('User not found', HttpStatus.NOT_FOUND);

    await this.mfaService.adminResetMfa({
      userId: targetUserId,
      actorId: caller.id,
    });

    this.logger.log(`MFA reset for user ${targetUserId} by ${caller.id}`, this.context, {
      userId: targetUserId,
      actorId: caller.id,
    });
  }

  private async revokeSessionsInternal(targetUserId: string) {
    const user = await this.userModel.findById(targetUserId);

    if (!user) throw new HttpException('User not found', HttpStatus.NOT_FOUND);

    await this.tokenService.invalidateAllUserSessions(targetUserId);

    this.logger.log(`Revoked all sessions for user ${targetUserId}`, this.context);

    return { revoked: true };
  }

  async deleteUser(userId: string, caller: CurrentUser) {
    await this.hierarchy.assertOutranksUser(caller, userId);

    await this.revokeSessionsInternal(userId);

    const user = await this.userModel.findByIdAndDelete(userId);

    if (!user) throw new HttpException('User not found', HttpStatus.NOT_FOUND);

    return user;
  }

  async banUser(userId: string, caller: CurrentUser) {
    await this.hierarchy.assertOutranksUser(caller, userId);

    const user = await this.userModel.findById(userId);
    if (!user) throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    if (user.status === UserStatusEnum.BANNED)
      throw new HttpException('User is already banned', HttpStatus.BAD_REQUEST);

    const updated = await this.userModel.findByIdAndUpdate(
      userId,
      { status: UserStatusEnum.BANNED },
      { returnDocument: 'after' },
    );

    // Notify before revoking sessions. Push is delivered via FCM device tokens,
    // not session state, so the ordering does not affect deliverability — but
    // it documents the intent: tell the user before logging them out.
    await this.notifyUser(
      userId,
      'Your account was suspended',
      `Your account has been suspended. Contact support if you believe this is an error.`,
      { event: 'user.banned', actorId: caller.id },
    );

    await this.revokeSessionsInternal(userId);

    this.logger.log(`User ${userId} has been banned`, this.context);
    return updated;
  }

  async unbanUser(userId: string, caller: CurrentUser) {
    await this.hierarchy.assertOutranksUser(caller, userId);

    const user = await this.userModel.findById(userId);
    if (!user) throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    if (user.status !== UserStatusEnum.BANNED)
      throw new HttpException('User is not banned', HttpStatus.BAD_REQUEST);

    const updated = await this.userModel.findByIdAndUpdate(
      userId,
      { status: UserStatusEnum.ACTIVE },
      { returnDocument: 'after' },
    );

    await this.notifyUser(
      userId,
      'Your account has been restored',
      `Access to your account has been restored.`,
      { event: 'user.unbanned', actorId: caller.id },
    );

    this.logger.log(`User ${userId} has been unbanned`, this.context);
    return updated;
  }

  /**
   * Issues a fresh temp password for a target user and forces re-activation.
   *
   * Intended for emailless users (no deliverable address) whose admin needs to
   * hand out credentials offline. Also usable as a break-glass reset for any
   * lower-ranked user who's locked out.
   *
   * Flow:
   *   1. Rank guard — caller must outrank target.
   *   2. Generate plaintext temp password (unambiguous alphabet, length 12).
   *   3. Hash + write to the user record. The plaintext is NEVER persisted; it
   *      leaves this method exactly once via the return value.
   *   4. Set `mustResetPassword = true` so the next login forces a new password.
   *   5. Revoke all existing sessions so any active client must re-auth.
   */
  async resetCredentials(targetUserId: string, caller: CurrentUser) {
    await this.hierarchy.assertOutranksUser(caller, targetUserId);

    const user = await this.userModel.findById(targetUserId);

    if (!user) throw new HttpException('User not found', HttpStatus.NOT_FOUND);

    const tempPassword = generateTempPassword();
    const hashed = await hashPassword(tempPassword);

    await this.userModel.findByIdAndUpdate(targetUserId, {
      password: hashed,
      mustResetPassword: true,
    });

    // Keep better-auth's credential account in sync so the user can sign in
    // with the new temp password via better-auth.
    await this.tokenService.updateCredentialPassword(targetUserId, hashed);

    await this.notifyUser(
      targetUserId,
      'Your credentials were reset',
      // Never says the password was emailed — it is not. `resetCredentials`
      // returns it to the calling admin once, in a dialog that warns it will
      // not be shown again, and no mail carries it. A body promising an email
      // the user will never receive strands them with nobody holding the
      // password, and the flow exists for emailless users in the first place.
      `Your password was reset. The administrator who reset it has your temporary password — ask them for it, then choose a new one when you sign in.`,
      { event: 'user.credentials.reset', actorId: caller.id },
    );

    // No explicit session revoke: `updateCredentialPassword` already revokes
    // sessions and device trust, because every path that changes a credential
    // has to. Calling it again here would only write a second blocklist row.

    this.logger.log(
      `Reset credentials for user ${targetUserId} (issued by ${caller.id})`,
      this.context,
    );

    return { tempPassword };
  }
}
