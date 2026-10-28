import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  SupportTicketCategoryEnum,
  SupportTicketPriorityEnum,
  SupportTicketStatusEnum,
} from 'src/shared/enums/support.enum';

/** Prefix every support upload is written under by `SupportUploadService`. */
const SUPPORT_KEY_PATTERN = /^support\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class MessageAttachmentRequest {
  /**
   * Constrained to the support prefix, not just "a non-empty string".
   *
   * This key is signed into a presigned GET when the ticket is read, so an
   * unconstrained value let any authenticated user name any object in the
   * bucket and have the API hand them a download URL for it.
   */
  @ApiProperty({ pattern: SUPPORT_KEY_PATTERN.source })
  @IsString()
  @IsNotEmpty()
  @Matches(SUPPORT_KEY_PATTERN, { message: 'fileKey must reference a support upload' })
  fileKey!: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;
}

export class CreateTicketRequest {
  @ApiProperty({ maxLength: 200 })
  @Transform(({ value }: { value: string }) => value?.trim())
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @ApiProperty({ minLength: 10 })
  @Transform(({ value }: { value: string }) => value?.trim())
  @IsString()
  @MinLength(10, { message: 'Description must be at least 10 characters' })
  description!: string;

  @ApiProperty({ enum: SupportTicketCategoryEnum })
  @IsEnum(SupportTicketCategoryEnum)
  category!: SupportTicketCategoryEnum;

  @ApiPropertyOptional({ enum: SupportTicketPriorityEnum })
  @IsOptional()
  @IsEnum(SupportTicketPriorityEnum)
  priority?: SupportTicketPriorityEnum;

  @ApiPropertyOptional({ type: [MessageAttachmentRequest] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentRequest)
  attachments?: MessageAttachmentRequest[];
}

export class CreateMessageRequest {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: string }) => value?.trim())
  @IsString()
  content?: string;

  @ApiPropertyOptional({ type: [MessageAttachmentRequest] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentRequest)
  attachments?: MessageAttachmentRequest[];
}

export class GetSupportPresignedUrlRequest {
  @ApiProperty({ maxLength: 255 })
  @Transform(({ value }: { value: string }) => value?.trim())
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ description: 'MIME type of the file' })
  @IsString()
  @IsNotEmpty()
  mimeType!: string;
}

export class CompleteSupportUploadRequest {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fileKey!: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;
}

export class UpdateTicketRequest {
  @ApiPropertyOptional({ enum: SupportTicketStatusEnum })
  @IsOptional()
  @IsEnum(SupportTicketStatusEnum)
  status?: SupportTicketStatusEnum;

  @ApiPropertyOptional({ enum: SupportTicketPriorityEnum })
  @IsOptional()
  @IsEnum(SupportTicketPriorityEnum)
  priority?: SupportTicketPriorityEnum;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(({ value }: { value: string }) => value?.trim())
  @IsString()
  @MaxLength(100)
  assignedTo?: string;
}
