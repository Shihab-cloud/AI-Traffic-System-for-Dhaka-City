import type { OpenAPIObject } from '@nestjs/swagger';

const BA_TAG = 'Authentication';

// Declarative map: path → method → example body
const betterAuthExamples: Record<string, Record<string, unknown>> = {
  '/auth/sign-in/email': {
    post: {
      email: 'admin@example.com',
      password: 'admin123',
      callbackURL: '',
      rememberMe: true,
    },
  },
};

type Operation = { tags?: string[]; requestBody?: RequestBody };
type RequestBody = { content?: Record<string, { example?: unknown }> };
type PathItem = Record<string, Operation>;
type BetterAuthSpec = {
  paths?: Record<string, PathItem>;
  components?: { schemas?: Record<string, unknown> };
};

/**
 * Merges better-auth's generated OpenAPI schema into a NestJS Swagger document.
 *
 * - Prefixes paths with `/auth` (NestJS Swagger server base is `/api`, better-auth lives at `/api/auth/*`)
 * - Groups all operations under the "Better Auth" tag
 * - Patches request body examples for common endpoints
 * - Merges component schemas
 */
export async function mergeBetterAuthOpenAPI(
  auth: { api: { generateOpenAPISchema: () => Promise<unknown> } },
  document: OpenAPIObject,
): Promise<void> {
  const betterAuthSpec = (await auth.api.generateOpenAPISchema()) as BetterAuthSpec;

  if (betterAuthSpec.paths) {
    for (const [path, definition] of Object.entries(betterAuthSpec.paths)) {
      for (const method of Object.values(definition)) {
        if (method && typeof method === 'object') {
          method.tags = [BA_TAG];
        }
      }
      document.paths[`/auth${path}`] = definition;
    }
  }

  // Patch example request bodies
  for (const [path, methods] of Object.entries(betterAuthExamples)) {
    for (const [method, example] of Object.entries(methods)) {
      const pathItem = document.paths[path] as PathItem | undefined;
      const body = pathItem?.[method]?.requestBody;
      const json = body?.content?.['application/json'];
      if (json) {
        json.example = example;
      }
    }
  }

  // Merge component schemas
  if (betterAuthSpec.components?.schemas) {
    document.components = document.components || {};
    document.components.schemas = document.components.schemas || {};
    Object.assign(document.components.schemas, betterAuthSpec.components.schemas);
  }

  // Register the tag so Swagger UI shows it as a named section
  document.tags = document.tags || [];
  document.tags.push({ name: BA_TAG, description: 'Authentication endpoints (better-auth)' });
}
