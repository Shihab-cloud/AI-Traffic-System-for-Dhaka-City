import {
  generateTempPassword,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
} from './password.util';

describe('password util', () => {
  it('hashPassword → verifyPassword roundtrip', async () => {
    const hash = await hashPassword('S3cret!pass');
    expect(hash).not.toBe('S3cret!pass');
    await expect(verifyPassword('S3cret!pass', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('S3cret!pass');
    await expect(verifyPassword('S3cret!pass2', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('produces unique salted hashes for the same input', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
  });

  it('exposes a shared minimum length of 8', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  describe('generateTempPassword', () => {
    it('is 12 chars from the unambiguous alphabet (no 0/O/o/1/l/I)', () => {
      for (let i = 0; i < 50; i++) {
        const pwd = generateTempPassword();
        expect(pwd).toHaveLength(12);
        expect(pwd).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]{12}$/);
      }
    });

    it('does not repeat across calls (sanity)', () => {
      const seen = new Set(Array.from({ length: 20 }, () => generateTempPassword()));
      expect(seen.size).toBe(20);
    });
  });
});
