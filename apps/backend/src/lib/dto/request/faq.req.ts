import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { FaqAudienceEnum } from 'src/shared/enums/faq.enum';

export class CreateFaqRequest {
  @ApiProperty({ maxLength: 500 })
  @Transform(({ value }: { value: string }) => value?.trim())
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  question!: string;

  @ApiProperty({ maxLength: 10000 })
  @Transform(({ value }: { value: string }) => value?.trim())
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  answer!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(({ value }: { value: string }) => value?.trim())
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ enum: FaqAudienceEnum, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(FaqAudienceEnum, { each: true })
  audience?: FaqAudienceEnum[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdateFaqRequest extends PartialType(CreateFaqRequest) {}

class FaqReorderItemReq {
  @ApiProperty()
  @IsMongoId()
  id!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder!: number;
}

export class FaqsReorderItemsRequest {
  @ApiProperty({ type: [FaqReorderItemReq] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FaqReorderItemReq)
  faqItems!: FaqReorderItemReq[];
}
