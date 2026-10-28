/**
 * Resolves the post-signin destination.
 *
 * `callbackUrl` arrives from the query string, so it is attacker-controlled on
 * any link a victim can be sent. Handing it to `new URL(value, request.url)`
 * resolves an absolute (`https://evil.com`) or protocol-relative (`//evil.com`)
 * value against the attacker's origin, and the proxy then redirects a
 * *signed-in* user off-site - an open redirect. The proxy only ever writes a
 * bare `pathname` into this parameter itself, so anything that is not a
 * same-origin relative path is discarded rather than sanitised.
 *
 * Shared by `proxy.ts` (edge/server) and client components under `src/app`
 * that read `callbackUrl` off the query string directly - `proxy.ts` cannot be
 * imported from a client component (`'use client'` boundary), so this lives in
 * `lib/utils` and is re-exported from `proxy.ts` for the server-side callers
 * and existing tests.
 */
export function safeCallbackUrl(callbackUrl: string | null): string | null {
  if (!callbackUrl) return null;

  // The URL parser strips ASCII tab/LF/CR from anywhere in the input, and
  // leading/trailing C0 control characters or plain space from the ends, so
  // the prefix checks below would see a different string than `new URL`
  // does: a horizontal-tab followed by "/evil.com" parses as "//evil.com".
  // Reject every C0 control char (code points 0-31), space (32) and DEL
  // (127) up front rather than enumerating the exact three characters the
  // parser strips from the middle of the string.
  //
  // Written as a charCodeAt loop rather than a regex with control-character
  // escape sequences: this tool-chain has been observed decoding those escape
  // sequences into literal raw bytes when the file is saved, which would
  // silently reintroduce the exact bug this function exists to fix.
  for (let i = 0; i < callbackUrl.length; i++) {
    const code = callbackUrl.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return null;
  }

  // "//host" and a leading-backslash form are protocol-relative; browsers
  // treat backslashes as separators here, so both forms have to be rejected
  // alongside absolute URLs.
  if (!callbackUrl.startsWith('/')) return null;
  if (callbackUrl.startsWith('//') || callbackUrl.startsWith('/\\')) return null;

  return callbackUrl;
}

/**
 * Builds the `mailto:` link offered on the register page when self-serve
 * sign-up is closed (`signupEnabled === false` in system settings).
 *
 * Returns `undefined` when no support address is configured so the caller
 * drops the control entirely — an inviting "Request access" button that opens
 * a mail client addressed to nobody is worse than no button at all.
 */
// The address is interpolated unencoded into the `mailto:` URL (encoding it
// would turn `@` into `%40` and break the plain-address links this builds),
// so a `?`, `&`, or embedded whitespace/newline inside it would inject extra
// mailto headers (cc/bcc/subject/body) rather than being treated as literal
// address text. Require a single plain `local@domain.tld` shape and no other
// address special-cases so nothing prompted from user input can smuggle
// header syntax through.
const PLAIN_EMAIL = /^[^\s<>()[\],;:@"\\?&#]+@[^\s<>()[\],;:@"\\?&#]+\.[^\s<>()[\],;:@"\\?&#]+$/;

/**
 * A `mailto:` link to the support address, or `undefined` when none is configured or it is not a
 * single plain address — so every screen that offers to email support drops the control rather
 * than open a mail client addressed to nobody, or one with smuggled headers.
 */
export function supportMailto({
  supportEmail,
  subject,
  body,
}: {
  supportEmail: string | undefined;
  subject: string;
  body?: string;
}): string | undefined {
  const address = supportEmail?.trim();
  if (!address || !PLAIN_EMAIL.test(address)) return undefined;

  const query = `subject=${encodeURIComponent(subject)}`;
  return `mailto:${address}?${body ? `${query}&body=${encodeURIComponent(body)}` : query}`;
}

export function accessRequestMailto(supportEmail: string | undefined): string | undefined {
  return supportMailto({
    supportEmail,
    subject: 'Access request',
    body: 'Hello,\n\nI would like to request an account.\n\nName:\nOrganisation:\nReason for access:\n\nThank you.',
  });
}
