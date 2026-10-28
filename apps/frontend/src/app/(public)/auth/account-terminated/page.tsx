'use client';

import AppLogo from '@/components/common/logo/AppLogo';
import { authClient } from '@/lib/auth-client';
import { RouteUrls } from '@/lib/routes/route.config';
import { Box, Button, Typography } from '@mui/material';
import { useRouter } from 'next/navigation';
import { Icons } from '@/lib/icons';

export default function AccountTerminatedPage() {
  const router = useRouter();

  const handleSignOut = async () => {
    await authClient.signOut();
    router.replace(RouteUrls.auth.signin);
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Box className="flex max-w-md flex-col items-center gap-6 text-center">
        <AppLogo size={35} />

        <Box
          sx={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            backgroundColor: 'primary.main',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'primary.contrastText',
          }}
        >
          <Icons.info size={36} />
        </Box>

        <Typography
          variant="h4"
          sx={{
            fontWeight: 700,
          }}
        >
          Account Inactive
        </Typography>

        <Typography variant="body1" color="text.secondary">
          Your account is no longer active on this platform. If you have any questions, please reach
          out to your administrator for assistance.
        </Typography>

        <Button
          onClick={handleSignOut}
          variant="contained"
          color="primary"
          size="large"
          sx={{ borderRadius: 9999, px: 4 }}
        >
          Sign Out
        </Button>
      </Box>
    </main>
  );
}
