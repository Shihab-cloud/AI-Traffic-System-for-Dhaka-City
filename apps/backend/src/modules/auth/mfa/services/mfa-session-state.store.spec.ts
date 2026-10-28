import { AmrEnum } from 'src/shared/enums/auth.enum';

import { SESSION_EXPIRY_SECONDS } from 'src/lib/auth/session.constants';
import { lean } from 'src/testing/db-mocks';
import { MfaSessionStateStore } from './mfa-session-state.store';

function build() {
  const model = {
    updateOne: jest.fn(async () => ({})),
    findOne: jest.fn(),
    deleteOne: jest.fn(async () => ({})),
  };
  return { model, store: new MfaSessionStateStore(model as never) };
}
const future = () => new Date(Date.now() + 60_000);

describe('MfaSessionStateStore (Mongo TTL collection)', () => {
  describe('setPending / setSessionState', () => {
    it('upserts pending state keyed by userId', async () => {
      const { model, store } = build();
      await store.setPending('u-1', { aal: 2, amr: [AmrEnum.TOTP], mfa_at: 123 });
      expect(model.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'u-1' }),
        expect.objectContaining({ aal: 2, amr: [AmrEnum.TOTP], mfa_at: 123 }),
        { upsert: true },
      );
    });

    it('upserts session state with null defaults for optional fields', async () => {
      const { model, store } = build();
      await store.setSessionState('s-1', { aal: 1, amr: [AmrEnum.PWD] });
      expect(model.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ key: 's-1' }),
        expect.objectContaining({ mfa_at: null, enrollment_required: null }),
        { upsert: true },
      );
    });

    // Session state is written once at sign-in and never refreshed. An expiry
    // earlier than the session's own lapses underneath a session that is still
    // valid: `enrichJwtPayload` then returns null, `aal` silently drops to 1,
    // and the user is hit with a step-up prompt mid-session.
    it('keeps session state alive for at least the whole session lifetime', async () => {
      const { model, store } = build();
      const before = Date.now();
      await store.setSessionState('s-1', { aal: 2, amr: [AmrEnum.TOTP] });

      const update = (
        model.updateOne.mock.calls as unknown as [unknown, { expiresAt: Date }][]
      )[0][1];
      const lifetimeSeconds = (update.expiresAt.getTime() - before) / 1000;

      expect(lifetimeSeconds).toBeGreaterThanOrEqual(SESSION_EXPIRY_SECONDS - 5);
    });
  });

  describe('read', () => {
    // Better Auth sessions are rolling: `updateAge` pushes `expiresAt` forward
    // on the same session id, so a daily user outlives any fixed TTL written
    // once at sign-in. The row would expire underneath a live session,
    // `enrichJwtPayload` would return null, `aal` would drop to 1, and the user
    // would get a surprise step-up prompt. A read is proof of use, so it
    // re-arms the row.
    it('re-arms the session-state TTL on every read', async () => {
      const { model, store } = build();
      model.findOne.mockReturnValue(lean({ aal: 2, amr: [AmrEnum.TOTP], expiresAt: future() }));

      const before = Date.now();
      await store.getSessionState('s-1');

      expect(model.updateOne).toHaveBeenCalledTimes(1);
      const [, update] = model.updateOne.mock.calls[0] as unknown as [unknown, { expiresAt: Date }];
      expect(update.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + SESSION_EXPIRY_SECONDS * 1000,
      );
    });

    // Pending state is consumed inside one request, so extending it would only
    // keep a dead bridge row alive.
    it('does not re-arm pending state', async () => {
      const { model, store } = build();
      model.findOne.mockReturnValue(lean({ aal: 2, amr: [AmrEnum.TOTP], expiresAt: future() }));

      await store.getPending('u-1');

      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('does not re-arm a row that has already expired', async () => {
      const { model, store } = build();
      model.findOne.mockReturnValue(
        lean({ aal: 2, amr: [AmrEnum.TOTP], expiresAt: new Date(Date.now() - 1000) }),
      );

      expect(await store.getSessionState('s-1')).toBeNull();
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('enforces expiry locally when the TTL sweep lagged', async () => {
      const { model, store } = build();
      model.findOne.mockReturnValue(
        lean({ aal: 2, amr: [AmrEnum.TOTP], expiresAt: new Date(Date.now() - 1000) }),
      );
      expect(await store.getPending('u-1')).toBeNull();
    });

    it('returns null for a corrupt aal or non-array amr', async () => {
      const { model, store } = build();
      model.findOne.mockReturnValue(lean({ aal: 5, amr: [], expiresAt: future() }));
      expect(await store.getPending('u-1')).toBeNull();
      model.findOne.mockReturnValue(lean({ aal: 2, amr: 'nope', expiresAt: future() }));
      expect(await store.getPending('u-1')).toBeNull();
    });

    it('rebuilds a valid state including optional mfa_at + enrollment_required', async () => {
      const { model, store } = build();
      model.findOne.mockReturnValue(
        lean({
          aal: 2,
          amr: [AmrEnum.TOTP],
          mfa_at: 999,
          enrollment_required: true,
          expiresAt: future(),
        }),
      );
      expect(await store.getSessionState('s-1')).toEqual({
        aal: 2,
        amr: [AmrEnum.TOTP],
        mfa_at: 999,
        enrollment_required: true,
      });
    });

    it('omits mfa_at when not numeric and enrollment_required when falsy', async () => {
      const { model, store } = build();
      model.findOne.mockReturnValue(
        lean({ aal: 1, amr: [AmrEnum.PWD], mfa_at: null, expiresAt: future() }),
      );
      const state = await store.getSessionState('s-1');
      expect(state).toEqual({ aal: 1, amr: [AmrEnum.PWD] });
    });
  });

  describe('clearEnrollmentRequired', () => {
    it('no-ops when there is no session state', async () => {
      const { model, store } = build();
      model.findOne.mockReturnValue(lean(null));
      await store.clearEnrollmentRequired('s-1');
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('no-ops when the flag is already absent', async () => {
      const { model, store } = build();
      model.findOne.mockReturnValue(lean({ aal: 2, amr: [AmrEnum.TOTP], expiresAt: future() }));
      await store.clearEnrollmentRequired('s-1');

      // Reading session state re-arms its TTL, so a bare `not.toHaveBeenCalled`
      // no longer expresses the intent. What must not happen is a rewrite of
      // the state itself.
      const stateWrites = model.updateOne.mock.calls.filter(
        (call: unknown[]) => 'aal' in ((call[1] ?? {}) as Record<string, unknown>),
      );
      expect(stateWrites).toHaveLength(0);
    });

    it('rewrites the state without the flag when it was set', async () => {
      const { model, store } = build();
      model.findOne.mockReturnValue(
        lean({ aal: 2, amr: [AmrEnum.TOTP], enrollment_required: true, expiresAt: future() }),
      );
      await store.clearEnrollmentRequired('s-1');
      expect(model.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ key: 's-1' }),
        expect.objectContaining({ enrollment_required: null }),
        { upsert: true },
      );
    });
  });
});
