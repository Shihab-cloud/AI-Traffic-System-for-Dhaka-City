'use client';

import { Alert, AlertTitle, Skeleton } from '@mui/material';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import UserDetails from '@/components/user-management/UserDetails';
import useUserAction from '@/hooks/actions/useUserAction';
import { Icons } from '@/lib/icons';

export default function Profile() {
  const { useProfileQuery } = useUserAction();
  const { data, isLoading } = useProfileQuery();

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Profile"
        subtitle="Your details, your role, and what that role lets you do."
        icon={Icons.profile}
        width="6xl"
      />

      <PageBody width="6xl" className="flex flex-col items-center">
        {isLoading ? (
          <Skeleton variant="rounded" height={400} className="w-full max-w-6xl" />
        ) : data ? (
          <UserDetails data={data} />
        ) : (
          <Alert severity="error" className="w-full max-w-6xl">
            <AlertTitle>Error</AlertTitle>
            Oops! It seems like the data you are looking for is not available.
          </Alert>
        )}
      </PageBody>
    </div>
  );
}
