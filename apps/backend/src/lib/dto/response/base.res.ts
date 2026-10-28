import { Expose, Transform } from 'class-transformer';

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Exposes a Mongoose ObjectId reference as a string.
 *
 * `ResponseSerializerInterceptor` uses `plainToInstance`, which copies an ObjectId's
 * enumerable properties instead of calling its `toJSON`. So a plain `@Expose()` on a ref
 * field typed `string` reaches the client as an **object**, and any `===` comparison
 * against an id string on the frontend silently fails. Use this for every ObjectId ref
 * in a response DTO.
 */
export const ExposeObjectId = () =>
  applyDecorators(
    Expose(),
    // Reads `obj[key]`, not `value`: by the time the callback runs, class-transformer has
    // already flattened the ObjectId, so `value` stringifies to '[object Object]'. The
    // source object still holds the real ObjectId. Same reason `BaseResponse.id` uses `obj`.
    Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
      const raw = obj?.[key];
      if (raw == null) return null;
      if (typeof raw === 'string') return raw;
      const objectId = raw as { toHexString?: () => string };
      return typeof objectId.toHexString === 'function' ? objectId.toHexString() : null;
    }),
  );

export class BaseResponse {
  @ApiProperty({ name: 'id' })
  @Expose({ name: 'id' })
  @Transform(({ obj }: { obj: { _id?: unknown; id?: string } }) => obj._id?.toString() || obj.id)
  id!: string;

  @ApiProperty({ type: Date })
  @Expose()
  createdAt!: Date;

  @ApiProperty({ type: Date })
  @Expose()
  updatedAt!: Date;
}

export abstract class PaginatedResponse<T> {
  @ApiProperty()
  @Expose()
  limit!: number;

  @ApiProperty()
  @Expose()
  hasPrevPage!: boolean;

  @ApiProperty()
  @Expose()
  hasNextPage!: boolean;

  @ApiProperty()
  @Expose()
  page!: number;

  @ApiProperty()
  @Expose()
  totalPages!: number;

  @ApiProperty()
  @Expose()
  offset!: number;

  @ApiProperty()
  @Expose()
  prevPage!: number;

  @ApiProperty()
  @Expose()
  nextPage!: number;

  @ApiProperty()
  @Expose()
  pagingCounter!: number;

  @ApiProperty({ name: 'totalData' })
  @Expose({ name: 'totalData' })
  @Transform(({ obj }: { obj: { totalDocs?: number } }) => obj['totalDocs'])
  totalDocs!: number;

  @ApiProperty({ isArray: true, name: 'data' })
  @Expose({ name: 'data' })
  @Transform(({ obj }: { obj: { docs?: unknown[] } }) => obj['docs'])
  abstract docs: T[];
}
