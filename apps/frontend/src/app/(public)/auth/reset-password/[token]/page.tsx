'use client';

import { useEffect, useState } from 'react';
import { Button, CircularProgress, Typography } from '@mui/material';

import AppLogo from '@/components/common/logo/AppLogo';
import { AuthBadge } from '@/components/auth/AuthTrafficPanel';
import { Icons } from '@/lib/icons';
import PasswordField from '@/components/common/input/PasswordField';
import { ResetPasswordRequest } from '@/lib/dtos/request/auth.req';
import { ResetPasswordValidation } from '@/lib/validators/auth.validator';
import { APIUrl } from '@/lib/constants/url.config';
import { RouteUrls } from '@/lib/routes/route.config';
import { httpClientWithoutToken } from '@/lib/utils/httpClient';
import toast from 'react-hot-toast';
import { use } from 'react';
import useAuthAction from '@/hooks/actions/useAuthAction';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';

interface ResetPasswordPageProps {
  params: Promise<{
    token: string;
  }>;
}

function ResetPasswordPage({ params }: ResetPasswordPageProps) {
  const { token } = use(params);
  const router = useRouter();

  const [verifying, setVerifying] = useState(true);
  const [error, setError] = useState('');

  const { resetPasswordMutation } = useAuthAction();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordRequest>({
    resolver: zodResolver(ResetPasswordValidation),
    defaultValues: {
      token,
    },
  });

  useEffect(() => {
    httpClientWithoutToken
      .get(APIUrl.token.verifyResetPassword(token))
      .then(() => {
        // Token is valid, show the form
      })
      .catch((err) => {
        const status = err?.response?.status;
        if (status === 410) {
          setError('This reset link has expired. Please request a new one.');
        } else {
          setError('This reset link is invalid. Please request a new one.');
        }
      })
      .finally(() => setVerifying(false));
  }, [token]);

  const onSubmit = (data: ResetPasswordRequest) => {
    resetPasswordMutation.mutate(data, {
      onSuccess: () => {
        toast.success('Password reset successful');
        router.replace(RouteUrls.auth.signin);
      },
    });
  };

  if (verifying) {
    return (
      <main className="flex flex-col items-center justify-center gap-6 p-8">
        <CircularProgress />
        <Typography variant="body1" color="text.secondary">
          Verifying reset link...
        </Typography>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex flex-col items-center justify-center gap-6 p-8">
        <AppLogo size={35} />
        <Typography
          variant="h5"
          sx={{
            textAlign: 'center',
            color: 'error.main',
          }}
        >
          Reset link invalid
        </Typography>
        <Typography variant="body1" color="text.secondary" className="max-w-2xl text-center">
          {error}
        </Typography>
        <div className="flex gap-3">
          <Button variant="outlined" onClick={() => router.push(RouteUrls.auth.forgotPassword)}>
            Request New Link
          </Button>
          <Button variant="contained" onClick={() => router.push(RouteUrls.auth.signin)}>
            Back to Sign In
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col items-center justify-center gap-6 p-8">
      <AppLogo size={35} />

      <AuthBadge icon={Icons.resetPassword} />
      <Typography
        variant="h5"
        sx={{
          textAlign: 'center',
        }}
      >
        Reset your password
      </Typography>
      <Typography variant="body1" color="text.secondary" className="max-w-2xl text-center">
        Create a new strong password for your account. Make sure it&apos;s something you can
        remember, or save it in a secure place
      </Typography>

      <form className="flex w-full max-w-lg flex-col gap-5" onSubmit={handleSubmit(onSubmit)}>
        <PasswordField
          {...register('newPassword')}
          label="New Password"
          variant="outlined"
          fullWidth
          error={!!errors.newPassword}
          helperText={errors?.newPassword?.message}
        />

        <PasswordField
          {...register('confirmPassword')}
          label="Confirm New Password"
          variant="outlined"
          fullWidth
          error={!!errors.confirmPassword}
          helperText={errors?.confirmPassword?.message}
        />

        <Button type="submit" variant="contained" size="large">
          Change Password
        </Button>
      </form>
    </main>
  );
}

export default ResetPasswordPage;
