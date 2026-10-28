'use client';

import { Box, Button, Typography } from '@mui/material';
import NextLink from 'next/link';
import { useEffect } from 'react';

import AppLogo from '@/components/common/logo/AppLogo';
import { RouteUrls } from '@/lib/routes/route.config';

/**
 * Route-level error boundary.
 *
 * The app had none at all — no `error.tsx`, no `global-error.tsx`, and no class
 * boundary in any provider — so a single render-time throw anywhere below the
 * root replaced the whole page with Next's bare production error screen, with
 * no retry and no navigation.
 *
 * That was reachable in practice, not theoretically: the support-log components
 * read `details?.oldStatus` off an unchecked cast of a stored JSON blob and
 * handed a possible `undefined` to `StatusChip`, whose `status.replace(...)`
 * threw. One legacy ticket-log row took out the entire ticket page.
 *
 * Next re-renders this in place of the segment that threw, so the shell,
 * providers and session all survive — `reset()` retries just that subtree.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Client-side, so this is the only record of what happened — the server
    // never saw it. `digest` is the id Next puts in the server logs for errors
    // it scrubbed, and is the only way to correlate the two.
    console.error('Unhandled error boundary:', error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <AppLogo size={32} />

      <Box className="flex max-w-md flex-col gap-2">
        <Typography variant="h5">Something went wrong</Typography>
        <Typography variant="body1" color="text.secondary">
          This page hit an unexpected problem. Trying again often works — if it doesn&apos;t, the
          rest of the app is still available.
        </Typography>
        {error.digest && (
          <Typography variant="caption" color="text.secondary">
            Reference: {error.digest}
          </Typography>
        )}
      </Box>

      <Box className="flex flex-wrap justify-center gap-3">
        <Button variant="contained" size="large" onClick={reset} className="min-w-60">
          Try again
        </Button>
        <Button
          variant="outlined"
          size="large"
          component={NextLink}
          href={RouteUrls.dashboard.index}
          className="min-w-60"
        >
          Go to dashboard
        </Button>
      </Box>
    </main>
  );
}
