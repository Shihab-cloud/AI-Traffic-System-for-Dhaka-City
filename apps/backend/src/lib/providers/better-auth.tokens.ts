import type { createBetterAuth } from '../auth/better-auth';

/**
 * DI token + instance type for the better-auth singleton, kept in a
 * dependency-free leaf module. Consumers that only need the token at runtime
 * (e.g. `TokenService` via `ModuleRef`) import from here instead of from
 * `better-auth.provider.ts`, which would otherwise create a CommonJS require
 * cycle (better-auth.provider → mfa.service → token.service →
 * better-auth.provider) and surface as a `CircularDependencyException`.
 *
 * The `createBetterAuth` import is type-only and erased at runtime, so this
 * module stays a leaf with no runtime imports.
 */
export const BETTER_AUTH = Symbol('BETTER_AUTH');

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;
