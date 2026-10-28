'use client';

import { useEffect, useState } from 'react';
import { Button, CircularProgress, Typography } from '@mui/material';
import NextLink from 'next/link';

import AppLogo from '@/components/common/logo/AppLogo';
import PasswordField from '@/components/common/input/PasswordField';
import { AcceptInviteRequest } from '@/lib/dtos/request/auth.req';
import { AcceptInviteValidation } from '@/lib/validators/auth.validator';
import { APIUrl } from '@/lib/constants/url.config';
import { RouteUrls } from '@/lib/routes/route.config';
import { apiErrorMessage } from '@/lib/utils/common.util';
import { httpClientWithoutToken } from '@/lib/utils/httpClient';
import toast from 'react-hot-toast';
import { use } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';

interface AcceptInvitePageProps {
  params: Promise<{
    token: string;
  }>;
}

function AcceptInvitePage({ params }: AcceptInvitePageProps) {
  const { token } = use(params);
  const router = useRouter();

  const [verifying, setVerifying] = useState(true);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AcceptInviteRequest>({
    resolver: zodResolver(AcceptInviteValidation),
  });

  useEffect(() => {
    httpClientWithoutToken
      .get(APIUrl.token.verifyInvite(token))
      .then((res) => {
        setEmail(res.data.email);
      })
      .catch((err) => {
        const status = err?.response?.status;
        if (status === 410) {
          setError(
            'This invite link has expired. Please contact your administrator for a new one.',
          );
        } else {
          setError('This invite link is invalid. Please contact your administrator.');
        }
      })
      .finally(() => setVerifying(false));
  }, [token]);

  const onSubmit = (data: AcceptInviteRequest) => {
    setSubmitting(true);
    httpClientWithoutToken
      .post(APIUrl.token.acceptInvite(), { token, newPassword: data.newPassword })
      .then(() => {
        toast.success('Account activated successfully');
        router.replace(RouteUrls.auth.signin);
      })
      .catch((err) => {
        toast.error(apiErrorMessage(err, 'Failed to activate account'));
      })
      .finally(() => setSubmitting(false));
  };

  if (verifying) {
    return (
      <main className="flex flex-col items-center justify-center gap-6 p-8">
        <CircularProgress />
        <Typography variant="body1" color="text.secondary">
          Verifying invite link...
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
          Invite link invalid
        </Typography>
        <Typography variant="body1" color="text.secondary" className="max-w-2xl text-center">
          {error}
        </Typography>
        <Button component={NextLink} href={RouteUrls.auth.signin} variant="contained">
          Back to Sign In
        </Button>
      </main>
    );
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
        Welcome! Set a password for <strong>{email}</strong> to activate your account.
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
          label="Confirm Password"
          variant="outlined"
          fullWidth
          error={!!errors.confirmPassword}
          helperText={errors?.confirmPassword?.message}
        />

        <Button type="submit" variant="contained" size="large" disabled={submitting}>
          {submitting ? 'Activating...' : 'Activate Account'}
        </Button>
      </form>
    </main>
  );
}

export default AcceptInvitePage;
