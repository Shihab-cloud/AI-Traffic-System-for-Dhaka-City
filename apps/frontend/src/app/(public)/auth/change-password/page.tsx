'use client';

import { Button, CircularProgress, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

import AppLogo from '@/components/common/logo/AppLogo';
import PasswordField from '@/components/common/input/PasswordField';
import { PasswordUpdateRequest } from '@/lib/dtos/request/user.req';
import { PasswordUpdateValidation } from '@/lib/validators/user.validator';
import { RouteUrls } from '@/lib/routes/route.config';
import { authClient, useSession } from '@/lib/auth-client';
import toast from 'react-hot-toast';
import useAuthAction from '@/hooks/actions/useAuthAction';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import useUserAction from '@/hooks/actions/useUserAction';
import { zodResolver } from '@hookform/resolvers/zod';

function ChangePasswordPage() {
  const router = useRouter();
  const { signoutMutation } = useAuthAction();
  const { updatePasswordMutation } = useUserAction();

  const { data: session, isPending } = useSession();
  const [hasCredentialAccount, setHasCredentialAccount] = useState(true);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  useEffect(() => {
    authClient
      .listAccounts()
      .then(({ data }) => {
        const hasCredential = data?.some((account) => account.providerId === 'credential') ?? false;
        setHasCredentialAccount(hasCredential);
      })
      .catch(() => {
        setHasCredentialAccount(true);
      })
      .finally(() => setLoadingAccounts(false));
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PasswordUpdateRequest>({
    resolver: zodResolver(PasswordUpdateValidation),
  });

  const onSubmit = (data: PasswordUpdateRequest) => {
    updatePasswordMutation.mutate(data, {
      onSuccess: () => {
        toast.success('Password updated. Please sign in with your new password.');
        signoutMutation.mutate();
      },
    });
  };

  if (isPending || loadingAccounts) {
    return (
      <main className="flex flex-col items-center justify-center gap-6 p-8">
        <CircularProgress />
      </main>
    );
  }

  if (!session) {
    router.replace(RouteUrls.auth.signin);
    return null;
  }

  return (
    <main className="flex flex-col items-center justify-center gap-6 p-8">
      <AppLogo size={35} />

      <Typography
        variant="h5"
        sx={{
          textAlign: 'center',
        }}
      >
        Set your password
      </Typography>
      <Typography variant="body1" color="text.secondary" className="max-w-2xl text-center">
        Please set a new password for your account before continuing.
      </Typography>

      <form className="flex w-full max-w-lg flex-col gap-5" onSubmit={handleSubmit(onSubmit)}>
        {hasCredentialAccount && (
          <PasswordField
            {...register('oldPassword')}
            autoComplete="current-password"
            label="Temporary Password"
            placeholder="Enter your temporary password"
            variant="outlined"
            fullWidth
            error={!!errors.oldPassword}
            helperText={errors?.oldPassword?.message}
          />
        )}

        <PasswordField
          {...register('newPassword')}
          autoComplete="new-password"
          label="New Password"
          placeholder="Enter your new password"
          variant="outlined"
          fullWidth
          error={!!errors.newPassword}
          helperText={errors?.newPassword?.message}
        />

        <PasswordField
          {...register('confirmNewPassword')}
          autoComplete="new-password"
          label="Confirm New Password"
          placeholder="Re-enter your new password"
          variant="outlined"
          fullWidth
          error={!!errors.confirmNewPassword}
          helperText={errors?.confirmNewPassword?.message}
        />

        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={updatePasswordMutation.isPending}
        >
          {updatePasswordMutation.isPending ? 'Updating...' : 'Set Password'}
        </Button>
      </form>
    </main>
  );
}

export default ChangePasswordPage;
