import { randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import { MfaBackupCode, MfaBackupCodeModel } from 'src/schemas/mfa/backup-code.schema';
import { hashBackupCode, verifyBackupCode } from '../crypto/hash';

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_BYTES = 10; // 80 bits → 16 base32 chars (grouped 4-4-4-4)

/**
 * RecoveryService — backup-code generation and verification.
 *
 * Codes are bcrypt-hashed (cost 12); plaintext is shown to the user once at
 * issue and never persisted. Verification is constant-time via bcrypt.compare.
 *
 * Race protection: consumption uses an atomic findOneAndUpdate WHERE
 * consumedAt IS NULL, so two concurrent verifies on the same code can never
 * both win.
 */
@Injectable()
export class RecoveryService {
  constructor(@InjectModel(MfaBackupCode.name) private readonly model: MfaBackupCodeModel) {}

  /**
   * Generate `BACKUP_CODE_COUNT` codes for the user. Invalidates any existing
   * codes (delete then insert). Returns plaintext codes — caller must show them
   * to the user once and discard.
   */
  async generate(userId: string): Promise<string[]> {
    await this.model.deleteMany({ userId });

    const plaintexts: string[] = [];
    const inserts: { userId: string; codeHash: string }[] = [];
    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
      const code = generatePlaintextCode();
      plaintexts.push(code);
      inserts.push({ userId, codeHash: await hashBackupCode(code) });
    }
    await this.model.insertMany(inserts);
    return plaintexts;
  }

  /**
   * Verify a backup code. On success, marks the matched row consumed atomically
   * and returns true. Plaintext is NEVER stored.
   */
  async verifyAndConsume(userId: string, code: string): Promise<boolean> {
    const candidate = code.replace(/\s+/g, '').toUpperCase();
    if (candidate.length === 0) return false;

    const rows = await this.model.find({ userId, consumedAt: null }).select('codeHash').lean();

    for (const row of rows) {
      if (await verifyBackupCode(candidate, row.codeHash)) {
        const updated = await this.model.findOneAndUpdate(
          { _id: row._id, consumedAt: null },
          { consumedAt: new Date() },
        );
        // Race lost (another worker consumed it first) → keep scanning.
        if (updated) return true;
      }
    }
    return false;
  }

  /** Number of unconsumed codes remaining. Used to nudge the user to regenerate. */
  async remaining(userId: string): Promise<number> {
    return this.model.countDocuments({ userId, consumedAt: null });
  }

  /** Wipe codes (called when user disables MFA). */
  async revokeAll(userId: string): Promise<void> {
    await this.model.deleteMany({ userId });
  }
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Generate a single backup-code plaintext. Format: 16 base32 chars in four
 * groups of 4 separated by hyphens (e.g. `7H4P-2X9K-MQ3R-5A8T`). Easier to read
 * and transcribe than a flat string.
 */
function generatePlaintextCode(): string {
  const buf = randomBytes(BACKUP_CODE_BYTES);
  let bits = 0;
  let value = 0;
  let raw = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      raw += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) raw += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  // Insert dashes every 4 characters for readability.
  return raw.match(/.{1,4}/g)?.join('-') ?? raw;
}
