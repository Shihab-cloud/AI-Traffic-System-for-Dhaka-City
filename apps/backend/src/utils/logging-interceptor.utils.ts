import { randomUUID } from 'node:crypto';

import { HttpRequestLogData, RequestData, ResponseData } from 'src/lib/types/log-interceptor.types';

import { Request } from 'express';

import { resolveClientIp } from 'src/lib/utils/client-ip.util';

/**
 * Keys whose value never belongs in a log, matched case-insensitively and at
 * any depth. One list for bodies and headers alike: the same secret reaches the
 * log through both, and two lists drift.
 *
 * Exact names rather than substrings — `key` must not swallow `fileKey`, and
 * `code` must not swallow `statusCode`.
 */
const REDACTED_KEYS = new Set([
  'apikey',
  'authorization',
  'authorization-step-up',
  'accesstoken',
  'backupcodes',
  'code',
  'codes',
  'confirmpassword',
  'cookie',
  'currentpassword',
  'key',
  'newpassword',
  'oldpassword',
  'otp',
  'password',
  'pendingtemppassword',
  'presignedurl',
  'refreshtoken',
  'secret',
  'session',
  'sessiontoken',
  'set-cookie',
  'temppassword',
  'token',
  'totp',
  'x-admin-secret',
  'x-api-key',
  'x-auth-token',
]);

const REDACTED = '[REDACTED]';
/** Bounds the walk so a cyclic or pathological payload cannot stall logging. */
const MAX_DEPTH = 6;

/** Deep copy with every sensitive value replaced. */
function redact(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redact(val, depth + 1);
  }
  return out;
}

export const generateRequestId = (): string => `req_${randomUUID()}`;

/**
 * The same client IP the audit rows and the rate limiter use, so a log line and
 * an audit row for one request cannot name two different clients.
 */
export const getClientIp = (request: Request): string => resolveClientIp(request) ?? 'Unknown';

export const sanitizeRequestBody = (body: Record<string, unknown>): Record<string, unknown> =>
  redact(body) as Record<string, unknown>;

export const sanitizeHeaders = (headers: Record<string, unknown>): Record<string, unknown> =>
  redact(headers) as Record<string, unknown>;

export const sanitizeResponseBody = (responseBody: unknown): unknown => redact(responseBody);

export const generateRequestData = (request: Request): RequestData => {
  const requestId = generateRequestId();
  const method = request.method;
  const url = request.url;
  const body = request.body as Record<string, unknown>;
  const query = request.query as Record<string, unknown>;
  const headers = request.headers as Record<string, unknown>;

  return {
    requestId,
    method,
    url,
    ip: getClientIp(request),
    userAgent: request.get('User-Agent') || 'Unknown',
    body: sanitizeRequestBody(body),
    query: query,
    headers: sanitizeHeaders(headers),
  };
};

/**
 * Generates structured log data for HTTP requests
 */
export const generateHttpRequestLogData = (
  requestData: RequestData,
  responseData: ResponseData,
): HttpRequestLogData => {
  return {
    requestId: requestData.requestId,
    method: requestData.method,
    url: requestData.url,
    duration: responseData.duration,
    request: {
      ip: requestData.ip,
      userAgent: requestData.userAgent,
      body: requestData.body,
      query: requestData.query,
      headers: requestData.headers,
    },
    response: {
      statusCode: responseData.statusCode,
      body: responseData.responseBody,
      error: responseData.error,
    },
    timestamp: new Date().toISOString(),
    type: 'http_request',
  };
};
