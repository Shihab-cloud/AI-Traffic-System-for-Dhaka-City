/** A decorated mongoose schema class (e.g. `SupportTicket`). */
type SchemaClass = abstract new (...args: never[]) => unknown;

/**
 * Registry mapping a schema class to the fields its `?search=` term matches
 * against. Declared in the schema file, next to the schema definition, so
 * searchability lives with the data model — services never pass field lists
 * or build `$regex` patterns themselves (use `MongoQueryBuilder.buildSearch`).
 */
const registry = new Map<SchemaClass, string[]>();

/** Declare which fields `?search=` matches for a schema. Call in the schema file. */
export function registerSearchFields(schemaClass: SchemaClass, fields: string[]): void {
  registry.set(schemaClass, fields);
}

export function getSearchFields(schemaClass: SchemaClass): string[] | undefined {
  return registry.get(schemaClass);
}
