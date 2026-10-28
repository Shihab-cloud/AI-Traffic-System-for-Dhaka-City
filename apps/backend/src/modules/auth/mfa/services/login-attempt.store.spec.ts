import { AmrEnum } from 'src/shared/enums/auth.enum';
import { MfaFactorTypeEnum } from 'src/shared/enums/mfa.enum';

import { lean } from 'src/testing/db-mocks';
import { LoginAttemptStore } from './login-attempt.store';

function build() {
  const model = {
    updateOne: jest.fn(async () => ({})),
    findOne: jest.fn(),
    deleteOne: jest.fn(async () => ({})),
    findOneAndDelete: jest.fn(),
  };
  return { model, store: new LoginAttemptStore(model as never) };
}

describe('LoginAttemptStore (Mongo TTL collection)', () => {
  describe('mintAttempt', () => {
    it('upserts a random attempt token and returns it', async () => {
      const { model, store } = build();
      const token = await store.mintAttempt('user-1');
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThan(20);
      expect(model.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ key: token }),
        expect.objectContaining({ userId: 'user-1' }),
        { upsert: true },
      );
    });
  });

  describe('verifyAttempt', () => {
    it('returns null for an empty token without a DB read', async () => {
      const { model, store } = build();
      expect(await store.verifyAttempt('')).toBeNull();
      expect(model.findOne).not.toHaveBeenCalled();
    });

    it('returns null when no row is found', async () => {
      const { model, store } = build();
      model.findOne.mockReturnValue(lean(null));
      expect(await store.verifyAttempt('tok')).toBeNull();
    });

    it('enforces expiry locally even if the TTL sweep lagged', async () => {
      const { model, store } = build();
      model.findOne.mockReturnValue(
        lean({ userId: 'user-1', expiresAt: new Date(Date.now() - 1000) }),
      );
      expect(await store.verifyAttempt('tok')).toBeNull();
    });

    it('rejects a row whose userId is not a string', async () => {
      const { model, store } = build();
      model.findOne.mockReturnValue(lean({ userId: 123, expiresAt: new Date(Date.now() + 10000) }));
      expect(await store.verifyAttempt('tok')).toBeNull();
    });

    it('returns the userId for a valid, unexpired row', async () => {
      const { model, store } = build();
      model.findOne.mockReturnValue(
        lean({ userId: 'user-1', expiresAt: new Date(Date.now() + 10000) }),
      );
      expect(await store.verifyAttempt('tok')).toEqual({ userId: 'user-1' });
    });
  });

  describe('consumeProof', () => {
    it('returns null when no proof row exists', async () => {
      const { model, store } = build();
      model.findOneAndDelete.mockReturnValue(lean(null));
      expect(await store.consumeProof('user-1')).toBeNull();
    });

    it('returns null for an expired proof row', async () => {
      const { model, store } = build();
      model.findOneAndDelete.mockReturnValue(
        lean({
          factorType: MfaFactorTypeEnum.TOTP,
          mfa_at: 123,
          amr: [AmrEnum.TOTP],
          expiresAt: new Date(Date.now() - 1000),
        }),
      );
      expect(await store.consumeProof('user-1')).toBeNull();
    });

    it('returns null for a structurally invalid proof row', async () => {
      const { model, store } = build();
      model.findOneAndDelete.mockReturnValue(
        lean({
          factorType: 123,
          mfa_at: 'x',
          amr: 'nope',
          expiresAt: new Date(Date.now() + 10000),
        }),
      );
      expect(await store.consumeProof('user-1')).toBeNull();
    });

    it('returns the proof payload for a valid, unexpired row', async () => {
      const { model, store } = build();
      model.findOneAndDelete.mockReturnValue(
        lean({
          factorType: MfaFactorTypeEnum.TOTP,
          mfa_at: 123,
          amr: [AmrEnum.TOTP],
          expiresAt: new Date(Date.now() + 10000),
        }),
      );
      expect(await store.consumeProof('user-1')).toEqual({
        factorType: MfaFactorTypeEnum.TOTP,
        mfa_at: 123,
        amr: [AmrEnum.TOTP],
      });
    });
  });
});
