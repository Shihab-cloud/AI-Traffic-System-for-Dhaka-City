import { randomInt } from 'crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import { MfaFactor, MfaFactorModel } from 'src/schemas/mfa/factor.schema';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { MailService } from 'src/modules/mail/mail.service';
import {
  MfaChallengePurposeEnum,
  MfaFactorStatusEnum,
  MfaFactorTypeEnum,
  MfaMailPurposeEnum,
} from 'src/shared/enums/mfa.enum';
import { hashOtp, verifyOtp } from '../crypto/hash';
import type {
  FactorAdapter,
  FactorChallengeResult,
  FactorEnrollResult,
  FactorVerifyInput,
} from './factor.adapter';

const OTP_DIGITS = 6;
const OTP_TTL_MINUTES = 5;

/**
 * EmailOtpAdapter — server-initiated 6-digit OTP delivered via existing
 * MailService. Code is hashed at rest (SHA-256 + per-OTP salt) on
 * mfa_challenges; plaintext only lives in the email body.
 *
 * Enrollment is trivial — the user's verified email is the delivery target,
 * so we just create a factor row in PENDING state. There is no per-user secret.
 *
 * Verify is challenge-bound: caller must pass the `mfa_challenges` row.
 * Constant-time hash compare. The challenge row's `attemptsRemaining` is
 * managed by MfaService (this adapter only answers true/false).
 */
@Injectable()
export class EmailOtpAdapter implements FactorAdapter {
  readonly type = MfaFactorTypeEnum.EMAIL_OTP;
  readonly assurance = 'medium' as const;

  constructor(
    @InjectModel(MfaFactor.name) private readonly factorModel: MfaFactorModel,
    @InjectModel(User.name) private readonly userModel: UserModel,
    private readonly mail: MailService,
  ) {}

  async enroll(userId: string): Promise<FactorEnrollResult> {
    const user = await this.userModel.findById(userId).select('email').lean();
    if (!user?.email) {
      throw new BadRequestException(
        'MFA_FACTOR_UNAVAILABLE: Email OTP requires an email on the user account',
      );
    }

    const row = await this.factorModel.create({
      userId,
      type: MfaFactorTypeEnum.EMAIL_OTP,
      // Created PENDING — user proves they receive emails by entering a
      // code from /api/mfa/challenge/start (purpose=ENROLL_VERIFY) before
      // the factor activates. Same pattern as TOTP, gives a clean signal
      // for the FE to clear `enrollment_required` via the same path.
      status: MfaFactorStatusEnum.PENDING,
    });
    return { factorId: String(row._id) };
  }

  async startChallenge(input: {
    factorId: string;
    purpose: MfaChallengePurposeEnum;
    scope?: string;
    user: { id: string; email: string | null; firstName?: string | null };
  }): Promise<FactorChallengeResult> {
    if (!input.user.email) {
      throw new Error('MFA_FACTOR_UNAVAILABLE: Email OTP requires a user email');
    }
    const userEmail = input.user.email;
    const code = generateNumericCode(OTP_DIGITS);
    const { salt, hash } = hashOtp(code);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    let purposeForMail: MfaMailPurposeEnum;
    switch (input.purpose) {
      case MfaChallengePurposeEnum.LOGIN:
        purposeForMail = MfaMailPurposeEnum.LOGIN;
        break;
      case MfaChallengePurposeEnum.STEP_UP:
        purposeForMail = MfaMailPurposeEnum.STEP_UP;
        break;
      default:
        purposeForMail = MfaMailPurposeEnum.ENROLL_VERIFY;
    }

    await this.mail.sendMfaCode(
      userEmail,
      code,
      purposeForMail,
      OTP_TTL_MINUTES,
      input.user.firstName ?? 'User',
    );

    return { payloadSalt: salt, payloadHash: hash, expiresAt };
  }

  async verify(input: FactorVerifyInput): Promise<boolean> {
    if (!input.challenge?.payloadSalt || !input.challenge.payloadHash) return false;

    // Strip every whitespace char (spaces, tabs, NBSP, etc.) — users often
    // paste the code from the email with leading/trailing or interior spaces.
    const submitted = input.code.replace(/\s+/g, '');

    // Enforce the exact 6-digit shape `generateNumericCode(OTP_DIGITS)` emits.
    // Anchored on both ends so longer/shorter inputs are rejected before we
    // touch the constant-time hash compare.
    if (!/^\d{6}$/.test(submitted)) return false;

    const ok = verifyOtp(submitted, input.challenge.payloadSalt, input.challenge.payloadHash);
    if (ok) {
      await this.factorModel.updateOne({ _id: input.factorId }, { lastUsedAt: new Date() });
    }
    return ok;
  }

  async revoke(factorId: string): Promise<void> {
    await this.factorModel.deleteOne({ _id: factorId });
  }
}

function generateNumericCode(digits: number): string {
  // randomInt(0, max) is uniform over [0, max). Pick max = 10^digits.
  const max = 10 ** digits;
  return randomInt(0, max).toString().padStart(digits, '0');
}
