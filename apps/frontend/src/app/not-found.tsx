'use client';

import { Box, Button, Typography } from '@mui/material';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';

import AppLogo from '@/components/common/logo/AppLogo';
import { authClient, useSession } from '@/lib/auth-client';
import { RouteUrls, defaultRedirectForPermissions } from '@/lib/routes/route.config';

// Rendered by Next.js for any unmatched route AND when
// defaultRedirectForPermissions returns RouteUrls.notFound (unknown / missing
// session permissions). Two distinct audiences share this page:
//   1. Signed-out users who typed a bad URL  → offer sign-in
//   2. Signed-in users with a valid role     → offer dashboard
//   3. Signed-in users with a broken role    → offer sign-out (recovery path,
//      because re-issuing the session is the only client-side fix for a stale
//      / missing role claim)
// hasValidRole disambiguates (2) vs (3) without leaking enum membership logic
// into the page — defaultRedirectForPermissions already owns that source of
// truth.
export default function NotFoundPage() {
  const router = useRouter();
  const { data: session } = useSession();

  const permissions = session?.user.role?.permissions;
  const redirectTarget = defaultRedirectForPermissions(permissions);
  const hasValidRole = redirectTarget !== RouteUrls.notFound;
  const isAuthed = !!session;

  const handleSignOut = async () => {
    await authClient.signOut();
    router.replace(RouteUrls.auth.signin);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <AppLogo size={32} />

      <Typography
        sx={{
          fontSize: { xs: 96, md: 144 },
          fontWeight: 700,
          color: 'primary.main',
          lineHeight: 1,
          letterSpacing: '-0.04em',
        }}
      >
        404
      </Typography>

      <Box className="flex max-w-md flex-col gap-2">
        <Typography variant="h5">Page not found</Typography>
        {isAuthed && !hasValidRole ? (
          <Typography variant="body1" color="text.secondary">
            We couldn&apos;t determine where to send you next. Your account may not be fully set up,
            or your role assignment is missing. Sign out and back in, or reach out to support if the
            problem continues.
          </Typography>
        ) : (
          <Typography variant="body1" color="text.secondary">
            We can&apos;t find the page you were looking for. It may have moved, been removed, or
            the link you followed is broken.
          </Typography>
        )}
      </Box>

      <Box className="flex flex-wrap justify-center gap-3">
        {isAuthed && hasValidRole && (
          <Button
            variant="contained"
            size="large"
            component={NextLink}
            href={redirectTarget}
            className="min-w-60"
          >
            Go to dashboard
          </Button>
        )}
        {isAuthed && !hasValidRole && (
          <Button variant="contained" size="large" onClick={handleSignOut} className="min-w-60">
            Sign out and try again
          </Button>
        )}
        {!isAuthed && (
          <Button
            variant="contained"
            size="large"
            component={NextLink}
            href={RouteUrls.auth.signin}
            className="min-w-60"
          >
            Sign in
          </Button>
        )}
        <Button
          variant="outlined"
          size="large"
          component={NextLink}
          href={RouteUrls.faq}
          className="min-w-60"
        >
          Visit help center
        </Button>
      </Box>
    </main>
  );
}
