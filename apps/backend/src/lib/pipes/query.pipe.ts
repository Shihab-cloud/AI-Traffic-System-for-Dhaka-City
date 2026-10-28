import * as qs from 'qs';

import { Injectable, PipeTransform } from '@nestjs/common';
import {
  MongoQueryValue,
  PaginationQueryDto,
  PaginationQueryOptions,
} from '../../shared/dtos/query.dto';

import { MongoQueryBuilder } from 'src/utils/mongo-query-builder';

/** Page size when none is supplied. */
const DEFAULT_PAGE_SIZE = 10;

/**
 * Hard ceiling on `?limit=`. Callers asking for more get this instead.
 *
 * Generous enough for a "load everything" dropdown, small enough that a single
 * request cannot pull a whole collection into memory.
 */
const MAX_PAGE_SIZE = 200;

/** A field name or dotted path, with no Mongo operator syntax in it. */
function isPlainFieldPath(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(key);
}

@Injectable()
export class QueryTransformPipe implements PipeTransform {
  transform(query: PaginationQueryOptions): PaginationQueryDto {
    const page = this.transformPage(query.page);
    const limit = this.transformLimit(query.limit);
    const sortBy = this.transformSortBy(query.sortBy);
    const filter = this.transformFilter(query.filter);
    const search = query.search;

    return {
      page,
      limit,
      sortBy,
      filter,
      search,
    };
  }

  private transformSortBy(sortBy?: string | string[]): Record<string, 1 | -1> {
    const NEWEST_FIRST: Record<string, 1 | -1> = { createdAt: -1 };
    if (!sortBy) return NEWEST_FIRST;

    if (typeof sortBy === 'string') {
      sortBy = [sortBy];
    }

    const sort = sortBy.reduce<Record<string, 1 | -1>>((acc, curr) => {
      for (const [key, value] of Object.entries(qs.parse(curr))) {
        // The parsed key goes straight into `$sort`. A `$`- or dot-prefixed one
        // is an operator path, not a field, and reaches the driver as a
        // malformed stage — so it is dropped rather than passed along.
        if (!isPlainFieldPath(key)) continue;
        acc[key] = value === 'desc' ? -1 : 1;
      }
      return acc;
    }, {});

    return Object.keys(sort).length > 0 ? sort : NEWEST_FIRST;
  }

  private transformFilter(filter: string | string[] | undefined): Record<string, MongoQueryValue> {
    if (!filter) return {};

    if (typeof filter === 'string') {
      filter = [filter];
    }

    // Combine all parsed filter strings into a single object
    const combinedFilter = filter.reduce(
      (acc, curr) => {
        const parsed = qs.parse(curr);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return { ...acc, ...(parsed as Record<string, unknown>) };
        }
        return acc;
      },
      {} as Record<string, unknown>,
    );
    return MongoQueryBuilder.build(combinedFilter);
  }

  private transformPage(page: number | undefined) {
    return page && parseInt(page.toString(), 10) > 0 ? parseInt(page.toString(), 10) : 1;
  }

  private transformLimit(limit: number | undefined) {
    const parsed = limit ? parseInt(limit.toString(), 10) : NaN;
    if (!parsed || parsed <= 0) return DEFAULT_PAGE_SIZE;
    // Clamped, not rejected: without a ceiling, `?limit=1000000` materialises
    // a whole collection through two `$lookup` stages with no `allowDiskUse`.
    return Math.min(parsed, MAX_PAGE_SIZE);
  }
}
