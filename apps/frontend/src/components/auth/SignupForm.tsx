import { Button, Checkbox, FormControlLabel, Link, TextField, Typography } from '@mui/material';
import { SubmitHandler, useForm } from 'react-hook-form';

import NextLink from 'next/link';
import PasswordField from '@/components/common/input/PasswordField';
import { RouteUrls } from '@/lib/routes/route.config';
import { SignupRequest } from '@/lib/dtos/request/auth.req';
import { SignupValidation } from '@/lib/validators/auth.validator';
import { zodResolver } from '@hookform/resolvers/zod';

interface SignupFormProps {
  onSubmit: SubmitHandler<SignupRequest>;
  /**
   * A sign-up is in flight, or has succeeded and the redirect has not landed
   * yet. Disables the button, relabels it, and short-circuits submit.
   */
  pending?: boolean;
}

export default function SignupForm({ onSubmit, pending = false }: SignupFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupRequest>({
    resolver: zodResolver(SignupValidation),
  });

  return (
    <form
      data-testid="signup-form"
      className="flex w-full flex-col gap-5"
      // Short-circuited inside `handleSubmit` as well as on the button: a
      // keyboard Enter in a text field submits the form without touching the
      // disabled button.
      onSubmit={handleSubmit((data, event) => (pending ? undefined : onSubmit(data, event)))}
    >
      <div className="flex flex-col gap-5 md:flex-row">
        <TextField
          {...register('firstName')}
          type="text"
          label="First Name"
          variant="outlined"
          fullWidth
          error={!!errors.firstName}
          helperText={errors?.firstName?.message}
        />

        <TextField
          {...register('lastName')}
          type="text"
          label="Last Name"
          variant="outlined"
          fullWidth
          error={!!errors.lastName}
          helperText={errors?.lastName?.message}
        />
      </div>

      <TextField
        {...register('email')}
        type="email"
        label="Email"
        variant="outlined"
        fullWidth
        error={!!errors.email}
        helperText={errors?.email?.message}
      />

      <PasswordField
        {...register('password')}
        label="Password"
        variant="outlined"
        fullWidth
        error={!!errors.password}
        helperText={errors?.password?.message}
      />

      <PasswordField
        {...register('confirmPassword')}
        label="Confirm Password"
        variant="outlined"
        fullWidth
        error={!!errors.confirmPassword}
        helperText={errors?.confirmPassword?.message}
      />

      <FormControlLabel
        required
        control={<Checkbox />}
        label={
          <Typography variant="body2" component={'span'}>
            I agree with{' '}
            <Link href={RouteUrls.terms} component={NextLink}>
              Terms
            </Link>
            {' & '}
            <Link href={RouteUrls.privacyPolicy} component={NextLink}>
              Privacy Policy
            </Link>
          </Typography>
        }
      />

      <Button type="submit" variant="contained" size="large" disabled={pending}>
        {pending ? 'Creating account…' : 'Create Account'}
      </Button>
    </form>
  );
}
