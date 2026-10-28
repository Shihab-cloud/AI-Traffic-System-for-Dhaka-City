'use client';

import { AppProgressProvider, useProgress } from '@bprogress/next';
import { useTheme } from '@mui/material/styles';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

/**
 * Drives the same bar from React Query: it runs while anything is fetching or saving.
 *
 * A mutation keyed `['skipLoading']` hides it entirely while it runs — for work with its own
 * progress on screen, where a second indicator would only compete with it.
 */
function QueryProgress() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const skipped = useIsMutating({ mutationKey: ['skipLoading'] });
  const busy = skipped === 0 && (fetching > 0 || mutating > 0);

  const { start, stop } = useProgress();
  // Stops only a bar this started, so an idle query cache never cuts short a page navigation.
  const started = useRef(false);

  useEffect(() => {
    if (busy && !started.current) {
      started.current = true;
      // Auto-stop off: a route change finishing must not end a bar a request is still holding.
      start(0, 0, true);
    } else if (!busy && started.current) {
      started.current = false;
      stop();
    }
  }, [busy, start, stop]);

  return null;
}

/**
 * The one progress bar along the top of the window, in the theme's primary colour: page
 * navigations started by a link click, and every request React Query makes. A programmatic
 * `router.push` shows it only once the next page starts fetching, unless the caller uses the
 * progress-aware `useRouter` from `@bprogress/next/app`.
 */
export default function AppProgress({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <AppProgressProvider
      color={theme.palette.primary.main}
      height="3px"
      options={{ showSpinner: false }}
      shallowRouting
    >
      {children}
      <QueryProgress />
    </AppProgressProvider>
  );
}
