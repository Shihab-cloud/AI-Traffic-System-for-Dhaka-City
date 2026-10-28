import { createHash, randomBytes, timingSafeEqual } from 'crypto';

import bcrypt from 'bcrypt';

const BACKUP_CODE_BCRYPT_COST = 12;

/** SHA-256 a buffer/string and return base64. */
export function sha256(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return createHash('sha256').update(buf).digest('base64');
}

/**
 * Hash an OTP code with a per-record salt and return both salt and hash.
 * Salt is stored alongside the hash in mfa_challenges so verify can recompute.
 */
export function hashOtp(code: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('base64');
  const hash = sha256(salt + code);
  return { salt, hash };
}

/** Verify a submitted OTP against stored (salt, hash) in constant time. */
export function verifyOtp(code: string, salt: string, hash: string): boolean {
  const expected = Buffer.from(hash, 'base64');
  const candidate = Buffer.from(sha256(salt + code), 'base64');
  if (expected.length !== candidate.length) return false;
  return timingSafeEqual(expected, candidate);
}

/** Hash a backup code using bcrypt (cost 12). */
export function hashBackupCode(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BACKUP_CODE_BCRYPT_COST);
}

/** Verify a backup code against its bcrypt hash. */
export function verifyBackupCode(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
