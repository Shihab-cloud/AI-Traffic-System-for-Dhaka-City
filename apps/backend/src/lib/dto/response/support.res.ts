import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { SupportTicketLogDetails } from 'src/lib/types/support.types';
import {
  SupportTicketCategoryEnum,
  SupportTicketLogTypeEnum,
  SupportTicketPriorityEnum,
  SupportTicketStatusEnum,
} from 'src/shared/enums/support.enum';
import { BaseResponse, ExposeObjectId, PaginatedResponse } from './base.res';

export class SupportMessageFileResponse {
  @ApiProperty()
  @Expose()
  fileName!: string;

  @ApiProperty()
  @Expose()
  url!: string;
}

export class SupportFileUploadUrlResponse {
  @ApiProperty()
  @Expose()
  presignedUrl!: string;

  @ApiProperty()
  @Expose()
  key!: string;
}

export class SupportUploadConfirmResponse {
  @ApiProperty()
  @Expose()
  fileKey!: string;

  @ApiProperty()
  @Expose()
  fileName!: string;
}

export class SupportTicketLogPerformerResponse {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  role!: string | null;
}

export class SupportTicketLogResponse {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty({ enum: SupportTicketLogTypeEnum })
  @Expose()
  type!: SupportTicketLogTypeEnum;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  message!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  details!: SupportTicketLogDetails | null;

  @ApiProperty({ type: Date })
  @Expose()
  createdAt!: Date;

  @ApiPropertyOptional({ nullable: true, type: SupportTicketLogPerformerResponse })
  @Expose()
  @Type(() => SupportTicketLogPerformerResponse)
  performedBy!: SupportTicketLogPerformerResponse | null;

  @ApiProperty({ type: [SupportMessageFileResponse] })
  @Expose()
  @Type(() => SupportMessageFileResponse)
  attachments!: SupportMessageFileResponse[];
}

export class SupportTicketResponse extends BaseResponse {
  @ApiProperty()
  @Expose()
  ticketNumber!: string;

  @ApiProperty()
  @ExposeObjectId()
  submittedById!: string;

  @ApiProperty()
  @Expose()
  submittedByName!: string;

  @ApiProperty()
  @Expose()
  submittedByRole!: string;

  @ApiProperty({ enum: SupportTicketCategoryEnum })
  @Expose()
  category!: SupportTicketCategoryEnum;

  @ApiProperty({ enum: SupportTicketPriorityEnum })
  @Expose()
  priority!: SupportTicketPriorityEnum;

  @ApiProperty({ enum: SupportTicketStatusEnum })
  @Expose()
  status!: SupportTicketStatusEnum;

  @ApiProperty()
  @Expose()
  subject!: string;

  @ApiProperty()
  @Expose()
  description!: string;

  @ApiProperty()
  @Expose()
  assignedTo!: string;

  @ApiPropertyOptional({ type: Date, nullable: true })
  @Expose()
  lastResponseAt!: Date | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  @Expose()
  resolvedAt!: Date | null;
}

export class SupportTicketDetailResponse extends SupportTicketResponse {
  @ApiProperty({ type: [SupportTicketLogResponse] })
  @Expose()
  @Type(() => SupportTicketLogResponse)
  logs!: SupportTicketLogResponse[];
}

export class PaginatedSupportTicketResponse extends PaginatedResponse<SupportTicketResponse> {
  @ApiProperty({ type: SupportTicketResponse, isArray: true })
  @Type(() => SupportTicketResponse)
  docs!: SupportTicketResponse[];
}
