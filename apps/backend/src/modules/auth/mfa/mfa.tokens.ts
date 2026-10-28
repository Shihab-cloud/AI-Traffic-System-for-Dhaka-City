/**
 * DI tokens for the MFA module.
 *
 * Kept in a separate file so consumer files don't need to import from
 * mfa.module.ts (which would create a cycle when the module imports its own
 * services).
 */
export const MFA_FACTOR_ADAPTERS = Symbol('MFA_FACTOR_ADAPTERS');
export const MFA_KMS_ADAPTER = Symbol('MFA_KMS_ADAPTER');
