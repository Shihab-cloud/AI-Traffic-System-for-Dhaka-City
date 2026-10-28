import {
  sanitizeHeaders,
  sanitizeRequestBody,
  sanitizeResponseBody,
} from './logging-interceptor.utils';

const REDACTED = '[REDACTED]';

describe('log redaction', () => {
  it('redacts both sides of a password change', () => {
    const body = sanitizeRequestBody({ oldPassword: 'hunter2', newPassword: 'hunter3' });

    expect(body).toEqual({ oldPassword: REDACTED, newPassword: REDACTED });
  });

  it('redacts MFA codes and backup codes', () => {
    expect(sanitizeRequestBody({ code: '123456' })).toEqual({ code: REDACTED });
    expect(sanitizeResponseBody({ codes: ['a', 'b'] })).toEqual({ codes: REDACTED });
  });

  it('redacts the bootstrap token and step-up header', () => {
    const headers = sanitizeHeaders({
      'x-admin-secret': 'bootstrap',
      'authorization-step-up': 'tok',
      'user-agent': 'jest',
    });

    expect(headers).toEqual({
      'x-admin-secret': REDACTED,
      'authorization-step-up': REDACTED,
      'user-agent': 'jest',
    });
  });

  it('reaches nested and array payloads, which a flat pass missed', () => {
    const out = sanitizeResponseBody({
      docs: [{ user: { email: 'a@b.c', tempPassword: 'x' } }],
    });

    expect(out).toEqual({ docs: [{ user: { email: 'a@b.c', tempPassword: REDACTED } }] });
  });

  it('leaves keys that merely contain a sensitive word alone', () => {
    const out = sanitizeResponseBody({ fileKey: 'support/abc', statusCode: 200 });

    expect(out).toEqual({ fileKey: 'support/abc', statusCode: 200 });
  });

  it('passes primitives through untouched', () => {
    expect(sanitizeResponseBody('ok')).toBe('ok');
    expect(sanitizeResponseBody(null)).toBeNull();
  });
});
