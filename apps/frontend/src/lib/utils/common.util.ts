export function stringToColor(string: string) {
  let hash = 0;
  let i;

  for (i = 0; i < string.length; i += 1) {
    hash = string.charCodeAt(i) + ((hash << 5) - hash);
  }

  let color = '#';

  for (i = 0; i < 3; i += 1) {
    const value = (hash >> (i * 8)) & 0xff;
    color += `00${value.toString(16)}`.slice(-2);
  }

  return color;
}

export const generateAvatar = (name: string) => {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}`;
};

/**
 * Sentences for the machine-readable codes the API returns.
 *
 * The backend answers these with a structured body (`{ error, reason }`) and no
 * human-readable `message`, so without this the user saw the raw axios string —
 * "Request failed with status code 401" for a mistyped code, "…429" for being
 * rate limited. Indistinguishable from each other and from a real fault.
 */
const API_ERROR_MESSAGES: Record<string, string> = {
  mfa_verification_failed: 'That code is not correct. Check your authenticator and try again.',
  invalid_code: 'That code is not correct. Check your authenticator and try again.',
  expired: 'That code has expired. Request a new one.',
  attempts_exhausted: 'Too many incorrect attempts. Start the verification again.',
  not_found: 'This verification has expired. Start again.',
  invalid_attempt_token: 'This sign-in attempt has expired. Sign in again.',
  invalid_backup_code: 'That backup code is not valid or has already been used.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  locked_out: 'Too many incorrect codes. This account is locked for a while — try again later.',
  step_up_required: 'This action needs you to confirm your identity first.',
  enroll_required: 'Set up two-factor authentication before using this action.',
  no_session_id: 'Your session has expired. Sign in again.',
};

/**
 * The message a failed API call actually carries.
 *
 * Nest's `BadRequestException({ message, errors })` reaches the client as an
 * axios error whose own `message` is only "Request failed with status code
 * 400" — the part naming what was wrong sits in the response body. Resolution
 * order: a known `reason`/`error` code, then the body's `errors`/`message`,
 * then a non-axios `Error.message`, then `fallback`.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const body = (
    error as {
      response?: {
        data?: { message?: unknown; errors?: unknown; error?: unknown; reason?: unknown };
      };
    }
  )?.response?.data;

  // `reason` is the more specific of the two (`error: 'mfa_verification_failed'`
  // with `reason: 'expired'`), so it is preferred when both are present.
  for (const code of [body?.reason, body?.error]) {
    if (typeof code === 'string' && API_ERROR_MESSAGES[code]) return API_ERROR_MESSAGES[code];
  }

  if (Array.isArray(body?.errors) && body.errors.length > 0) return body.errors.join('; ');
  if (typeof body?.message === 'string' && body.message) return body.message;
  if (Array.isArray(body?.message) && body.message.length > 0) return body.message.join('; ');

  // `error.message` is still useful for genuine failures ("Network Error"),
  // but axios sets it to "Request failed with status code N" for every HTTP
  // error — which reads as a bug report and tells the user nothing. Skip that
  // one shape and let the caller's fallback speak instead.
  if (
    error instanceof Error &&
    error.message &&
    !/^Request failed with status code/.test(error.message)
  ) {
    return error.message;
  }

  return fallback;
}
