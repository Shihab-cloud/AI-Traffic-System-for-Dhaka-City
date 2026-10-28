export interface SystemSettingsResponse {
  mfaEnabled: boolean;
  emailVerificationEnabled: boolean;
  signupEnabled: boolean;
  updatedById: string | null;
  updatedAt: Date | null;
}

export interface PublicSystemSettingsResponse {
  mfaEnabled: boolean;
  emailVerificationEnabled: boolean;
  signupEnabled: boolean;
}
