import { createHmac, randomBytes } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import { MfaFactor, MfaFactorModel } from 'src/schemas/mfa/factor.schema';
import { MfaFactorSecret, MfaFactorSecretModel } from 'src/schemas/mfa/factor-secret.schema';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { MfaFactorStatusEnum, MfaFactorTypeEnum } from 'src/shared/enums/mfa.enum';
import { EnvelopeCrypto } from '../crypto/envelope';
import type { FactorAdapter, FactorEnrollResult, FactorVerifyInput } from './factor.adapter';

const TOTP_PERIOD_SEC = 30;
const TOTP_DIGITS = 6;
const TOTP_DRIFT_STEPS = 1; // accept ±1 step (±30 s) for clock skew
const TOTP_SECRET_BYTES = 20; // RFC 4226 recommends 20-byte (160-bit) secret
const TOTP_ISSUER = process.env.APP_NAME ?? 'App';

/**
 * TotpAdapter — RFC 6238 TOTP with HMAC-SHA1, 30 s period, 6 digits.
 *
 * Enrollment generates a random secret, envelope-encrypts it, and returns the
 * `otpauth://totp/...` URI for QR rendering. Manual entry via the same base32
 * secret remains supported. The factor row is created with status=PENDING; the
 * MfaService promotes it to ACTIVE after the user verifies the first code.
 *
 * Verification accepts the current step plus ±1 drift. Replay protection: each
 * factor row's `metadata.lastTotpStep` records the last accepted step; submissions
 * with `step <= lastTotpStep` are rejected.
 */
@Injectable()
export class TotpAdapter implements FactorAdapter {
  readonly type = MfaFactorTypeEnum.TOTP;
  readonly assurance = 'high' as const;
  private readonly logger = new Logger(TotpAdapter.name);

  constructor(
    @InjectModel(MfaFactor.name) private readonly factorModel: MfaFactorModel,
    @InjectModel(MfaFactorSecret.name) private readonly secretModel: MfaFactorSecretModel,
    @InjectModel(User.name) private readonly userModel: UserModel,
    private readonly envelope: EnvelopeCrypto,
  ) {}

  async enroll(userId: string): Promise<FactorEnrollResult> {
    const user = await this.userModel.findById(userId).select('email username').lean();
    if (!user) throw new Error(`User ${userId} not found`);

    const secret = randomBytes(TOTP_SECRET_BYTES);
    const secretBase32 = base32EncodeNoPad(secret);
    const otpauthUri = buildTotpUri({
      accountName: user.email ?? user.username ?? userId,
      secretBase32,
    });

    const sealed = await this.envelope.seal(secret);
    secret.fill(0);

    const row = await this.factorModel.create({
      userId,
      type: MfaFactorTypeEnum.TOTP,
      status: MfaFactorStatusEnum.PENDING,
    });
    const factorId = String(row._id);

    await this.secretModel.create({
      factorId,
      kekId: sealed.kekId,
      dekCiphertext: sealed.dekCiphertext,
      payloadCiphertext: sealed.payloadCiphertext,
      payloadIv: sealed.payloadIv,
      payloadTag: sealed.payloadTag,
    });

    return {
      factorId,
      setupData: { otpauthUri, secretBase32 },
    };
  }

  /**
   * Verify a TOTP submission against the stored envelope-encrypted secret.
   *
   * Flow:
   *   1. Load the factor row scoped to (factorId, userId). Reject if missing,
   *      not owned by the caller, or not a TOTP factor.
   *   2. Load + envelope-decrypt the matching `mfa_factor_secrets` row.
   *      Decrypted secret is zeroed in `finally` regardless of outcome.
   *   3. Strip whitespace and shape-check the code against `^\d{6}$` — paste
   *      tolerance + fail-fast before HMAC work.
   *   4. Compute the current 30 s step and try the window
   *      `[nowStep - TOTP_DRIFT_STEPS, nowStep + TOTP_DRIFT_STEPS]`. Skip any
   *      step `<= lastTotpStep` (replay protection — a successful code can
   *      never be reused).
   *   5. On match: persist `metadata.lastTotpStep` + `lastUsedAt`, return true.
   *   6. On miss: log the deltas only — nowStep, lastStep, drift window, and a
   *      one-char prefix of the submitted code. No plaintext OTP or candidate
   *      set ever enters logs.
   *
   * Returns `false` for every failure mode (no exception). The caller (MfaService)
   * decrements `attemptsRemaining` and counts the failure against the
   * per-user ceiling.
   */
  async verify(input: FactorVerifyInput): Promise<boolean> {
    const factor = await this.factorModel
      .findOne({ _id: input.factorId, userId: input.userId })
      .lean();
    if (!factor || factor.type !== MfaFactorTypeEnum.TOTP) return false;

    const sealedRow = await this.secretModel.findOne({ factorId: input.factorId }).lean();
    if (!sealedRow) return false;

    const secret = await this.envelope.open({
      kekId: sealedRow.kekId,
      dekCiphertext: sealedRow.dekCiphertext,
      payloadCiphertext: sealedRow.payloadCiphertext,
      payloadIv: sealedRow.payloadIv,
      payloadTag: sealedRow.payloadTag,
    });

    try {
      const code = input.code.replace(/\s+/g, '');
      if (!/^\d{6}$/.test(code)) {
        this.logger.warn(
          `TOTP verify rejected: code shape invalid for factor=${String(factor._id)}`,
        );
        return false;
      }

      const nowStep = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SEC);
      const meta = (factor.metadata ?? {}) as { lastTotpStep?: number };
      const lastStep = meta.lastTotpStep ?? -1;

      for (let drift = -TOTP_DRIFT_STEPS; drift <= TOTP_DRIFT_STEPS; drift++) {
        const step = nowStep + drift;
        if (step <= lastStep) continue; // replay protection
        const candidate = computeTotp(secret, step, TOTP_DIGITS);
        if (candidate !== code) continue;

        // Claim the step atomically: the filter's own `$lt` guard makes the
        // write the gate, so exactly one request can burn a given step.
        //
        // Dotted `$set` rather than replacing `metadata` wholesale: a whole-object
        // write races with any other field on it and can drop unrelated keys.
        const { modifiedCount } = await this.factorModel.updateOne(
          {
            _id: input.factorId,
            $or: [{ 'metadata.lastTotpStep': { $lt: step } }, { 'metadata.lastTotpStep': null }],
          },
          {
            $set: { 'metadata.lastTotpStep': step, lastUsedAt: new Date() },
          },
        );

        if (modifiedCount !== 1) {
          this.logger.warn(
            `TOTP verify rejected: step ${step} already consumed for factor=${String(factor._id)}`,
          );
          return false;
        }

        return true;
      }
      // Failure log: just the deltas — submitted code prefix-truncated to keep no plaintext OTP in logs.
      this.logger.warn(
        `TOTP verify failed: factor=${String(factor._id)} userId=${input.userId} ` +
          `nowStep=${nowStep} lastStep=${lastStep} ` +
          `submittedPrefix=${code.slice(0, 1)}*** drift=±${TOTP_DRIFT_STEPS}`,
      );
      return false;
    } finally {
      secret.fill(0);
    }
  }

  async revoke(factorId: string): Promise<void> {
    // No FK cascade in Mongo — delete the secret explicitly alongside the factor.
    await this.secretModel.deleteOne({ factorId });
    await this.factorModel.deleteOne({ _id: factorId });
  }
}

// ─── RFC 6238 / 4226 primitives ───────────────────────────────────────────────

function computeTotp(secret: Buffer, step: number, digits: number): string {
  const counter = Buffer.alloc(8);
  // big-endian 64-bit counter
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', secret).update(counter).digest();
  // RFC 4226 §5.3 dynamic truncation. Low nibble of the last byte picks the
  // 4-byte window; the high bit of the first byte is masked off so the
  // assembled 31-bit integer stays positive when treated as signed.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const b0 = hmac[offset] & 0x7f; // mask sign bit
  const b1 = hmac[offset + 1] & 0xff;
  const b2 = hmac[offset + 2] & 0xff;
  const b3 = hmac[offset + 3] & 0xff;
  const binCode = (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;

  const otp = binCode % 10 ** digits;
  return otp.toString().padStart(digits, '0');
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32EncodeNoPad(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
      // Mask value back down to its remaining low bits so it never grows past
      // 32 bits — JavaScript's bitwise operators are int32 and would corrupt
      // the high bytes of a 20-byte secret without this.
      value &= (1 << bits) - 1;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

/** Build an `otpauth://totp/...` URI for QR rendering. */
export function buildTotpUri(opts: {
  accountName: string;
  secretBase32: string;
  issuer?: string;
  digits?: number;
  period?: number;
}): string {
  const issuer = encodeURIComponent(opts.issuer ?? TOTP_ISSUER);
  const account = encodeURIComponent(opts.accountName);
  const params = new URLSearchParams({
    secret: opts.secretBase32,
    issuer: opts.issuer ?? TOTP_ISSUER,
    digits: String(opts.digits ?? TOTP_DIGITS),
    period: String(opts.period ?? TOTP_PERIOD_SEC),
    algorithm: 'SHA1',
  });
  return `otpauth://totp/${issuer}:${account}?${params.toString()}`;
}

export { base32EncodeNoPad };
