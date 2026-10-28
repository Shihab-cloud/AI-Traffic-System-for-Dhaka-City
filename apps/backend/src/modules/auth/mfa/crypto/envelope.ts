import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import { Inject, Injectable } from '@nestjs/common';

import { MFA_KMS_ADAPTER } from '../mfa.tokens';
import type { KmsAdapter } from './kms.adapter';

const DEK_BYTES = 32; // AES-256
const PAYLOAD_IV_BYTES = 12; // GCM IV
const PAYLOAD_TAG_BYTES = 16; // GCM tag

export interface SealedEnvelope {
  kekId: string;
  dekCiphertext: string;
  payloadCiphertext: string;
  payloadIv: string;
  payloadTag: string;
}

/**
 * Envelope encryption helper.
 *
 * `seal(plaintext)`:
 *   1. Generate a random 32-byte DEK.
 *   2. Encrypt plaintext with AES-256-GCM(DEK, randomIv) → ciphertext + tag.
 *   3. Wrap the DEK with the configured KMS (KEK).
 *   4. Return all 5 fields for storage in mfa_factor_secrets.
 *
 * `open(envelope)`:
 *   1. Unwrap DEK using kekId.
 *   2. Decrypt payload. Reject if auth tag mismatches.
 *   3. Return plaintext bytes. Caller MUST discard immediately after use.
 */
@Injectable()
export class EnvelopeCrypto {
  constructor(@Inject(MFA_KMS_ADAPTER) private readonly kms: KmsAdapter) {}

  async seal(plaintext: Buffer): Promise<SealedEnvelope> {
    const dek = randomBytes(DEK_BYTES);
    try {
      const iv = randomBytes(PAYLOAD_IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', dek, iv);
      const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      const { wrapped, kekId } = await this.kms.wrap(dek);
      return {
        kekId,
        dekCiphertext: wrapped,
        payloadCiphertext: ct.toString('base64'),
        payloadIv: iv.toString('base64'),
        payloadTag: tag.toString('base64'),
      };
    } finally {
      // Best-effort wipe — V8 may have copied; we still scrub our reference.
      dek.fill(0);
    }
  }

  async open(env: SealedEnvelope): Promise<Buffer> {
    const dek = await this.kms.unwrap(env.dekCiphertext, env.kekId);
    try {
      const iv = Buffer.from(env.payloadIv, 'base64');
      const tag = Buffer.from(env.payloadTag, 'base64');
      const ct = Buffer.from(env.payloadCiphertext, 'base64');

      if (iv.length !== PAYLOAD_IV_BYTES) {
        throw new Error('Invalid payload IV length');
      }

      if (tag.length !== PAYLOAD_TAG_BYTES) {
        throw new Error('Invalid payload tag length');
      }

      const decipher = createDecipheriv('aes-256-gcm', dek, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]);
    } finally {
      dek.fill(0);
    }
  }
}
