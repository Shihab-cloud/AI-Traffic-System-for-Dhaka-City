import { randomBytes } from 'crypto';

import { EnvKekAdapter, safeEqual } from './env-kek.adapter';
import { EnvelopeCrypto } from './envelope';

const TEST_KEK_B64 = randomBytes(32).toString('base64');

function makeCrypto() {
  return new EnvelopeCrypto(new EnvKekAdapter(TEST_KEK_B64));
}

describe('EnvKekAdapter', () => {
  it('refuses to start without a KEK', () => {
    expect(() => new EnvKekAdapter('')).toThrow(/MFA_KEK_B64 is not set/);
  });

  it('refuses a KEK that is not 32 bytes', () => {
    expect(() => new EnvKekAdapter(Buffer.from('short').toString('base64'))).toThrow(
      /must decode to 32 bytes/,
    );
  });

  it('wrap → unwrap roundtrips a DEK', async () => {
    const kms = new EnvKekAdapter(TEST_KEK_B64);
    const dek = randomBytes(32);
    const { wrapped, kekId } = await kms.wrap(Buffer.from(dek));
    expect(kekId).toBe('env:v1');
    const unwrapped = await kms.unwrap(wrapped, kekId);
    expect(unwrapped.equals(dek)).toBe(true);
  });

  // unwrap() throws synchronously (not async) — assert with toThrow, not rejects.
  it('rejects an unknown kekId (rotation not configured)', async () => {
    const kms = new EnvKekAdapter(TEST_KEK_B64);
    const { wrapped } = await kms.wrap(randomBytes(32));
    expect(() => kms.unwrap(wrapped, 'env:v2')).toThrow(/Unknown KEK id/);
  });

  it('rejects a tampered wrapped DEK (GCM auth failure)', async () => {
    const kms = new EnvKekAdapter(TEST_KEK_B64);
    const { wrapped, kekId } = await kms.wrap(randomBytes(32));
    const blob = Buffer.from(wrapped, 'base64');
    blob[blob.length - 1] ^= 0xff;
    expect(() => kms.unwrap(blob.toString('base64'), kekId)).toThrow();
  });

  it('rejects a wrapped DEK of unexpected length', () => {
    const kms = new EnvKekAdapter(TEST_KEK_B64);
    expect(() => kms.unwrap(Buffer.from('tiny').toString('base64'), 'env:v1')).toThrow(
      /unexpected length/,
    );
  });

  it('deriveSubKey is deterministic and label-separated', async () => {
    const kms = new EnvKekAdapter(TEST_KEK_B64);
    const a1 = await kms.deriveSubKey('step_up_v1', 32);
    const a2 = await kms.deriveSubKey('step_up_v1', 32);
    const b = await kms.deriveSubKey('trusted_device_v1', 32);
    expect(a1.equals(a2)).toBe(true);
    expect(a1.equals(b)).toBe(false);
    expect(a1).toHaveLength(32);
  });
});

describe('EnvelopeCrypto', () => {
  it('seal → open roundtrips plaintext', async () => {
    const crypto = makeCrypto();
    const secret = Buffer.from('totp-seed-super-secret');
    const envelope = await crypto.seal(Buffer.from(secret));
    const opened = await crypto.open(envelope);
    expect(opened.equals(secret)).toBe(true);
  });

  it('every seal uses a fresh DEK and IV', async () => {
    const crypto = makeCrypto();
    const a = await crypto.seal(Buffer.from('same'));
    const b = await crypto.seal(Buffer.from('same'));
    expect(a.dekCiphertext).not.toBe(b.dekCiphertext);
    expect(a.payloadIv).not.toBe(b.payloadIv);
    expect(a.payloadCiphertext).not.toBe(b.payloadCiphertext);
  });

  it('rejects tampered payload ciphertext (auth tag mismatch)', async () => {
    const crypto = makeCrypto();
    const envelope = await crypto.seal(Buffer.from('secret'));
    const ct = Buffer.from(envelope.payloadCiphertext, 'base64');
    ct[0] ^= 0xff;
    await expect(
      crypto.open({ ...envelope, payloadCiphertext: ct.toString('base64') }),
    ).rejects.toThrow();
  });

  it('rejects malformed iv/tag lengths', async () => {
    const crypto = makeCrypto();
    const envelope = await crypto.seal(Buffer.from('secret'));
    await expect(
      crypto.open({ ...envelope, payloadIv: Buffer.alloc(4).toString('base64') }),
    ).rejects.toThrow(/Invalid payload IV length/);
    await expect(
      crypto.open({ ...envelope, payloadTag: Buffer.alloc(4).toString('base64') }),
    ).rejects.toThrow(/Invalid payload tag length/);
  });
});

describe('safeEqual', () => {
  it('compares equal and unequal buffers, tolerating length mismatch', () => {
    expect(safeEqual(Buffer.from('abc'), Buffer.from('abc'))).toBe(true);
    expect(safeEqual(Buffer.from('abc'), Buffer.from('abd'))).toBe(false);
    expect(safeEqual(Buffer.from('abc'), Buffer.from('abcd'))).toBe(false);
  });
});
