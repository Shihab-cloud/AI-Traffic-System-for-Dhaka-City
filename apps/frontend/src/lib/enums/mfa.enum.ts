/**
 * Frontend mirrors of backend MFA enums (apps/backend/src/shared/enums/mfa.enum.ts).
 * Values must match the backend exactly.
 */

export enum MfaFactorTypeEnum {
  TOTP = 'TOTP',
  EMAIL_OTP = 'EMAIL_OTP',
  BACKUP_CODE = 'BACKUP_CODE',
}

export enum MfaFactorStatusEnum {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}

export enum MfaChallengePurposeEnum {
  LOGIN = 'LOGIN',
  STEP_UP = 'STEP_UP',
  ENROLL_VERIFY = 'ENROLL_VERIFY',
}

/**
 * Step-up scope identifiers — kept as a const object (not enum) so call sites
 * preserve literal types and the colon-separated values stay readable.
 */
export const MfaStepUpScope = {
  // RBAC
  ROLE_CREATE: 'RBAC:ROLE:CREATE',
  ROLE_UPDATE: 'RBAC:ROLE:UPDATE',
  ROLE_DELETE: 'RBAC:ROLE:DELETE',

  // User management (acting on others)
  USER_DELETE: 'USER:DELETE',
  USER_BAN: 'USER:BAN',
  USER_REVOKE_SESSIONS: 'USER:REVOKE_SESSIONS',
  USER_RESET_CREDENTIALS: 'USER:RESET_CREDENTIALS',
  USER_ADMIN_CREATE: 'USER:ADMIN_CREATE',

  // Self-protective
  ACCOUNT_PASSWORD_CHANGE: 'ACCOUNT:PASSWORD_CHANGE',
  ACCOUNT_EMAIL_CHANGE: 'ACCOUNT:EMAIL_CHANGE',
  ACCOUNT_DISABLE_MFA: 'ACCOUNT:DISABLE_MFA',
  ACCOUNT_REGEN_BACKUP_CODES: 'ACCOUNT:REGEN_BACKUP_CODES',

  // Reset-password landing page (when MFA is enrolled)
  ACCOUNT_PASSWORD_RESET: 'ACCOUNT:PASSWORD_RESET',
} as const;

export type MfaStepUpScope = (typeof MfaStepUpScope)[keyof typeof MfaStepUpScope];

/**
 * Stage of the forced-enrollment page (`/auth/mfa-setup`).
 */
export enum MfaSetupMode {
  PICK = 'PICK',
  TOTP = 'TOTP',
  EMAIL_OTP = 'EMAIL_OTP',
}

/**
 * Stage of the in-settings enrollment widget (MfaSettings).
 * `CLOSED` is the resting state where the user sees the factor list, not an
 * enrollment flow.
 */
export enum MfaEnrollMode {
  CLOSED = 'CLOSED',
  PICK = 'PICK',
  TOTP = 'TOTP',
  EMAIL_OTP = 'EMAIL_OTP',
}
