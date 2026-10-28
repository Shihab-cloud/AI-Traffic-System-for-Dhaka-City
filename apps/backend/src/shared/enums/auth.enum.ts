/**
 * Authentication Method Reference values surfaced in the `amr` claim.
 *   - `PWD`            : password verified
 *   - `TOTP`           : TOTP factor satisfied at login (AAL2)
 *   - `EMAIL_OTP`      : Email OTP factor satisfied at login (AAL2)
 *   - `BACKUP_CODE`    : recovery code consumed (AAL2, but flag for follow-up)
 *   - `TRUSTED_DEVICE` : login challenge skipped via trusted-device cookie
 *
 * Member keys follow CONSTANT_CASE; string values are locked by RFC 8176
 * and Better Auth conventions and stay lowercase.
 */
export enum AmrEnum {
  PWD = 'pwd',
  TOTP = 'totp',
  EMAIL_OTP = 'email_otp',
  BACKUP_CODE = 'backup_code',
  TRUSTED_DEVICE = 'trusted_device',
}
