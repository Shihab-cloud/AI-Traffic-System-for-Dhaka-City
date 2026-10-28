'use client';

import MfaSettings from '@/components/auth/MfaSettings';
import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import EmailVerificationBanner from '@/components/dashboard/EmailVerificationBanner';
import PasswordUpdateForm from '@/components/profile/PasswordUpdateForm';
import ProfileUpdateForm from '@/components/profile/ProfileUpdateForm';
import useUserAction from '@/hooks/actions/useUserAction';
import { PasswordUpdateRequest, ProfileUpdateRequest } from '@/lib/dtos/request/user.req';
import { Skeleton, Stack } from '@mui/material';
import toast from 'react-hot-toast';
import { Icons } from '@/lib/icons';

export default function Page() {
  const { useProfileQuery, updateProfileMutation, updatePasswordMutation } = useUserAction();
  const { data: profile } = useProfileQuery();

  const onProfileSubmit = (data: ProfileUpdateRequest) => {
    updateProfileMutation.mutate(data, {
      onSuccess: () => toast.success('Profile updated successfully'),
    });
  };

  const onPasswordSubmit = (data: PasswordUpdateRequest) => {
    updatePasswordMutation.mutate(data, {
      onSuccess: () => toast.success('Password updated successfully'),
    });
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Account and Security"
        subtitle="Your profile details, your password, and two-step verification."
        icon={Icons.security}
        width="3xl"
      />

      <PageBody width="3xl">
        {profile ? (
          <Stack sx={{ gap: 4 }}>
            <ProfileUpdateForm data={profile} onSubmit={onProfileSubmit} />
            <EmailVerificationBanner dismissable={false} />
            <PasswordUpdateForm onSubmit={onPasswordSubmit} />
            <MfaSettings />
          </Stack>
        ) : (
          // Blocks at the heights of the three cards that are about to appear, in the same Stack
          // rhythm — the page's shape is the useful thing to show while the profile loads.
          <Stack spacing={1.75}>
            <Skeleton variant="rounded" height={68} />
            <Skeleton variant="rounded" height={152} />
            <Skeleton variant="rounded" height={132} />
          </Stack>
        )}
      </PageBody>
    </div>
  );
}
