import { Button, TextField } from '@mui/material';
import { SubmitHandler, useForm } from 'react-hook-form';

import PasswordField from '@/components/common/input/PasswordField';
import { ActivateAccountForm as ActivateAccountFormValues } from '@/lib/dtos/request/activate.req';
import { ActivateAccountValidation } from '@/lib/validators/auth.validator';
import { zodResolver } from '@hookform/resolvers/zod';

interface ActivateAccountFormProps {
  onSubmit: SubmitHandler<ActivateAccountFormValues>;
  submitting?: boolean;
  /** Pre-fill the email field. Magic-link onboarded users already have one
   *  on their account — the field stays editable so they can correct a typo. */
  defaultEmail?: string;
}

export default function ActivateAccountForm({
  onSubmit,
  submitting = false,
  defaultEmail = '',
}: ActivateAccountFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ActivateAccountFormValues>({
    resolver: zodResolver(ActivateAccountValidation),
    defaultValues: { newPassword: '', confirmPassword: '', email: defaultEmail },
  });

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
      <TextField
        {...register('email')}
        type="email"
        label="Email"
        variant="outlined"
        fullWidth
        autoComplete="email"
        error={!!errors.email}
        helperText={
          errors.email?.message ??
          "We'll send a verification link so you can recover your password later."
        }
      />
      <PasswordField
        {...register('newPassword')}
        label="New password"
        variant="outlined"
        fullWidth
        error={!!errors.newPassword}
        helperText={errors.newPassword?.message}
      />
      <PasswordField
        {...register('confirmPassword')}
        label="Confirm new password"
        variant="outlined"
        fullWidth
        error={!!errors.confirmPassword}
        helperText={errors.confirmPassword?.message}
      />

      <Button type="submit" variant="contained" size="large" disabled={submitting}>
        {submitting ? 'Activating…' : 'Activate account'}
      </Button>
    </form>
  );
}
