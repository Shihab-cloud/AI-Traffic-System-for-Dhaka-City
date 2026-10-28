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
 * Mail-template purpose key. Mirrors `MfaChallengePurposeEnum` cases.
 * `MailService.sendMfaCode` keys templates on this value.
 */
export enum MfaMailPurposeEnum {
  LOGIN = 'LOGIN',
  STEP_UP = 'STEP_UP',
  ENROLL_VERIFY = 'ENROLL_VERIFY',
}

/**
 * Step-up scopes mark which sensitive action a step-up token authorizes.
 * Use the `MfaStepUpScope` type to keep usage type-safe at controller decorators.
 * Adding a new scope is one line here + one decorator at the call site.
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
  USER_RESET_MFA: 'USER:RESET_MFA',
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

export enum MfaAuditEventEnum {
  ENROLL = 'ENROLL',
  VERIFY_SUCCESS = 'VERIFY_SUCCESS',
  VERIFY_FAIL = 'VERIFY_FAIL',
  DISABLE = 'DISABLE',
  BACKUP_USED = 'BACKUP_USED',
  STEP_UP_ISSUED = 'STEP_UP_ISSUED',
  STEP_UP_CONSUMED = 'STEP_UP_CONSUMED',
  TRUST_DEVICE_ADDED = 'TRUST_DEVICE_ADDED',
  TRUST_DEVICE_REVOKED = 'TRUST_DEVICE_REVOKED',
  /** An admin tore down another user's MFA so they could get back in. */
  ADMIN_RESET = 'ADMIN_RESET',
}
