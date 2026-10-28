import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import './dayjs.setup';

describe('dayjs.setup', () => {
  it('registers the utc plugin', () => {
    expect(typeof dayjs.utc).toBe('function');
    expect(dayjs.utc('2026-09-06T00:00:00Z').format('YYYY-MM-DD')).toBe('2026-09-06');
  });

  it('registers the timezone plugin', () => {
    expect(typeof dayjs.tz).toBe('function');
    // A fixed instant read in two zones must land on two different local hours.
    const instant = '2026-09-06T02:30:00Z';
    expect(dayjs(instant).tz('UTC').format('HH:mm')).toBe('02:30');
    expect(dayjs(instant).tz('Asia/Dhaka').format('HH:mm')).toBe('08:30');
  });

  it('registers the relativeTime plugin', () => {
    expect(typeof dayjs().fromNow).toBe('function');
    expect(dayjs().subtract(3, 'minute').fromNow()).toBe('3 minutes ago');
  });

  it('is idempotent — importing twice does not double-extend', async () => {
    await import('./dayjs.setup');
    expect(dayjs.utc('2026-01-01T00:00:00Z').toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
