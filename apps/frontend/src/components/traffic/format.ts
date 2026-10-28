/** Display helpers for traffic data. Times are shown in Dhaka time (UTC+6), where the cameras are. */

const DHAKA = 'Asia/Dhaka';

export function dhakaDateTime(iso?: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: DHAKA,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function dhakaDate(iso?: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: DHAKA, day: '2-digit', month: 'short', year: 'numeric' });
}

export function money(amount?: number | null, currency = 'BDT') {
  if (amount == null) return '-';
  return `${currency} ${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** "12m 05s" / "1h 02m" since a unix time (seconds). */
export function elapsed(fromSec: number, toSec = Date.now() / 1000) {
  const s = Math.max(0, Math.round(toSec - fromSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

export const VIOLATION_CODES: Record<string, string> = {
  V1: 'Bus stopped outside a bus stop',
  V2: 'Over speed limit',
  V3: 'Parked at a no-parking kerb',
  V4: 'Wrong-side driving',
  V5: 'Crossing a solid lane line',
  V6: 'Riding without a helmet',
  V7: 'Blocking a running lane',
  V8: 'Vehicle class banned on this road',
};

export const REVIEW_REASONS: Record<string, string> = {
  wrong_vehicle: 'It was not my vehicle',
  wrong_reading: 'The plate or measurement is wrong',
  not_me_driving: 'Someone else was driving',
  emergency: 'Emergency (medical, police, fire)',
  other: 'Other',
};

/** The registration a violation will be ticketed under, or what the plate reader made of it. */
export function shownPlate(v: { registration?: string; plate?: { registration?: string; status?: string } }) {
  if (v.registration) return { text: v.registration, status: 'set' };
  if (v.plate?.registration) return { text: v.plate.registration, status: v.plate.status ?? '' };
  return { text: '', status: v.plate?.status ?? 'reading' };
}

/** Readable labels for the violation engine's detail keys. */
export function detailLabel(key: string) {
  return key.replace(/_/g, ' ').replace(/\b(sec|s)\b/, '(s)').replace(/^\w/, (c) => c.toUpperCase());
}
