'use client';

import AppLogo from '@/components/common/logo/AppLogo';
import { PermissionsEnum } from '@/lib/enums/permission.enum';
import { RouteUrls, defaultRedirectForPermissions } from '@/lib/routes/route.config';
import { authClient, useSession } from '@/lib/auth-client';
import { Button, Typography, useTheme } from '@mui/material';
import NextLink from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Icons } from '@/lib/icons';

/**
 * Landing page Better Auth redirects to after processing a `verify-email` link
 * (set as `callbackURL` in `provisioning.service.dispatchVerificationEmail`).
 *
 * Public route — the recipient is usually not signed in when they click the
 * link from their inbox. Shows a clear success / failure state and a CTA into
 * the next step rather than dropping the user on /dashboard, where the auth
 * middleware would silently bounce them to /signin with no confirmation.
 *
 * Better Auth appends `?error=…` (e.g. `invalid_token`) on failure; on success
 * it just redirects with no query string.
 */
function EmailVerifiedContent() {
  const theme = useTheme();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const error = searchParams.get('error');
  const failed = !!error;
  const isAuthed = !!session;

  const permissions = (session?.user as { role?: { permissions?: PermissionsEnum[] } } | undefined)
    ?.role?.permissions;
  const nextHref = isAuthed ? defaultRedirectForPermissions(permissions) : RouteUrls.auth.signin;
  const nextLabel = isAuthed ? 'Back to dashboard' : 'Continue to sign in';

  return (
    <main className="flex flex-col items-center justify-center gap-6 p-8 text-center">
      <AppLogo size={35} />

      {failed ? (
        <>
          <Icons.error size={80} color={theme.palette.error.main} />
          <Typography variant="h5">Verification failed</Typography>
          <Typography variant="body1" color="text.secondary" className="max-w-md">
            This link is invalid or has expired. Sign in and request a new verification email from
            the in-app banner.
          </Typography>
        </>
      ) : (
        <>
          <Icons.check size={80} color={theme.palette.success.main} />
          <Typography variant="h5">Email verified</Typography>
          <Typography variant="body1" color="text.secondary" className="max-w-md">
            Your email address is confirmed. You can now use password recovery if you ever lose
            access to your account.
          </Typography>
        </>
      )}

      <Button
        variant="contained"
        size="large"
        component={NextLink}
        href={nextHref}
        className="min-w-60"
      >
        {nextLabel}
      </Button>
    </main>
  );
}

export default function EmailVerifiedPage() {
  return (
    <Suspense>
      <EmailVerifiedContent />
    </Suspense>
  );
}
