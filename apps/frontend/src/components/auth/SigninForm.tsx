import { Button, Link, TextField } from '@mui/material';
import { SubmitHandler, useForm } from 'react-hook-form';

import NextLink from 'next/link';
import PasswordField from '@/components/common/input/PasswordField';
import { RouteUrls } from '@/lib/routes/route.config';
import { SigninRequest } from '@/lib/dtos/request/auth.req';
import { SigninValidation } from '@/lib/validators/auth.validator';
import { zodResolver } from '@hookform/resolvers/zod';

interface SigninFormProps {
  onSubmit: SubmitHandler<SigninRequest>;
  /**
   * A sign-in is in flight, or has succeeded and the redirect has not landed
   * yet. Disables the button, relabels it, and short-circuits submit.
   */
  pending?: boolean;
}

export default function SigninForm({ onSubmit, pending = false }: SigninFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SigninRequest>({ resolver: zodResolver(SigninValidation) });

  return (
    <form
      data-testid="signin-form"
      className="flex w-full flex-col gap-5"
      // Short-circuited inside `handleSubmit` as well as on the button: a
      // keyboard Enter in a text field submits the form without touching the
      // disabled button.
      onSubmit={handleSubmit((data, event) => (pending ? undefined : onSubmit(data, event)))}
    >
      <TextField
        {...register('identifier')}
        type="text"
        label="Email or username"
        variant="outlined"
        fullWidth
        autoComplete="username"
        error={!!errors.identifier}
        helperText={errors?.identifier?.message}
      />

      <PasswordField
        {...register('password')}
        label="Password"
        variant="outlined"
        fullWidth
        error={!!errors.password}
        helperText={errors?.password?.message}
      />

      <Link
        component={NextLink}
        href={RouteUrls.auth.forgotPassword}
        sx={{
          fontWeight: 600,
          ml: 'auto',
        }}
      >
        Forgot password?
      </Link>

      <Button type="submit" variant="contained" size="large" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign In'}
      </Button>
    </form>
  );
}
