import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export type MongoPrimitiveValue = string | number | boolean | Date | null | undefined;

export type MongoQueryOperators = {
  $eq?: MongoPrimitiveValue;
  $ne?: MongoPrimitiveValue | MongoPrimitiveValue[];
  $gt?: number | Date;
  $gte?: number | Date;
  $lt?: number | Date;
  $lte?: number | Date;
  $regex?: string;
  $options?: string;
  $exists?: boolean;
  $in?: MongoPrimitiveValue[];
  $all?: MongoPrimitiveValue[];
};

export type MongoQueryValue =
  | MongoPrimitiveValue
  | MongoQueryOperators
  | { [key: string]: MongoQueryValue } // A general MongoDB query object (e.g., { fieldName: { $gt: 5 }, otherField: 'value' })
  | MongoQueryValue[]; // An array of MongoQueryValue (e.g., for $and: [{}, {}], or a field value like { tags: ['tag1', 'tag2'] })

export class PaginationQueryOptions {
  @ApiPropertyOptional({
    default: 1,
    example: 1,
    description: 'Page number (starts from 1)',
  })
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({
    default: 10,
    example: 10,
    description: 'Number of items per page',
  })
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    description: `Sort by field. Examples:
- Single ascending: title
- Single descending: createdAt=desc
- Multiple fields: priority, createdAt=desc (as array)`,
    example: 'createdAt=desc',
  })
  @Type(() => String)
  sortBy?: string | string[];

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    description: `Filter criteria. Format: field[$operator]=value
Operators (material-react-table compatible):
- Comparison: $equals, $weakEquals, $notEquals, $greaterThan, $greaterThanOrEqualTo, $lessThan, $lessThanOrEqualTo
- Range: $between, $betweenInclusive, $inNumberRange
- String: $contains, $fuzzy, $startsWith, $endsWith, $includesString, $includesStringSensitive, $equalsString
- Array: $arrIncludes, $arrIncludesAll, $arrIncludesSome
- Existence: $empty, $notEmpty
Examples:
- Simple equality: status=active
- Comparison: priority[$greaterThan]=3
- String search: name[$contains]=john
- Date range: createdAt[$between]=2024-01-01,2024-12-31`,
    example: 'status=active',
  })
  @Type(() => String)
  filter?: string | string[];

  @ApiPropertyOptional({
    example: 'search query',
    description: 'Search across text fields',
  })
  @Type(() => String)
  search?: string;
}

export interface PaginationQueryDto {
  page: number;
  limit: number;
  sortBy?: { [key: string]: -1 | 1 };
  filter?: Record<string, MongoQueryValue>;
  search?: string;
}
