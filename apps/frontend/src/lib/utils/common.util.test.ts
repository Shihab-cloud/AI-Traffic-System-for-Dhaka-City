import { describe, expect, it } from 'vitest';

import { apiErrorMessage } from './common.util';

describe('apiErrorMessage', () => {
  it('joins an errors array', () => {
    const error = { response: { data: { errors: ['email is required', 'name is required'] } } };
    expect(apiErrorMessage(error, 'fallback')).toBe('email is required; name is required');
  });

  it('returns a string message', () => {
    const error = { response: { data: { message: 'Invalid credentials' } } };
    expect(apiErrorMessage(error, 'fallback')).toBe('Invalid credentials');
  });

  it('joins a message array (class-validator default shape)', () => {
    const error = { response: { data: { message: ['email must be an email'] } } };
    expect(apiErrorMessage(error, 'fallback')).toBe('email must be an email');
  });

  it('falls back to the Error message when there is no response body', () => {
    expect(apiErrorMessage(new Error('network down'), 'fallback')).toBe('network down');
  });

  it('falls back to the given fallback as a last resort', () => {
    expect(apiErrorMessage({}, 'fallback')).toBe('fallback');
  });
});

describe('apiErrorMessage — API error codes', () => {
  const withBody = (data: unknown) => ({ response: { data } });

  it('translates a machine-readable error code into a sentence', () => {
    // The backend answers a wrong MFA code with a structured body and no
    // human-readable `message`, so without this the user saw the raw axios
    // string — "Request failed with status code 401".
    expect(apiErrorMessage(withBody({ error: 'mfa_verification_failed' }), 'fallback')).toContain(
      'not correct',
    );
  });

  it('prefers the more specific `reason` over `error`', () => {
    const msg = apiErrorMessage(
      withBody({ error: 'mfa_verification_failed', reason: 'expired' }),
      'fallback',
    );

    expect(msg).toContain('expired');
  });

  it('distinguishes rate limiting from a wrong code', () => {
    const wrong = apiErrorMessage(withBody({ error: 'mfa_verification_failed' }), 'fallback');
    const limited = apiErrorMessage(withBody({ error: 'rate_limited' }), 'fallback');

    expect(limited).not.toBe(wrong);
  });

  it('still prefers an explicit server message over a code', () => {
    expect(apiErrorMessage(withBody({ message: 'Email already in use' }), 'fallback')).toBe(
      'Email already in use',
    );
  });

  it('does not surface the axios status-code string', () => {
    const axiosLike = Object.assign(new Error('Request failed with status code 429'), {
      response: { data: {} },
    });

    expect(apiErrorMessage(axiosLike, 'Something went wrong')).toBe('Something went wrong');
  });

  it('keeps a genuine network error message', () => {
    expect(apiErrorMessage(new Error('Network Error'), 'fallback')).toBe('Network Error');
  });
});
