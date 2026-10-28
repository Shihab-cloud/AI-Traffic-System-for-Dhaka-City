import { Expose } from 'class-transformer';

import { ApiProperty } from '@nestjs/swagger';
import {
  MfaChallengePurposeEnum,
  MfaFactorStatusEnum,
  MfaFactorTypeEnum,
} from 'src/shared/enums/mfa.enum';

export class ChallengeStartedResponse {
  @ApiProperty()
  @Expose()
  challengeId!: string;

  @ApiProperty({ enum: MfaFactorTypeEnum })
  @Expose()
  factorType!: MfaFactorTypeEnum;

  @ApiProperty({ type: Date })
  @Expose()
  expiresAt!: Date;
}

export class MfaOkResponse {
  @ApiProperty({ default: true })
  @Expose()
  ok!: true;
}

export class ListedFactorResponse {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty({ enum: MfaFactorTypeEnum })
  @Expose()
  type!: MfaFactorTypeEnum;

  @ApiProperty({ enum: MfaFactorStatusEnum })
  @Expose()
  status!: MfaFactorStatusEnum;

  @ApiProperty()
  @Expose()
  isPreferred!: boolean;

  @ApiProperty({ type: Date, nullable: true })
  @Expose()
  lastUsedAt!: Date | null;
}

export class FactorEnrollSetupDataResponse {
  @ApiProperty({ required: false })
  @Expose()
  otpauthUri?: string;

  @ApiProperty({ required: false })
  @Expose()
  secretBase32?: string;
}

export class FactorEnrollResponse {
  @ApiProperty()
  @Expose()
  factorId!: string;

  @ApiProperty({ type: FactorEnrollSetupDataResponse, required: false })
  @Expose()
  setupData?: FactorEnrollSetupDataResponse;
}

export class VerifyChallengeResponse {
  @ApiProperty({ default: true })
  @Expose()
  ok!: true;

  @ApiProperty({ enum: MfaFactorTypeEnum, required: false })
  @Expose()
  factorType?: MfaFactorTypeEnum;

  @ApiProperty({ enum: MfaChallengePurposeEnum, required: false })
  @Expose()
  purpose?: MfaChallengePurposeEnum;
}

export class StepUpTokenResponse {
  @ApiProperty()
  @Expose()
  token!: string;

  @ApiProperty()
  @Expose()
  jti!: string;

  @ApiProperty({ type: Date })
  @Expose()
  expiresAt!: Date;

  @ApiProperty()
  @Expose()
  scope!: string;
}

export class BackupCodesResponse {
  @ApiProperty({ type: String, isArray: true })
  @Expose()
  codes!: string[];
}

export class BackupCodeVerifyResponse {
  @ApiProperty({ default: true })
  @Expose()
  ok!: true;

  @ApiProperty()
  @Expose()
  remaining!: number;
}

export class BackupCodesRemainingResponse {
  @ApiProperty()
  @Expose()
  remaining!: number;
}

export class TrustedDeviceResponse {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  userId!: string;

  @ApiProperty()
  @Expose()
  deviceFingerprintHash!: string;

  @ApiProperty({ type: String, nullable: true })
  @Expose()
  userAgent!: string | null;

  @ApiProperty({ type: String, nullable: true })
  @Expose()
  ipFirstSeen!: string | null;

  @ApiProperty({ type: String, nullable: true })
  @Expose()
  ipLastSeen!: string | null;

  @ApiProperty({ type: Date, nullable: true })
  @Expose()
  lastUsedAt!: Date | null;

  @ApiProperty({ type: Date })
  @Expose()
  expiresAt!: Date;

  @ApiProperty({ type: Date, nullable: true })
  @Expose()
  revokedAt!: Date | null;

  @ApiProperty({ type: Date })
  @Expose()
  createdAt!: Date;
}
