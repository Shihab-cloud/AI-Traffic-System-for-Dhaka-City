'use client';

import { Fab, Typography } from '@mui/material';
import { useRouter } from 'next/navigation';

import { AuthBadge } from '@/components/auth/AuthTrafficPanel';
import { Icons } from '@/lib/icons';

export default function UnauthorizedPage() {
  const router = useRouter();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 p-8">
      <AuthBadge icon={Icons.noAccess} tone="error" />
      <Typography variant="h5" sx={{ fontWeight: 600, textAlign: 'center' }}>
        No access to this page
      </Typography>
      <Typography variant="body1" color="text.secondary" className="max-w-xl text-center">
        Your account does not have the role this page needs. If you should have it, ask an
        administrator.
      </Typography>

      <Fab
        variant="extended"
        color="primary"
        sx={{
          width: '300px',
        }}
        onClick={() => router.back()}
      >
        Take me back
      </Fab>
    </div>
  );
}
