import { SystemSettingsService } from './system-settings.service';

// Minimal stateful fake of the single-document Mongoose model shape used by
// SystemSettingsService — findOne().lean(), findByIdAndUpdate(...).lean(),
// create(...).then(doc.toObject()). Persists across calls within a test so
// update() -> getData() round-trips actually reflect the write.
function build() {
  let stored: {
    _id: string;
    data: Record<string, unknown>;
    updatedById: string | null;
    updatedAt: Date | null;
  } | null = null;

  const model = {
    findOne: jest.fn(() => ({ lean: async () => stored })),
    findByIdAndUpdate: jest.fn((_id: string, patch: Record<string, unknown>) => ({
      lean: async () => {
        stored = { ...(stored as NonNullable<typeof stored>), ...patch, updatedAt: new Date() };
        return stored;
      },
    })),
    create: jest.fn(async (patch: Record<string, unknown>) => {
      stored = { _id: 'system-settings-id', updatedAt: new Date(), ...patch } as NonNullable<
        typeof stored
      >;
      return { toObject: () => stored };
    }),
  };

  const svc = new SystemSettingsService(model as never);
  return { model, svc };
}

describe('SystemSettingsService', () => {
  it('isSignupEnabled reflects the persisted flag, defaulting to true', async () => {
    const { svc } = build();

    expect(await svc.isSignupEnabled()).toBe(true);

    await svc.update({ signupEnabled: false }, 'admin-id');

    expect(await svc.isSignupEnabled()).toBe(false);
  });
});
