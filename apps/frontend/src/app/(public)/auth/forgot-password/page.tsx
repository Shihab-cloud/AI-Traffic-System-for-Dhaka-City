'use client';

import { Button, TextField, Typography, useTheme } from '@mui/material';

import AppLogo from '@/components/common/logo/AppLogo';
import { AuthBadge } from '@/components/auth/AuthTrafficPanel';
import { Icons } from '@/lib/icons';
import { ForgotPasswordRequest } from '@/lib/dtos/request/auth.req';
import { ForgotPasswordValidation } from '@/lib/validators/auth.validator';
import Link from 'next/link';
import { RouteUrls } from '@/lib/routes/route.config';
import toast from 'react-hot-toast';
import useAuthAction from '@/hooks/actions/useAuthAction';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';

function ForgotPasswordPage() {
  const theme = useTheme();
  const router = useRouter();

  const { forgotPasswordMutation } = useAuthAction();

  const {
    handleSubmit,
    register,
    formState: { errors },
  } = useForm<ForgotPasswordRequest>({
    resolver: zodResolver(ForgotPasswordValidation),
  });

  const onSubmit = (data: ForgotPasswordRequest) => {
    forgotPasswordMutation.mutate(data, {
      onSuccess: () => {
        toast.success('A recovery email has been sent to your email address');
        router.back();
      },
    });
  };

  return (
    <main className="flex flex-col items-center justify-center gap-6 p-8">
      <AppLogo size={35} />
      <AuthBadge icon={Icons.key} />

      <Typography
        variant="h5"
        sx={{
          textAlign: 'center',
        }}
      >
        Forgot your password?
      </Typography>
      <Typography variant="body1" color="text.secondary" className="max-w-2xl text-center">
        Don&apos;t worry, it happens to the best of us. Just enter your email address below and
        we&apos;ll send you a recovery link
      </Typography>

      <form className="flex w-full max-w-lg flex-col gap-5" onSubmit={handleSubmit(onSubmit)}>
        <TextField
          {...register('email')}
          type="email"
          label="Email"
          variant="outlined"
          fullWidth
          error={!!errors.email}
          helperText={errors?.email?.message}
        />

        <Button variant="contained" size="large" type="submit">
          Send Recovery Email
        </Button>

        <Typography
          sx={{
            textAlign: 'center',
          }}
        >
          Remember your password?{' '}
          <Link
            href={RouteUrls.auth.signin}
            className="font-semibold"
            style={{ color: theme.palette.primary.main }}
          >
            Sign In
          </Link>
        </Typography>
      </form>
    </main>
  );
}

export default ForgotPasswordPage;
