import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const SOURCE_KINDS = ['ip', 'webcam', 'file', 'upload'] as const;

export class SourceRequest {
  @ApiProperty({ enum: SOURCE_KINDS })
  @IsIn(SOURCE_KINDS)
  kind!: (typeof SOURCE_KINDS)[number];

  @ApiProperty({ description: 'rtsp/http URL, webcam number, video path, or uploaded file name' })
  @IsString()
  @MaxLength(1000)
  value!: string;
}

export class ViolationListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @IsIn(['new', 'ticketed', 'dismissed', 'all']) status?: string;
  @IsOptional() @IsString() @MaxLength(10) code?: string;
  @IsOptional() @IsMongoId() cameraId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() @MaxLength(60) search?: string;
}

export class ListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @IsString() @MaxLength(60) status?: string;
  @IsOptional() @IsString() @MaxLength(80) search?: string;
}

/** The passed-vehicle list: one camera, optionally one run of a surveillance box. */
export class PassedVehiclesQuery extends ListQuery {
  @IsOptional() @IsMongoId() cameraId?: string;
  @IsOptional() @IsString() @MaxLength(40) runId?: string;
}

export class UpdatePlateRequest {
  @ApiProperty({ example: 'Dhaka Metro-Ga 11-5431' })
  @IsString()
  @MaxLength(60)
  registration!: string;
}

export class DismissRequest {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class IssueTicketRequest {
  @ApiPropertyOptional({ description: 'Overrides the read plate' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  registration?: string;

  @ApiPropertyOptional({ description: 'Owner email when the vehicle is not in the registry' })
  @IsOptional()
  @IsEmail()
  ownerEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ownerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CameraRequest {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{2,20}$/, { message: 'code: 2-20 letters, digits, - or _' })
  code!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @ApiPropertyOptional({ type: SourceRequest })
  @IsOptional()
  @ValidateNested()
  @Type(() => SourceRequest)
  defaultSource?: SourceRequest;
  @ApiPropertyOptional({ description: 'Camera config: {frame_size, zones, lane_lines, peak_hours}' })
  @IsOptional()
  @IsObject()
  zones?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(5) @Max(150) speedLimitKph?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ZonesRequest {
  @ApiProperty({ description: 'Camera config: {frame_size, zones, lane_lines, peak_hours}' })
  @IsObject()
  zones!: Record<string, unknown>;
}

export class NetworkRequest {
  @ApiProperty({
    description:
      'Multi-camera tracking: {frameSize?: [w, h], gates: [{id, name, points: [[x, y], ...]}], ' +
      'links: [{fromGate, toCameraId, toGate, minS, maxS, distanceM?}]}',
  })
  @IsObject()
  network!: Record<string, unknown>;
}

export class AutoZonesRequest {
  @ApiPropertyOptional({ type: SourceRequest, description: "Video or stream to learn from (default: the camera's own)" })
  @IsOptional()
  @ValidateNested()
  @Type(() => SourceRequest)
  source?: SourceRequest;
}

export class FrameRequest {
  @ApiProperty({ type: SourceRequest })
  @ValidateNested()
  @Type(() => SourceRequest)
  source!: SourceRequest;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  atSec?: number;
}

export class VehicleRequest {
  @ApiProperty({ example: 'Dhaka Metro-Ga 11-5431' }) @IsString() @MinLength(4) @MaxLength(60) registration!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) vehicleClass?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) makeModel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) colour?: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) ownerName!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() ownerEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) ownerPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) ownerAddress?: string;
}

export class FineRequest {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(80) title!: string;
  @ApiProperty() @IsNumber() @Min(0) @Max(1_000_000) amount!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(365) dueDays!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) legalReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export const REVIEW_REASONS = ['wrong_vehicle', 'wrong_reading', 'not_me_driving', 'emergency', 'other'] as const;

export class ReviewRequest {
  @ApiProperty({ enum: REVIEW_REASONS }) @IsIn(REVIEW_REASONS) reason!: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(2000) details!: string;
}

export class ReviewDecisionRequest {
  @ApiProperty({ enum: ['accepted', 'rejected'] }) @IsIn(['accepted', 'rejected']) decision!: 'accepted' | 'rejected';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export const PAYMENT_METHODS = ['card', 'bkash', 'nagad', 'rocket'] as const;

export class PayRequest {
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) method!: (typeof PAYMENT_METHODS)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(23) cardNumber?: string;
  @ApiPropertyOptional({ example: '12/28' }) @IsOptional() @IsString() @MaxLength(7) cardExpiry?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4) cardCvc?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) cardName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(14) walletNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(6) walletPin?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) payerName?: string;
}

export class StartSurveillanceRequest {
  @ApiPropertyOptional() @IsOptional() @IsMongoId() cameraId?: string;

  @ApiPropertyOptional({ type: SourceRequest, description: "Default: the camera's own source" })
  @IsOptional()
  @ValidateNested()
  @Type(() => SourceRequest)
  source?: SourceRequest;

  @ApiPropertyOptional({ description: 'imgsz, tracker, rules, plateEvery, startSec, endSec, startTime' })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;
}
