import { useEffect, useState } from 'react';
import { Button, Skeleton, Stack } from '@mui/material';
import PasswordField from '../common/input/PasswordField';
import { PasswordUpdateRequest } from '@/lib/dtos/request/user.req';
import { PasswordUpdateValidation } from '@/lib/validators/user.validator';
import SectionHeader from '../settings/SectionHeader';
import { authClient } from '@/lib/auth-client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

interface ProfileUpdateFormProps {
  onSubmit: (data: PasswordUpdateRequest) => void;
}

export default function PasswordUpdateForm({ onSubmit }: ProfileUpdateFormProps) {
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
    reset,
    formState: { errors },
  } = useForm<PasswordUpdateRequest>({
    resolver: zodResolver(PasswordUpdateValidation),
  });

  // This form's shape depends on whether the user has a credential account, so it
  // cannot render until the probe resolves. Show the form's own outline rather
  // than a spinner: header, then the field rows, then the submit button.
  if (loadingAccounts) {
    return (
      <Stack spacing={1.75}>
        <Skeleton variant="rounded" height={44} width="60%" />
        <Skeleton variant="rounded" height={44} />
        <Skeleton variant="rounded" height={44} />
        <Skeleton variant="rounded" height={40} width={160} />
      </Stack>
    );
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)}>
      <SectionHeader
        title="Password Information"
        subtitle={
          hasCredentialAccount
            ? 'Update your password to keep your account secure.'
            : 'Set a password to enable email/password sign-in for your account.'
        }
      />

      {hasCredentialAccount && (
        <PasswordField
          {...register('oldPassword')}
          autoComplete="current-password"
          label="Current Password"
          placeholder="Enter your current password"
          variant="outlined"
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
        error={!!errors.newPassword}
        helperText={errors?.newPassword?.message}
      />

      <PasswordField
        {...register('confirmNewPassword')}
        autoComplete="new-password"
        label="Confirm New Password"
        placeholder="Re-enter your new password"
        variant="outlined"
        error={!!errors.confirmNewPassword}
        helperText={errors?.confirmNewPassword?.message}
      />

      <div className="col-span-full flex justify-end gap-3">
        <Button variant="outlined" color="ghost" onClick={() => reset()}>
          Cancel
        </Button>
        <Button type="submit" variant="contained">
          Update
        </Button>
      </div>
    </form>
  );
}
