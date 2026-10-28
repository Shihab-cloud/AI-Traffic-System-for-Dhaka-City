'use client';

import { Alert, Box, Chip, CircularProgress, Typography } from '@mui/material';
import { useEffect } from 'react';

import ActivateAccountForm from '@/components/auth/ActivateAccountForm';
import AppLogo from '@/components/common/logo/AppLogo';
import useAuthAction from '@/hooks/actions/useAuthAction';
import { authClient, useSession } from '@/lib/auth-client';
import { type ActivateAccountForm as ActivateAccountFormValues } from '@/lib/dtos/request/activate.req';
import { PermissionsEnum } from '@/lib/enums/permission.enum';
import { RouteUrls, defaultRedirectForPermissions } from '@/lib/routes/route.config';
import { userDisplayName } from '@/lib/utils/user.util';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

export default function ActivateAccountPage() {
  const router = useRouter();
  const { activateAccountMutation } = useAuthAction();
  const { data: session, isPending } = useSession();

  // Backend sets `activation_required` in customSession when the user still
  // carries `mustResetPassword=true`. This page is the inverse of the rest of
  // the app: it REQUIRES the flag and bounces anyone without it.
  const activationRequired = Boolean(
    (session?.session as { activation_required?: boolean } | undefined)?.activation_required,
  );

  useEffect(() => {
    if (isPending) return;
    if (!session) router.replace(RouteUrls.auth.signin);
    else if (!activationRequired) {
      const permissions = (
        session.user as { role?: { permissions?: PermissionsEnum[] } } | undefined
      )?.role?.permissions;
      router.replace(defaultRedirectForPermissions(permissions));
    }
  }, [isPending, session, activationRequired, router]);

  if (isPending || !session || !activationRequired) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3">
        <CircularProgress size={28} />
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      </main>
    );
  }

  const { user } = session;
  const displayName =
    userDisplayName({
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      id: user.id,
    })?.trim() || 'your account';

  const handleActivate = (form: ActivateAccountFormValues) =>
    activateAccountMutation.mutate(
      { newPassword: form.newPassword, email: form.email },
      {
        onSuccess: async () => {
          // Sign out + back in so the next JWT drops the stale
          // `activation_required` claim — simpler than threading a
          // token-refresh hook through here, and this path is rare enough
          // to absorb the extra hop.
          toast.success('Account activated. Please sign in again with your new password.');
          await authClient.signOut();
          router.replace(RouteUrls.auth.signin);
        },
        onError: (err: Error) => toast.error(err.message || 'Activation failed. Please try again.'),
      },
    );

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <Box
        className="flex w-full max-w-md flex-col gap-5 rounded-lg p-8"
        sx={{ backgroundColor: 'background.paper' }}
      >
        <Box className="flex flex-col items-center gap-2">
          <AppLogo size={32} />
          <Chip
            size="small"
            variant="outlined"
            label={
              <>
                Activating <strong>{displayName}</strong>
                {user.username ? ` (@${user.username})` : ''}
              </>
            }
          />
        </Box>

        <Box className="flex flex-col items-center gap-2">
          <Typography
            variant="h5"
            sx={{
              fontWeight: 600,
              textAlign: 'center',
            }}
          >
            Activate your account
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
              textAlign: 'center',
            }}
          >
            Set a permanent password and confirm your email. You&apos;ll receive a verification link
            separately — verifying enables password recovery if you ever lose access.
          </Typography>
        </Box>

        {activateAccountMutation.error && (
          <Alert severity="error">{activateAccountMutation.error.message}</Alert>
        )}

        <ActivateAccountForm
          submitting={activateAccountMutation.isPending}
          defaultEmail={user.email ?? ''}
          onSubmit={handleActivate}
        />
      </Box>
    </main>
  );
}
