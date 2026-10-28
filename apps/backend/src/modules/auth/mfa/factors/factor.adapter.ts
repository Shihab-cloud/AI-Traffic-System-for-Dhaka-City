import type { MfaChallengePurposeEnum, MfaFactorTypeEnum } from 'src/shared/enums/mfa.enum';

export interface FactorEnrollResult {
  factorId: string;
  /**
   * Setup data shown to the user once at enrollment. e.g. for TOTP this carries
   * the otpauth URI (for QR rendering) and the base32 secret (manual entry).
   * Empty / omitted for factors that need no client-side setup (e.g. Email OTP).
   */
  setupData?: Record<string, unknown>;
}

export interface FactorChallengeResult {
  /** Random salt stored on mfa_challenges; combined with the code to compute payloadHash. */
  payloadSalt: string;
  /** SHA-256(salt || code) base64. Submitted code is hashed and compared in constant time. */
  payloadHash: string;
  expiresAt: Date;
}

export interface FactorVerifyInput {
  userId: string;
  factorId: string;
  code: string;
  challenge?: {
    id: string;
    payloadSalt: string | null;
    payloadHash: string | null;
  };
}

/**
 * FactorAdapter — single extension point for adding new authentication factors.
 * Adapters know HOW their factor enrolls/challenges/verifies; the MfaService
 * orchestrates WHEN.
 *
 * Adding a new factor (e.g. WebAuthn, SMS OTP) is one new adapter file +
 * registration in MfaModule providers; no call-site changes elsewhere.
 */
export interface FactorAdapter {
  readonly type: MfaFactorTypeEnum;
  readonly assurance: 'low' | 'medium' | 'high';

  enroll(userId: string): Promise<FactorEnrollResult>;

  /**
   * Server-initiated challenge (Email/SMS OTP). Optional — TOTP-style factors
   * have always-available codes from the authenticator app and skip this.
   */
  startChallenge?(input: {
    factorId: string;
    purpose: MfaChallengePurposeEnum;
    scope?: string;
    user: { id: string; email: string | null; firstName?: string | null };
  }): Promise<FactorChallengeResult>;

  verify(input: FactorVerifyInput): Promise<boolean>;

  revoke(factorId: string): Promise<void>;
}
