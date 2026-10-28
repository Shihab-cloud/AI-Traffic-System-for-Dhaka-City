import { randomBytes } from 'crypto';

/** Mongo documents / lean rows -> plain JSON (ObjectIds as strings, `id` alongside `_id`). */
export function toPlain<T = Record<string, unknown>>(doc: unknown): T {
  if (doc == null) return doc as T;
  const raw = typeof (doc as { toJSON?: () => unknown }).toJSON === 'function'
    ? (doc as { toJSON: () => unknown }).toJSON()
    : doc;
  const plain = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  if (plain && typeof plain === 'object' && plain._id && !plain.id) plain.id = plain._id;
  return plain as T;
}

/** "Dhaka Metro-Ga 12-3456" -> "DHAKAMETROGA123456": letters and digits only, upper case. */
export function regKey(registration?: string | null): string {
  return (registration ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** The six digits of line 2 ("12-3456" -> "123456"), or '' when the text does not end in six digits. */
export function numberKey(registration?: string | null): string {
  const m = (registration ?? '').replace(/[^0-9-]/g, ' ').match(/(\d{2})\s*-?\s*(\d{4})\s*$/);
  return m ? m[1] + m[2] : '';
}

/** A readable registration needs every part: area, letter and the full number (no "?"). */
export function isCompleteRegistration(registration?: string | null): boolean {
  return !!registration && !registration.includes('?') && numberKey(registration).length === 6;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** e.g. DTE-261023-K7P4Q: prefix, date (yymmdd, Dhaka time) and 5 random characters. */
export function makeNumber(prefix: string, at = new Date()): string {
  const dhaka = new Date(at.getTime() + 6 * 3600 * 1000);
  const ymd = dhaka.toISOString().slice(2, 10).replace(/-/g, '');
  const rand = Array.from(randomBytes(5), (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${prefix}-${ymd}-${rand}`;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** "2026-09-22 17:37:15" in Dhaka time. */
export function dhakaTime(at: Date | string | undefined | null): string {
  if (!at) return '';
  const d = new Date(new Date(at).getTime() + 6 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
