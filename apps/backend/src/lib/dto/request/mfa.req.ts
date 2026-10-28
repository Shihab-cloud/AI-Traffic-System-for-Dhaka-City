import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MfaChallengePurposeEnum,
  MfaFactorTypeEnum,
  MfaStepUpScope,
} from 'src/shared/enums/mfa.enum';

export class EnrollFactorRequest {
  @ApiProperty({ enum: MfaFactorTypeEnum })
  @IsEnum(MfaFactorTypeEnum)
  type!: MfaFactorTypeEnum;
}

export class StartChallengeRequest {
  @ApiProperty({ description: 'Factor id chosen by the user.' })
  @IsString()
  factorId!: string;

  @ApiProperty({ enum: MfaChallengePurposeEnum })
  @IsEnum(MfaChallengePurposeEnum)
  purpose!: MfaChallengePurposeEnum;

  @ApiProperty({
    description:
      'For step-up purposes, the action scope (e.g. `payment_method:org:revoke`). Ignored otherwise.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  scope?: string;
}

export class VerifyChallengeRequest {
  @ApiProperty()
  @IsString()
  challengeId!: string;

  @ApiProperty({ description: 'TOTP / OTP / backup-code submitted by the user.' })
  @IsString()
  @MaxLength(64)
  code!: string;
}

export class StartStepUpRequest {
  @ApiProperty()
  @IsString()
  factorId!: string;

  @ApiProperty({ description: 'Action scope, e.g. `payment_method:org:revoke`.' })
  @IsString()
  @MaxLength(80)
  scope!: MfaStepUpScope;
}

export class VerifyStepUpRequest {
  @ApiProperty()
  @IsString()
  challengeId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  code!: string;
}

export class VerifyBackupCodeRequest {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  code!: string;
}

export class StartLoginChallengeRequest {
  @ApiProperty({
    description:
      'Opaque attempt token returned by /api/auth/sign-in/email when MFA_REQUIRED is thrown.',
  })
  @IsString()
  @MaxLength(128)
  attemptToken!: string;

  @ApiProperty({ enum: MfaFactorTypeEnum })
  @IsEnum(MfaFactorTypeEnum)
  factorType!: MfaFactorTypeEnum;
}

export class VerifyLoginChallengeRequest {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  attemptToken!: string;

  @ApiProperty()
  @IsString()
  challengeId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  code!: string;

  @ApiPropertyOptional({
    description:
      'Remember this browser, skipping the login challenge for 30 days. Ignored for roles with admin power — those are never eligible for device trust. Step-up always re-challenges regardless.',
  })
  @IsOptional()
  @IsBoolean()
  rememberDevice?: boolean;
}
