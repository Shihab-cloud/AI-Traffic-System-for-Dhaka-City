import { MfaFactorTypeEnum } from 'src/shared/enums/mfa.enum';

import { lean } from 'src/testing/db-mocks';
import { base32EncodeNoPad, buildTotpUri, TotpAdapter } from './totp.adapter';

// RFC 6238 SHA1 test secret: ASCII "12345678901234567890".
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
// At T=59s (step 1) the RFC-6238 SHA1 code is 94287082 → last 6 digits 287082.
const RFC_CODE_AT_T59 = '287082';

const envelope = { seal: jest.fn(), open: jest.fn(async () => Buffer.from(RFC_SECRET)) };

/**
 * `updateOne` stands in for the atomic step claim rather than always reporting
 * a win. The adapter's whole replay defence lives in that filter, so a mock
 * that answers `modifiedCount: 1` unconditionally would keep every test in this
 * file green with the guard deleted.
 */
function makeFactorModel() {
  const stored: { lastTotpStep?: number | null } = {};
  const updateOne = jest.fn(
    async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const guards = (filter.$or ?? []) as Record<string, { $lt?: number } | null>[];
      const current = stored.lastTotpStep;
      const matches = guards.some((guard) => {
        const condition = guard['metadata.lastTotpStep'];
        if (condition === null) return current === undefined || current === null;
        return typeof condition?.$lt === 'number' && (current ?? -Infinity) < condition.$lt;
      });
      if (!matches) return { modifiedCount: 0 };

      const set = (update.$set ?? {}) as Record<string, number>;
      stored.lastTotpStep = set['metadata.lastTotpStep'];
      return { modifiedCount: 1 };
    },
  );
  return { findOne: jest.fn(), updateOne, stored };
}

function build() {
  const factorModel = makeFactorModel();
  const secretModel = { findOne: jest.fn() };
  const userModel = { findById: jest.fn() };
  return {
    factorModel,
    secretModel,
    adapter: new TotpAdapter(
      factorModel as never,
      secretModel as never,
      userModel as never,
      envelope as never,
    ),
  };
}

function stubFactor(b: ReturnType<typeof build>, metadata: Record<string, unknown> = {}) {
  b.factorModel.findOne.mockReturnValue(
    lean({ _id: 'f-1', userId: 'u-1', type: MfaFactorTypeEnum.TOTP, metadata }),
  );
  b.secretModel.findOne.mockReturnValue(
    lean({
      kekId: 'env:v1',
      dekCiphertext: 'x',
      payloadCiphertext: 'x',
      payloadIv: 'x',
      payloadTag: 'x',
    }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  envelope.open.mockImplementation(async () => Buffer.from(RFC_SECRET));
  jest.useFakeTimers();
  jest.setSystemTime(new Date(59_000)); // T=59s → step 1
});
afterEach(() => jest.useRealTimers());

describe('TotpAdapter.verify', () => {
  it('lets exactly one of two concurrent verifications burn the step', async () => {
    const b = build();
    stubFactor(b);

    const results = await Promise.all([
      b.adapter.verify({ userId: 'u-1', factorId: 'f-1', code: RFC_CODE_AT_T59 }),
      b.adapter.verify({ userId: 'u-1', factorId: 'f-1', code: RFC_CODE_AT_T59 }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('rejects a code whose step has already been claimed', async () => {
    const b = build();
    stubFactor(b);

    await expect(
      b.adapter.verify({ userId: 'u-1', factorId: 'f-1', code: RFC_CODE_AT_T59 }),
    ).resolves.toBe(true);
    await expect(
      b.adapter.verify({ userId: 'u-1', factorId: 'f-1', code: RFC_CODE_AT_T59 }),
    ).resolves.toBe(false);
  });

  it('accepts the correct current-step code (RFC 6238 vector)', async () => {
    const b = build();
    stubFactor(b);
    await expect(
      b.adapter.verify({ factorId: 'f-1', userId: 'u-1', code: RFC_CODE_AT_T59 }),
    ).resolves.toBe(true);
    expect(b.factorModel.updateOne).toHaveBeenCalled();
  });

  it('tolerates whitespace in the submitted code', async () => {
    const b = build();
    stubFactor(b);
    await expect(
      b.adapter.verify({ factorId: 'f-1', userId: 'u-1', code: '287 082' }),
    ).resolves.toBe(true);
  });

  it('rejects a wrong code', async () => {
    const b = build();
    stubFactor(b);
    await expect(
      b.adapter.verify({ factorId: 'f-1', userId: 'u-1', code: '000000' }),
    ).resolves.toBe(false);
    expect(b.factorModel.updateOne).not.toHaveBeenCalled();
  });

  it('rejects a malformed (non-6-digit) code', async () => {
    const b = build();
    stubFactor(b);
    await expect(b.adapter.verify({ factorId: 'f-1', userId: 'u-1', code: 'abcd' })).resolves.toBe(
      false,
    );
  });

  it('enforces replay protection: a step <= lastTotpStep is refused', async () => {
    const b = build();
    stubFactor(b, { lastTotpStep: 1 });
    await expect(
      b.adapter.verify({ factorId: 'f-1', userId: 'u-1', code: RFC_CODE_AT_T59 }),
    ).resolves.toBe(false);
  });

  it('returns false when the factor is missing or not TOTP', async () => {
    const b = build();
    b.factorModel.findOne.mockReturnValue(lean(null));
    await expect(
      b.adapter.verify({ factorId: 'f-1', userId: 'u-1', code: RFC_CODE_AT_T59 }),
    ).resolves.toBe(false);

    b.factorModel.findOne.mockReturnValue(
      lean({ _id: 'f-1', userId: 'u-1', type: MfaFactorTypeEnum.EMAIL_OTP }),
    );
    await expect(
      b.adapter.verify({ factorId: 'f-1', userId: 'u-1', code: RFC_CODE_AT_T59 }),
    ).resolves.toBe(false);
  });

  it('returns false when no secret row exists', async () => {
    const b = build();
    b.factorModel.findOne.mockReturnValue(
      lean({ _id: 'f-1', userId: 'u-1', type: MfaFactorTypeEnum.TOTP, metadata: {} }),
    );
    b.secretModel.findOne.mockReturnValue(lean(null));
    await expect(
      b.adapter.verify({ factorId: 'f-1', userId: 'u-1', code: RFC_CODE_AT_T59 }),
    ).resolves.toBe(false);
  });
});

describe('base32EncodeNoPad', () => {
  it('encodes without padding (RFC 4648 vector)', () => {
    expect(base32EncodeNoPad(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });
});

describe('buildTotpUri', () => {
  it('produces a well-formed otpauth URI', () => {
    const uri = buildTotpUri({ accountName: 'a@b.com', secretBase32: 'ABC', issuer: 'MyApp' });
    expect(uri).toMatch(/^otpauth:\/\/totp\/MyApp:a%40b\.com\?/);
    expect(uri).toContain('secret=ABC');
    expect(uri).toContain('algorithm=SHA1');
  });
});
