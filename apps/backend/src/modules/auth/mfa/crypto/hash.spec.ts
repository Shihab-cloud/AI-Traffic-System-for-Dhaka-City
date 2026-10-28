import { createHash } from 'crypto';

import { hashBackupCode, hashOtp, sha256, verifyBackupCode, verifyOtp } from './hash';

describe('mfa hash utils', () => {
  describe('sha256', () => {
    it('matches node crypto for strings and buffers', () => {
      const expected = createHash('sha256').update('abc').digest('base64');
      expect(sha256('abc')).toBe(expected);
      expect(sha256(Buffer.from('abc'))).toBe(expected);
    });
  });

  describe('hashOtp / verifyOtp', () => {
    it('roundtrips a code', () => {
      const { salt, hash } = hashOtp('123456');
      expect(verifyOtp('123456', salt, hash)).toBe(true);
    });

    it('rejects a wrong code', () => {
      const { salt, hash } = hashOtp('123456');
      expect(verifyOtp('123457', salt, hash)).toBe(false);
      expect(verifyOtp('', salt, hash)).toBe(false);
    });

    it('rejects when salt does not match the one hashed with', () => {
      const { hash } = hashOtp('123456');
      const { salt: otherSalt } = hashOtp('123456');
      expect(verifyOtp('123456', otherSalt, hash)).toBe(false);
    });

    it('handles a malformed stored hash without throwing (length mismatch path)', () => {
      const { salt } = hashOtp('123456');
      expect(verifyOtp('123456', salt, 'short')).toBe(false);
    });

    it('salts per record — same code hashes differently', () => {
      const a = hashOtp('123456');
      const b = hashOtp('123456');
      expect(a.hash).not.toBe(b.hash);
      expect(a.salt).not.toBe(b.salt);
    });
  });

  describe('hashBackupCode / verifyBackupCode', () => {
    it('roundtrips and rejects wrong code', async () => {
      const hash = await hashBackupCode('AAAA-BBBB');
      await expect(verifyBackupCode('AAAA-BBBB', hash)).resolves.toBe(true);
      await expect(verifyBackupCode('AAAA-BBBC', hash)).resolves.toBe(false);
    });
  });
});
