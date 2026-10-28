import { type RefObject, useEffect, useMemo, useState } from 'react';

/**
 * The load-more decision, extracted so it is testable on its own: fetch only
 * when the sentinel is on screen, there is another page, and no page is already
 * in flight. Without the last clause a sentinel that stays in view fires one
 * fetch per observer tick.
 */
export function shouldLoadMore(
  isIntersecting: boolean,
  hasMore: boolean,
  isLoadingMore: boolean,
): boolean {
  return isIntersecting && hasMore && !isLoadingMore;
}

interface UseInfiniteScrollSentinelArgs {
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}

/**
 * Fetches the next page once a sentinel element scrolls near the viewport.
 * Attach the returned ref to an empty `<div>` after the last row.
 *
 * Taking three plain values rather than the query object is the point: the
 * effect's real dependencies become visible to the linter, so the
 * `exhaustive-deps` suppression this logic used to carry — needed only because
 * reading `query.*` inline made the whole query look like a dependency, which
 * re-subscribed the observer on every query state change — is gone.
 *
 * The returned ref is a plain object with a `current` accessor, built once via
 * `useMemo`, rather than a bare `useRef`. A JSX host ref (`<div ref={sentinelRef} />`)
 * is assigned by React during commit, and a `useRef`-backed ref does not itself
 * cause a re-render — so a dependency-array effect only discovers the node on
 * whichever render happens to also change `hasMore` / `isLoadingMore` /
 * `onLoadMore`, which is not guaranteed to be the render the sentinel first
 * appears on. The accessor's setter instead calls `setState` when the node is
 * assigned, which is the React-endorsed way to run logic exactly when a ref
 * attaches (see "My component needs to do something when it appears").
 */
export function useInfiniteScrollSentinel({
  hasMore,
  isLoadingMore,
  onLoadMore,
}: UseInfiniteScrollSentinelArgs): RefObject<HTMLDivElement | null> {
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  const sentinelRef = useMemo<RefObject<HTMLDivElement | null>>(() => {
    let current: HTMLDivElement | null = null;
    return {
      get current() {
        return current;
      },
      set current(el: HTMLDivElement | null) {
        current = el;
        setNode(el);
      },
    };
  }, []);

  useEffect(() => {
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (shouldLoadMore(!!entries[0]?.isIntersecting, hasMore, isLoadingMore)) onLoadMore();
      },
      // Starts the fetch before the sentinel is on screen, so the next page is
      // usually already in hand by the time the reader reaches the end of this one.
      { rootMargin: '200px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [node, hasMore, isLoadingMore, onLoadMore]);

  return sentinelRef;
}
