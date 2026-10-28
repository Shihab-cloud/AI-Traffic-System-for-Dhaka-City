import type { MfaFactorStatusEnum, MfaFactorTypeEnum } from '@/lib/enums/mfa.enum';

export interface ListedFactor {
  id: string;
  type: MfaFactorTypeEnum;
  status: MfaFactorStatusEnum;
  isPreferred: boolean;
  lastUsedAt: string | null;
}

export interface EnrollResult {
  factorId: string;
  setupData?: {
    otpauthUri?: string;
    secretBase32?: string;
  };
}

export interface ChallengeStarted {
  challengeId: string;
  factorType: MfaFactorTypeEnum;
  expiresAt: string;
}

export interface StepUpTokenIssued {
  token: string;
  jti: string;
  expiresAt: string;
  scope: string;
}

export interface BackupCodesResult {
  codes: string[];
}

export interface BackupCodesRemaining {
  remaining: number;
}

export interface TrustedDevice {
  id: string;
  userId: string;
  userAgent: string | null;
  ipFirstSeen: string | null;
  ipLastSeen: string | null;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

/**
 * Body returned by /api/auth/sign-in/email when MFA is required.
 * Better Auth wraps `APIError` body's `mfa` field plus the `code` and `message`.
 */
export interface MfaRequiredErrorBody {
  code: 'MFA_REQUIRED';
  message: 'MFA_REQUIRED';
  mfa: {
    attemptToken: string;
    availableFactors: MfaFactorTypeEnum[];
  };
}

export interface MfaEnrollRequiredErrorBody {
  code: 'MFA_ENROLL_REQUIRED';
  message: 'MFA_ENROLL_REQUIRED';
}

/** Thrown by signin mutation when the server requires an MFA challenge before issuing a session. */
export class SignInRequiresMfaError extends Error {
  readonly attemptToken: string;
  readonly availableFactors: MfaFactorTypeEnum[];
  constructor(attemptToken: string, availableFactors: MfaFactorTypeEnum[]) {
    super('MFA_REQUIRED');
    this.name = 'SignInRequiresMfaError';
    this.attemptToken = attemptToken;
    this.availableFactors = availableFactors;
  }
}

/** Thrown when the user must enrol MFA before sign-in (past grace deadline). */
export class SignInRequiresEnrollmentError extends Error {
  constructor() {
    super('MFA_ENROLL_REQUIRED');
    this.name = 'SignInRequiresEnrollmentError';
  }
}

/** Shape stashed in sessionStorage between /auth/signin and /auth/mfa-challenge. */
export interface MfaPendingLogin {
  /** Email or username — whatever the user typed on the signin form. */
  identifier: string;
  password: string;
  attemptToken: string;
  availableFactors: MfaFactorTypeEnum[];
  callbackUrl?: string;
}
