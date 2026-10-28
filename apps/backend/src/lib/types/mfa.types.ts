import {
  MfaAuditEventEnum,
  MfaChallengePurposeEnum,
  MfaFactorStatusEnum,
  MfaFactorTypeEnum,
  type MfaStepUpScope,
} from 'src/shared/enums/mfa.enum';

export interface ListedFactor {
  id: string;
  type: MfaFactorTypeEnum;
  status: MfaFactorStatusEnum;
  isPreferred: boolean;
  lastUsedAt: Date | null;
}

/**
 * Trusted-device row projection returned by `TrustedDeviceService.list`.
 * Explicit shape so callers don't inherit Mongoose's giant lean-document type
 * (which trips `TS7056` on inferred return types). Mirrors `TrustedDeviceResponse`.
 */
export interface TrustedDeviceListItem {
  id: string;
  userId: string;
  deviceFingerprintHash: string;
  userAgent?: string | null;
  ipFirstSeen?: string | null;
  ipLastSeen?: string | null;
  lastUsedAt?: Date | null;
  expiresAt: Date;
  revokedAt?: Date | null;
  createdAt: Date;
}

export interface ChallengeStarted {
  challengeId: string;
  factorType: MfaFactorTypeEnum;
  expiresAt: Date;
}

export type VerifyChallengeFailReason =
  'expired' | 'attempts_exhausted' | 'not_found' | 'invalid_code' | 'locked_out';

export interface VerifyChallengeResult {
  ok: boolean;
  userId?: string;
  factorId?: string;
  factorType?: MfaFactorTypeEnum;
  purpose?: MfaChallengePurposeEnum;
  scope?: string | null;
  sessionId?: string | null;
  reason?: VerifyChallengeFailReason;
  /** Seconds until a `locked_out` user may try again. */
  retryAfter?: number;
}

export interface EnrollFactorInput {
  userId: string;
  type: MfaFactorTypeEnum;
  ip?: string | null;
  userAgent?: string | null;
}

export interface DisableAllInput {
  userId: string;
  /** Current session id (`sid` claim), so its MFA session state can be revoked on teardown. */
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /**
   * Audit event to record. Defaults to `DISABLE` (the user turned MFA off
   * themselves); `ADMIN_RESET` when an admin tore it down on their behalf, which
   * also changes the notification wording.
   */
  auditEvent?: MfaAuditEventEnum;
  /** Extra audit context — `actorId` for an admin reset. */
  auditMetadata?: Record<string, unknown>;
}

export interface StartChallengeInput {
  userId: string;
  factorId: string;
  purpose: MfaChallengePurposeEnum;
  scope?: string;
  ip?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
}

export interface VerifyChallengeInput {
  challengeId: string;
  code: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditInput {
  userId: string;
  event: MfaAuditEventEnum;
  factorType?: MfaFactorTypeEnum | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ChallengeContext {
  sessionId?: string;
}

export interface StepUpStartChallengeInput {
  userId: string;
  sessionId: string;
  scope: MfaStepUpScope;
  factorId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface StepUpTokenIssued {
  token: string;
  jti: string;
  expiresAt: Date;
  scope: string;
}

export type StepUpVerifyFailReason =
  | 'expired'
  | 'attempts_exhausted'
  | 'not_found'
  | 'invalid_code'
  | 'locked_out'
  | 'wrong_purpose'
  | 'wrong_session';

export type StepUpVerifyResult =
  { ok: true; issued: StepUpTokenIssued } | { ok: false; reason: StepUpVerifyFailReason };

export interface StepUpVerifyInput {
  challengeId: string;
  code: string;
  sessionId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface StepUpConsumeTokenInput {
  token: string;
  expectedSub: string;
  expectedSid: string;
  expectedScope: MfaStepUpScope;
  ip?: string | null;
  userAgent?: string | null;
}
