import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { FaqAudienceEnum } from 'src/shared/enums/faq.enum';
import { BaseResponse, PaginatedResponse } from './base.res';

export class FaqResponse extends BaseResponse {
  @ApiProperty()
  @Expose()
  question!: string;

  @ApiProperty()
  @Expose()
  answer!: string;

  @ApiProperty()
  @Expose()
  category!: string;

  @ApiProperty({ enum: FaqAudienceEnum, isArray: true })
  @Expose()
  audience!: FaqAudienceEnum[];

  @ApiProperty()
  @Expose()
  isPublished!: boolean;

  @ApiProperty()
  @Expose()
  displayOrder!: number;
}

export class PaginatedFaqResponse extends PaginatedResponse<FaqResponse> {
  @ApiProperty({ type: FaqResponse, isArray: true })
  @Type(() => FaqResponse)
  docs!: FaqResponse[];
}
