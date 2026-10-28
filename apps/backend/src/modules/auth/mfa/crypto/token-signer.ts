import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';

import { MFA_KMS_ADAPTER } from '../mfa.tokens';
import type { KmsAdapter } from './kms.adapter';

/**
 * StepUpTokenSigner — issues and verifies HS256-signed step-up tokens.
 *
 * Sub-key is derived from the KEK via HKDF (info=`step_up_v1`). Distinct from
 * the EdDSA JWT signing key in better-auth's JWKS, so a JWKS leak does not
 * grant step-up forgery.
 *
 * Token claims: { sub, sid, scope, jti, exp }. The `jti` matches the
 * `mfa_step_up_tokens._id` row. StepUpGuard consumes the row (findOneAndDelete)
 * on use, making replay impossible at the DB level.
 */
@Injectable()
export class StepUpTokenSigner {
  private subKeyPromise: Promise<Uint8Array> | null = null;

  constructor(@Inject(MFA_KMS_ADAPTER) private readonly kms: KmsAdapter) {}

  private getSubKey(): Promise<Uint8Array> {
    this.subKeyPromise ??= this.kms.deriveSubKey('step_up_v1', 32).then((b) => new Uint8Array(b));
    return this.subKeyPromise;
  }

  async sign(claims: {
    sub: string;
    sid: string;
    scope: string;
    jti: string;
    expiresAtSec: number;
  }): Promise<string> {
    const key = await this.getSubKey();
    return new SignJWT({ sid: claims.sid, scope: claims.scope })
      .setProtectedHeader({ alg: 'HS256', typ: 'mfa+jwt' })
      .setSubject(claims.sub)
      .setJti(claims.jti)
      .setExpirationTime(claims.expiresAtSec)
      .setIssuedAt()
      .sign(key);
  }

  async verify(token: string): Promise<{
    sub: string;
    sid: string;
    scope: string;
    jti: string;
    exp: number;
  }> {
    const key = await this.getSubKey();
    const { payload } = await jwtVerify(token, key, { typ: 'mfa+jwt' });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      typeof payload.scope !== 'string' ||
      typeof payload.jti !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      throw new Error('Step-up token missing required claims');
    }
    return {
      sub: payload.sub,
      sid: payload.sid,
      scope: payload.scope,
      jti: payload.jti,
      exp: payload.exp,
    };
  }
}

/** Same shape, re-derived sub-key; kept separate so trusted-device tokens use a distinct info label. */
@Injectable()
export class TrustedDeviceTokenSigner {
  private subKeyPromise: Promise<Uint8Array> | null = null;

  constructor(@Inject(MFA_KMS_ADAPTER) private readonly kms: KmsAdapter) {}

  private getSubKey(): Promise<Uint8Array> {
    this.subKeyPromise ??= this.kms
      .deriveSubKey('trusted_device_v1', 32)
      .then((b) => new Uint8Array(b));
    return this.subKeyPromise;
  }

  async sign(claims: { sub: string; deviceId: string; expiresAtSec: number }): Promise<string> {
    const key = await this.getSubKey();
    return new SignJWT({ deviceId: claims.deviceId })
      .setProtectedHeader({ alg: 'HS256', typ: 'mfa-td+jwt' })
      .setSubject(claims.sub)
      .setExpirationTime(claims.expiresAtSec)
      .setIssuedAt()
      .sign(key);
  }

  async verify(token: string): Promise<{ sub: string; deviceId: string; exp: number }> {
    const key = await this.getSubKey();
    const { payload } = await jwtVerify(token, key, { typ: 'mfa-td+jwt' });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.deviceId !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      throw new Error('Trusted-device token missing required claims');
    }
    return { sub: payload.sub, deviceId: payload.deviceId, exp: payload.exp };
  }
}
