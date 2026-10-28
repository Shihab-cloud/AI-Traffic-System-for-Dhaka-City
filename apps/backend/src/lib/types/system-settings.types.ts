/**
 * Canonical shape of the instance-wide system settings blob. Persisted as a
 * single JSON document (`system_settings.data`) so new flags can be added here
 * without a schema migration — keep this the source of truth and mirror it on
 * the frontend (`lib/types/system-settings.types.ts`).
 *
 * Every flag MUST have a default in {@link DEFAULT_SYSTEM_SETTINGS}; reads merge
 * the persisted blob over these defaults so a missing key never reads as
 * `undefined`.
 */
export interface SystemSettingsData {
  /**
   * When `false` (default) users cannot enroll new MFA factors and the setup UI
   * is hidden. Already-enrolled users keep their factors and are still
   * challenged at login — disabling never removes stored factors.
   */
  mfaEnabled: boolean;
  /**
   * When `false` (default) verification emails are not sent. When `true` they
   * are sent (the pre-existing soft behaviour); verification is not made
   * mandatory for app access either way.
   */
  emailVerificationEnabled: boolean;
  /**
   * Defaults to `true` so existing always-open behaviour is preserved. When
   * `false`, `POST /sign-up/email` is refused with `SIGNUP_DISABLED`.
   * Admin-provisioned users and social sign-in are unaffected.
   */
  signupEnabled: boolean;
}

/**
 * Defaults applied when a key is absent from the persisted blob. `mfaEnabled`
 * and `emailVerificationEnabled` are off; `signupEnabled` is on (see its doc
 * comment above for why).
 */
export const DEFAULT_SYSTEM_SETTINGS: SystemSettingsData = {
  mfaEnabled: false,
  emailVerificationEnabled: false,
  signupEnabled: true,
};

/** Full settings record as returned to admins (flags + audit metadata). */
export interface SystemSettingsRecord extends SystemSettingsData {
  updatedById: string | null;
  updatedAt: Date | null;
}
