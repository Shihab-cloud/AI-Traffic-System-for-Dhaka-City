import { formatDistanceToNowStrict } from 'date-fns';

/**
 * Returns human-readable relative time, e.g. "5 minutes ago", "2 hours ago".
 * Returns an empty string for invalid date inputs.
 */
export function timeAgo(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '';
  return formatDistanceToNowStrict(date, { addSuffix: true });
}
