import {
  MongoPrimitiveValue,
  MongoQueryOperators,
  MongoQueryValue,
} from '../shared/dtos/query.dto';
import { getSearchFields } from './search-registry';

/** A decorated mongoose schema class (e.g. `SupportTicket`). */
type SchemaClass = abstract new (...args: never[]) => unknown;

/** Input query node with field conditions */
type QueryNode = Record<string, unknown>;

/** MongoDB filter document output */
type MongoFilter = Record<string, MongoQueryValue>;

/** Operator handler context with utility functions */
type OperatorContext = {
  cast: (v: unknown) => MongoPrimitiveValue;
  castArray: (v: unknown) => MongoPrimitiveValue[];
  escapeRegex: (v: string) => string;
};

/** Operator handler function signature */
type OperatorHandler = (target: MongoQueryOperators, value: unknown, ctx: OperatorContext) => void;

/** ISO 8601 date pattern for explicit date detection */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Escapes special regex characters so user input is matched literally.
 * Use on every user-supplied value that lands in a `$regex` (services included) —
 * mirrors backend-drizzle's `escapeLike` so search behaves identically on both backends.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Allowed operators mapped from material-react-table filter functions.
 * Each operator maps directly to its MongoDB handler function.
 *
 * Supported operators (with $ prefix):
 * - Comparison: $equals, $weakEquals, $notEquals, $greaterThan, $greaterThanOrEqualTo, $lessThan, $lessThanOrEqualTo
 * - Range: $between, $betweenInclusive, $inNumberRange
 * - String: $contains, $fuzzy, $startsWith, $endsWith, $includesString, $includesStringSensitive, $equalsString
 * - Array: $arrIncludes, $arrIncludesAll, $arrIncludesSome
 * - Existence: $empty, $notEmpty
 */
const operators: Record<string, OperatorHandler> = {
  // Comparison operators
  $equals: (target, value, { cast }) => {
    target.$eq = cast(value);
  },
  $weakEquals: (target, value, { cast }) => {
    target.$eq = cast(value);
  },
  $notEquals: (target, value, { cast }) => {
    target.$ne = cast(value);
  },
  $greaterThan: (target, value, { cast }) => {
    target.$gt = cast(value) as number | Date;
  },
  $greaterThanOrEqualTo: (target, value, { cast }) => {
    target.$gte = cast(value) as number | Date;
  },
  $lessThan: (target, value, { cast }) => {
    target.$lt = cast(value) as number | Date;
  },
  $lessThanOrEqualTo: (target, value, { cast }) => {
    target.$lte = cast(value) as number | Date;
  },

  // Range operators
  // $between is EXCLUSIVE (mirrors MRT's `between` and drizzle's gt/lt mapping);
  // $betweenInclusive/$inNumberRange are the inclusive variants.
  $between: (target, value, { cast }) => {
    if (Array.isArray(value) && value.length === 2) {
      target.$gt = cast(value[0]) as number | Date;
      target.$lt = cast(value[1]) as number | Date;
    }
  },
  $betweenInclusive: (target, value, { cast }) => {
    if (Array.isArray(value) && value.length === 2) {
      target.$gte = cast(value[0]) as number | Date;
      target.$lte = cast(value[1]) as number | Date;
    }
  },
  $inNumberRange: (target, value, { cast }) => {
    if (Array.isArray(value) && value.length === 2) {
      target.$gte = cast(value[0]) as number | Date;
      target.$lte = cast(value[1]) as number | Date;
    }
  },

  // String operators (case-insensitive)
  $contains: (target, value, { escapeRegex }) => {
    target.$regex = escapeRegex(String(value));
    target.$options = 'i';
  },
  $fuzzy: (target, value, { escapeRegex }) => {
    target.$regex = escapeRegex(String(value));
    target.$options = 'i';
  },
  $startsWith: (target, value, { escapeRegex }) => {
    target.$regex = `^${escapeRegex(String(value))}`;
    target.$options = 'i';
  },
  $endsWith: (target, value, { escapeRegex }) => {
    target.$regex = `${escapeRegex(String(value))}$`;
    target.$options = 'i';
  },
  $includesString: (target, value, { escapeRegex }) => {
    target.$regex = escapeRegex(String(value));
    target.$options = 'i';
  },
  $equalsString: (target, value, { escapeRegex }) => {
    target.$regex = `^${escapeRegex(String(value))}$`;
    target.$options = 'i';
  },

  // String operators (case-sensitive)
  $includesStringSensitive: (target, value, { escapeRegex }) => {
    target.$regex = escapeRegex(String(value));
  },

  // Array operators
  $arrIncludes: (target, value, { castArray }) => {
    target.$in = castArray(value);
  },
  $arrIncludesAll: (target, value, { castArray }) => {
    target.$all = castArray(value);
  },
  $arrIncludesSome: (target, value, { castArray }) => {
    target.$in = castArray(value);
  },

  // Existence operators
  // `$eq: null` matches BOTH a missing key and an explicit null — the parity
  // equivalent of drizzle's `IS NULL` ($exists:false alone misses explicit nulls).
  $empty: (target) => {
    target.$eq = null;
  },
  $notEmpty: (target) => {
    target.$exists = true;
    target.$ne = null;
  },
};

/**
 * Converts a material-react-table query DSL into MongoDB filter documents.
 *
 * @example
 * ```ts
 * const filter = MongoQueryBuilder.build({
 *   status: "active",
 *   priority: { $greaterThan: 3 },
 *   name: { $contains: "john" },
 *   tags: { $arrIncludes: ["urgent"] },
 *   createdAt: { $between: ["2024-01-01", "2024-12-31"] }
 * });
 * // Result:
 * // {
 * //   status: "active",
 * //   priority: { $gt: 3 },
 * //   name: { $regex: "john", $options: "i" },
 * //   tags: { $in: ["urgent"] },
 * //   createdAt: { $gte: Date, $lte: Date }
 * // }
 * ```
 */
export class MongoQueryBuilder {
  /**
   * Builds a MongoDB filter from a query DSL object
   * @param query - The query object with custom operators
   * @returns MongoDB-compatible filter document
   */
  static build(query: QueryNode): MongoFilter {
    return this.parseNode(query);
  }

  /**
   * Builds a `$or` search clause over the fields registered for the schema
   * (see `registerSearchFields` in the schema file). The ONLY sanctioned way
   * to turn `?search=` into a match clause — escaping is applied here, so
   * services never hand-build `$regex` patterns.
   *
   * Returns `{}` when the term is blank or the schema has no registered
   * fields, so it can be unconditionally spread into a `$match`.
   */
  static buildSearch(search: string | undefined, schemaClass: SchemaClass): MongoFilter {
    const term = search?.trim();
    const fields = getSearchFields(schemaClass);
    if (!term || !fields?.length) return {};

    const regex = { $regex: escapeRegex(term), $options: 'i' as const };
    return { $or: fields.map((field) => ({ [field]: regex })) };
  }

  /**
   * Parses a flat query node into MongoDB filter format
   */
  private static parseNode(node: QueryNode): MongoFilter {
    const mongo: MongoFilter = {};

    for (const key in node) {
      this.processField(key, node[key], mongo);
    }

    return mongo;
  }

  /**
   * Processes a single field and its value/operators
   */
  private static processField(field: string, value: unknown, mongo: MongoFilter): void {
    // Reject field names that are Mongo operators or dotted paths. The DSL only
    // ever supplies plain field names as keys ($-operators live INSIDE a field's
    // value object and pass through the `operators` whitelist below). A key like
    // `$where` / `$expr` / `$function` here would otherwise land verbatim in the
    // filter and execute server-side JS — a NoSQL injection vector reachable from
    // any user-supplied `?filter=` string.
    if (field.startsWith('$') || field.includes('.')) return;

    // Handle operator object (e.g., { $greaterThan: 5, $lessThan: 10 })
    if (this.isObject(value)) {
      const compiled: MongoQueryOperators = {};
      const ctx: OperatorContext = {
        // Arrow wrappers instead of `.bind()` — with `strictBindCallApply`
        // disabled in tsconfig, `.bind()` erases the signature to `any`.
        cast: (v: unknown) => this.cast(v),
        castArray: (v: unknown) => this.castArray(v),
        escapeRegex,
      };

      for (const op in value) {
        const handler = operators[op];
        if (!handler) continue;

        handler(compiled, value[op], ctx);
      }

      if (Object.keys(compiled).length > 0) {
        mongo[field] = compiled;
      }
      return;
    }

    // Direct value assignment (equality)
    mongo[field] = this.cast(value);
  }

  /**
   * Type-safe object check (excludes null and arrays)
   */
  private static isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * Casts a string value to its appropriate type.
   *
   * Priority:
   * 1. Boolean strings ("true"/"false")
   * 2. Numbers (only pure numeric strings)
   * 3. ISO 8601 dates (explicit format check to avoid false positives)
   * 4. Original value (passthrough)
   */
  private static cast(value: unknown): MongoPrimitiveValue {
    // Already a primitive, return as-is
    if (value === null) return null;
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value;

    // String parsing
    if (typeof value === 'string') {
      const trimmed = value.trim();

      // Boolean strings
      if (trimmed === 'true') return true;
      if (trimmed === 'false') return false;

      // Numeric strings (must be pure numbers, not dates like "2024")
      if (trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed)) {
        return Number(trimmed);
      }

      // ISO 8601 date strings only (avoids false positives)
      if (ISO_DATE_PATTERN.test(trimmed)) {
        const parsed = Date.parse(trimmed);
        if (!isNaN(parsed)) {
          return new Date(parsed);
        }
      }

      return trimmed;
    }

    // Remaining primitives (bigint, symbol) — safe to coerce.
    if (typeof value === 'bigint' || typeof value === 'symbol') {
      return String(value);
    }

    // Residual non-primitives (arrays, plain objects, functions) keep the
    // legacy String() coercion for exact runtime parity (arrays join with
    // ',', objects become '[object Object]'). `value` is `unknown` here and
    // cannot be narrowed further — a true typing gap.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- intentional coercion of unknown non-primitive filter values
    return String(value);
  }

  /**
   * Casts an array of values, applying type conversion to each element
   */
  private static castArray(value: unknown): MongoPrimitiveValue[] {
    if (!Array.isArray(value)) return [];
    return value.map((v) => this.cast(v));
  }
}
