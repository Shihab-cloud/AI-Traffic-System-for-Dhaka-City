import { describe, expect, it } from 'vitest';

import { shouldLoadMore } from './useInfiniteScrollSentinel';

describe('shouldLoadMore', () => {
  it('loads only when the sentinel is on screen, more exists, and nothing is in flight', () => {
    expect(shouldLoadMore(true, true, false)).toBe(true);
  });

  it('does not load while a page is already being fetched', () => {
    // Otherwise a sentinel that stays in view fires a fetch per observer tick.
    expect(shouldLoadMore(true, true, true)).toBe(false);
  });

  it('does not load when there is nothing left', () => {
    expect(shouldLoadMore(true, false, false)).toBe(false);
  });

  it('does not load while the sentinel is off screen', () => {
    expect(shouldLoadMore(false, true, false)).toBe(false);
    expect(shouldLoadMore(false, false, true)).toBe(false);
  });
});
