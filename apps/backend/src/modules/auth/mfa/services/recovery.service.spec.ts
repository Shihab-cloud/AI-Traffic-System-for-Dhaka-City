import { selectLean } from 'src/testing/db-mocks';

const hashMocks = {
  hashBackupCode: jest.fn(async (c: string) => `hash:${c}`),
  verifyBackupCode: jest.fn(),
};
jest.mock('../crypto/hash', () => ({
  hashBackupCode: (c: string) => hashMocks.hashBackupCode(c),
  verifyBackupCode: (c: string, h: string) => hashMocks.verifyBackupCode(c, h),
}));

import { RecoveryService } from './recovery.service';

function build() {
  const model = {
    deleteMany: jest.fn(async () => ({})),
    insertMany: jest.fn(async () => ({})),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    countDocuments: jest.fn(async () => 0),
  };
  return { model, svc: new RecoveryService(model as never) };
}

beforeEach(() => {
  hashMocks.hashBackupCode.mockClear();
  hashMocks.verifyBackupCode.mockReset();
});

describe('generate', () => {
  it('wipes existing codes then inserts 10 hashed codes and returns 10 plaintexts', async () => {
    const { model, svc } = build();
    const out = await svc.generate('u-1');

    expect(model.deleteMany).toHaveBeenCalledWith({ userId: 'u-1' });
    expect(model.insertMany).toHaveBeenCalled();
    expect(out).toHaveLength(10);
    expect(new Set(out).size).toBe(10);
    out.forEach((c) => expect(c).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/));
    expect(hashMocks.hashBackupCode).toHaveBeenCalledTimes(10);
  });
});

describe('verifyAndConsume', () => {
  it('returns false for an empty/whitespace-only code without a DB scan', async () => {
    const { model, svc } = build();
    expect(await svc.verifyAndConsume('u-1', '   ')).toBe(false);
    expect(model.find).not.toHaveBeenCalled();
  });

  it('normalizes whitespace + case before comparing', async () => {
    const { model, svc } = build();
    model.find.mockReturnValue(selectLean([{ _id: 'r1', codeHash: 'h' }]));
    hashMocks.verifyBackupCode.mockResolvedValue(true);
    model.findOneAndUpdate.mockResolvedValue({ _id: 'r1' });
    await svc.verifyAndConsume('u-1', ' aaaa-bbbb-cccc-dddd ');
    expect(hashMocks.verifyBackupCode).toHaveBeenCalledWith('AAAA-BBBB-CCCC-DDDD', 'h');
  });

  it('consumes the matched code atomically (WHERE consumedAt IS NULL)', async () => {
    const { model, svc } = build();
    model.find.mockReturnValue(selectLean([{ _id: 'r1', codeHash: 'h' }]));
    hashMocks.verifyBackupCode.mockResolvedValue(true);
    model.findOneAndUpdate.mockResolvedValue({ _id: 'r1' });
    expect(await svc.verifyAndConsume('u-1', 'CODE')).toBe(true);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'r1', consumedAt: null },
      expect.objectContaining({ consumedAt: expect.any(Date) }),
    );
  });

  it('keeps scanning when the atomic update loses the race, then fails if none win', async () => {
    const { model, svc } = build();
    model.find.mockReturnValue(
      selectLean([
        { _id: 'r1', codeHash: 'h1' },
        { _id: 'r2', codeHash: 'h2' },
      ]),
    );
    hashMocks.verifyBackupCode.mockImplementation(async (_c, h) => h === 'h1');
    model.findOneAndUpdate.mockResolvedValue(null); // race lost
    expect(await svc.verifyAndConsume('u-1', 'CODE')).toBe(false);
  });

  it('returns false when no stored code matches', async () => {
    const { model, svc } = build();
    model.find.mockReturnValue(selectLean([{ _id: 'r1', codeHash: 'h' }]));
    hashMocks.verifyBackupCode.mockResolvedValue(false);
    expect(await svc.verifyAndConsume('u-1', 'CODE')).toBe(false);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('remaining', () => {
  it('counts unconsumed codes', async () => {
    const { model, svc } = build();
    model.countDocuments.mockResolvedValue(3);
    await expect(svc.remaining('u-1')).resolves.toBe(3);
  });
});
