import { createHash, randomUUID } from 'crypto';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import { MfaTrustedDevice, MfaTrustedDeviceModel } from 'src/schemas/mfa/trusted-device.schema';
import type { TrustedDeviceListItem } from 'src/lib/types/mfa.types';
import { Role } from 'src/schemas/public/role.schema';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { RoleNameEnum } from 'src/shared/enums/role-name.enum';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { TrustedDeviceTokenSigner } from '../crypto/token-signer';

const USER_TRUST_DAYS = 30;

export const TRUSTED_DEVICE_COOKIE_NAME = 'mfa.trusted_device';

/**
 * TrustedDeviceService — registers + verifies a device cookie that lets users
 * skip the LOGIN MFA challenge for a configurable period.
 *
 * Step-up always re-challenges regardless of trust. Trust never bypasses an
 * action gate — only the login challenge.
 *
 * Admins are NEVER eligible. Determined the same way as PolicyService's
 * mandatory-enrollment check.
 */
@Injectable()
export class TrustedDeviceService {
  constructor(
    @InjectModel(MfaTrustedDevice.name) private readonly model: MfaTrustedDeviceModel,
    @InjectModel(User.name) private readonly userModel: UserModel,
    private readonly signer: TrustedDeviceTokenSigner,
  ) {}

  async isEligible(userId: string): Promise<boolean> {
    const user = await this.userModel
      .findById(userId)
      .select('roleId')
      .populate<{ role: Pick<Role, 'name' | 'permissions'> | null }>({
        path: 'role',
        select: 'name permissions',
      })
      .lean();
    const role = user?.role;
    if (!role) return false;
    if (role.name.toLowerCase() === RoleNameEnum.ADMIN.toLowerCase()) return false;
    const perms = role.permissions as string[] | null | undefined;
    if (!perms) return true;
    const hasAdminPower = perms.some((p) =>
      [
        PermissionsEnum.ADMIN,
        PermissionsEnum.CREATE_ROLE,
        PermissionsEnum.DELETE_ROLE,
        PermissionsEnum.UPDATE_ROLE,
        PermissionsEnum.DELETE_USER,
        PermissionsEnum.INVALIDATE_TOKEN,
      ].includes(p as PermissionsEnum),
    );
    return !hasAdminPower;
  }

  /**
   * Register a new trusted device for `userId`. Returns the signed cookie
   * value to be set with httpOnly + Secure + SameSite=Strict.
   */
  async register(input: {
    userId: string;
    userAgent?: string | null;
    ip?: string | null;
  }): Promise<{ cookieValue: string; expiresAt: Date } | null> {
    if (!(await this.isEligible(input.userId))) return null;

    const expiresAt = new Date(Date.now() + USER_TRUST_DAYS * 24 * 60 * 60 * 1000);
    const fingerprintHash = fingerprint(input.userAgent ?? '');
    const deviceId = randomUUID();

    await this.model.create({
      deviceId,
      userId: input.userId,
      deviceFingerprintHash: fingerprintHash,
      userAgent: input.userAgent ?? null,
      ipFirstSeen: input.ip ?? null,
      ipLastSeen: input.ip ?? null,
      lastUsedAt: new Date(),
      expiresAt,
    });

    const cookieValue = await this.signer.sign({
      sub: input.userId,
      deviceId,
      expiresAtSec: Math.floor(expiresAt.getTime() / 1000),
    });
    return { cookieValue, expiresAt };
  }

  /**
   * Verify a trusted-device cookie against the DB row. Returns the deviceId on
   * success, null otherwise.
   *
   * Cookie alone is insufficient — we always re-check the row for revocation
   * and expiry, so manual revoke takes effect immediately.
   */
  async isTrusted(input: {
    cookieValue: string | null | undefined;
    userId: string;
    userAgent?: string | null;
    ip?: string | null;
  }): Promise<{ deviceId: string } | null> {
    if (!input.cookieValue) return null;
    let claims: { sub: string; deviceId: string; exp: number };
    try {
      claims = await this.signer.verify(input.cookieValue);
    } catch {
      return null;
    }
    if (claims.sub !== input.userId) return null;

    const row = await this.model
      .findOne({
        deviceId: claims.deviceId,
        userId: input.userId,
        expiresAt: { $gt: new Date() },
        revokedAt: null,
      })
      .select('deviceId deviceFingerprintHash')
      .lean();
    if (!row) return null;

    if (row.deviceFingerprintHash !== fingerprint(input.userAgent ?? '')) {
      return null;
    }

    await this.model.updateOne(
      { deviceId: row.deviceId },
      { lastUsedAt: new Date(), ipLastSeen: input.ip ?? null },
    );

    return { deviceId: row.deviceId };
  }

  async revoke(input: { userId: string; deviceId: string }): Promise<void> {
    await this.model.updateOne(
      { userId: input.userId, deviceId: input.deviceId, revokedAt: null },
      { revokedAt: new Date() },
    );
  }

  /**
   * Wipe all trusted devices for a user. Called from `MfaService.disableAll`
   * (the user turned MFA off) and `MfaService.onPasswordChanged`.
   *
   * Not called on ban, and does not need to be: `session.create.before` rejects
   * a BANNED user before the MFA gate runs, so device trust can never produce a
   * session for them.
   */
  async revokeAll(userId: string): Promise<void> {
    await this.model.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
  }

  async list(userId: string): Promise<TrustedDeviceListItem[]> {
    const rows = await this.model.find({ userId, revokedAt: null }).lean();
    // Expose the cookie-embedded `deviceId` as `id` — that is the value the
    // client sends back to `DELETE /trusted-devices/:deviceId` (revoke keys on
    // `deviceId`, not the Mongo `_id`).
    return rows.map((r) => ({
      id: r.deviceId,
      userId: r.userId,
      deviceFingerprintHash: r.deviceFingerprintHash,
      userAgent: r.userAgent ?? null,
      ipFirstSeen: r.ipFirstSeen ?? null,
      ipLastSeen: r.ipLastSeen ?? null,
      lastUsedAt: r.lastUsedAt ?? null,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt ?? null,
      createdAt: r.createdAt,
    }));
  }
}

/**
 * Stable client-signal fingerprint. Phase-1 uses User-Agent only; richer signals
 * (Sec-CH-UA-* on web, app version on mobile) can be folded in without schema
 * change since we store the hash.
 */
function fingerprint(userAgent: string): string {
  return createHash('sha256').update(userAgent).digest('base64');
}
