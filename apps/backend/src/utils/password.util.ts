import * as bcrypt from 'bcrypt';
import { createHash, randomInt, timingSafeEqual } from 'crypto';

const BCRYPT_ROUNDS = 10;

/**
 * Minimum length for any user-chosen password, shared across every flow that
 * sets one (activation, invite acceptance, self-service change) so the weakest
 * gate can't undercut the others.
 */
export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Unambiguous alphabet: removes 0/O/o, 1/l/I to make temp passwords easy to
// read aloud, copy from a sticky note, or paste from a chat message.
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 12;

export function generateTempPassword(): string {
  let out = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return out;
}

/**
 * Constant-time string comparison for secrets sent by a caller.
 *
 * `===` on a token short-circuits at the first differing byte, so response
 * timing leaks a prefix match and the value can be recovered byte by byte.
 * Hashing both sides first keeps the compared buffers equal-length, which
 * `timingSafeEqual` requires and which also stops the *length* leaking.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}
