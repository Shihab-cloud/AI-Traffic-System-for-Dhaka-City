import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

/**
 * Full system settings view for admins — the flags plus audit metadata
 * (who changed them last and when). Returned by the admin-only GET/PATCH.
 */
export class SystemSettingsResponse {
  @ApiProperty()
  @Expose()
  mfaEnabled!: boolean;

  @ApiProperty()
  @Expose()
  emailVerificationEnabled!: boolean;

  @ApiProperty()
  @Expose()
  signupEnabled!: boolean;

  @ApiProperty({ nullable: true })
  @Expose()
  updatedById!: string | null;

  @ApiProperty({ type: Date, nullable: true })
  @Expose()
  updatedAt!: Date | null;
}

/**
 * Client-relevant flags only — no audit metadata. Readable without
 * authentication (the register and sign-in pages read these before login)
 * so the frontend can hide setup screens, banners, and alerts for any
 * capability that is currently turned off.
 */
export class PublicSystemSettingsResponse {
  @ApiProperty()
  @Expose()
  mfaEnabled!: boolean;

  @ApiProperty()
  @Expose()
  emailVerificationEnabled!: boolean;

  @ApiProperty()
  @Expose()
  signupEnabled!: boolean;
}
