'use client';

import { Alert, AlertTitle, Skeleton } from '@mui/material';

import UserDetails from '@/components/user-management/UserDetails';
import { use } from 'react';
import useUserAction from '@/hooks/actions/useUserAction';

interface PageProps {
  params: Promise<{
    userId: string;
  }>;
}

export default function Page({ params }: PageProps) {
  const { userId } = use(params);
  const { useUserQuery } = useUserAction();

  const { data, isLoading } = useUserQuery(userId);

  if (isLoading) return <Skeleton variant="rectangular" height={400} className="p-4" />;

  if (!data)
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        <AlertTitle>Error</AlertTitle>
        Oops! It seems like the data you are looking for is not available.
      </Alert>
    );

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <UserDetails data={data} />
    </div>
  );
}
