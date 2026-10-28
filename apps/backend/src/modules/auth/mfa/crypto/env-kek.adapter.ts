import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from 'crypto';

import { Injectable } from '@nestjs/common';
import type { KmsAdapter } from './kms.adapter';

const KEK_BYTES = 32; // AES-256
const DEK_IV_BYTES = 12; // GCM IV
const DEK_TAG_BYTES = 16; // GCM tag

/**
 * EnvKekAdapter — KEK held in an env var (`MFA_KEK_B64`, base64).
 *
 * Wrap format (versioned, base64):
 *   v1 || iv(12) || tag(16) || ciphertext(32)
 *
 * Identified by `activeKekId = "env:v1"`. To rotate, set the new KEK in
 * `MFA_KEK_B64`, run a re-wrap job that reads each row's wrapped DEK with the
 * old KEK and writes it back wrapped with the new KEK + new `kekId`. Until the
 * job completes, the previous KEK must remain available (e.g. `MFA_KEK_PREV_B64`).
 *
 * NOTE: Phase-1 single-active-KEK only. Multi-KEK rotation pathway is left to
 * the AWS KMS adapter where versioning is native.
 */
@Injectable()
export class EnvKekAdapter implements KmsAdapter {
  readonly activeKekId = 'env:v1';
  private readonly kek: Buffer;

  constructor(kekB64: string) {
    if (!kekB64) {
      throw new Error('MFA_KEK_B64 is not set; refusing to start MFA crypto layer');
    }
    const buf = Buffer.from(kekB64, 'base64');
    if (buf.length !== KEK_BYTES) {
      throw new Error(
        `MFA_KEK_B64 must decode to ${KEK_BYTES} bytes (got ${buf.length}); generate via \`openssl rand -base64 32\``,
      );
    }
    this.kek = buf;
  }

  wrap(plaintextDek: Buffer): Promise<{ wrapped: string; kekId: string }> {
    if (plaintextDek.length !== KEK_BYTES) {
      throw new Error(`DEK must be ${KEK_BYTES} bytes`);
    }
    const iv = randomBytes(DEK_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.kek, iv);
    const ct = Buffer.concat([cipher.update(plaintextDek), cipher.final()]);
    const tag = cipher.getAuthTag();
    // version byte (0x01) || iv || tag || ct
    const blob = Buffer.concat([Buffer.from([0x01]), iv, tag, ct]);
    return Promise.resolve({ wrapped: blob.toString('base64'), kekId: this.activeKekId });
  }

  unwrap(wrappedDek: string, kekId: string): Promise<Buffer> {
    if (kekId !== this.activeKekId) {
      throw new Error(`Unknown KEK id "${kekId}"; rotation pathway not configured`);
    }
    const blob = Buffer.from(wrappedDek, 'base64');
    if (blob.length !== 1 + DEK_IV_BYTES + DEK_TAG_BYTES + KEK_BYTES) {
      throw new Error('Wrapped DEK has unexpected length');
    }
    const version = blob.readUInt8(0);
    if (version !== 0x01) {
      throw new Error(`Unsupported wrap format version 0x${version.toString(16)}`);
    }
    const iv = blob.subarray(1, 1 + DEK_IV_BYTES);
    const tag = blob.subarray(1 + DEK_IV_BYTES, 1 + DEK_IV_BYTES + DEK_TAG_BYTES);
    const ct = blob.subarray(1 + DEK_IV_BYTES + DEK_TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.kek, iv);
    decipher.setAuthTag(tag);
    return Promise.resolve(Buffer.concat([decipher.update(ct), decipher.final()]));
  }

  deriveSubKey(info: string, length: number = 32): Promise<Buffer> {
    // HKDF-SHA256 over the KEK with empty salt and a stable `info` label.
    const out = hkdfSync('sha256', this.kek, Buffer.alloc(0), Buffer.from(info, 'utf8'), length);
    return Promise.resolve(Buffer.from(out));
  }
}

/**
 * Constant-time buffer compare. Wraps Node's timingSafeEqual to throw on
 * differing-length inputs (timingSafeEqual itself throws — we accept that).
 */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
