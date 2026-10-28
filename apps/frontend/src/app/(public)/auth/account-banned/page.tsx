'use client';

import AppLogo from '@/components/common/logo/AppLogo';
import { RouteUrls } from '@/lib/routes/route.config';
import { supportMailto } from '@/lib/utils/url.util';
import { Box, Button, Typography } from '@mui/material';
import NextLink from 'next/link';
import { Icons } from '@/lib/icons';

export default function AccountBannedPage() {
  // Same address, and the same checks, as the sign-up notice. Without a usable one the button is
  // left out and the sentence points to the administrator instead.
  const mailto = supportMailto({
    supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
    subject: 'Suspended account',
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Box className="flex max-w-md flex-col items-center gap-6 text-center">
        <AppLogo size={35} />

        <Box
          sx={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            backgroundColor: 'error.main',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.9,
          }}
        >
          <Typography
            sx={{
              fontSize: 40,
            }}
          >
            !
          </Typography>
        </Box>

        <Typography
          variant="h4"
          sx={{
            fontWeight: 700,
          }}
        >
          Account Suspended
        </Typography>

        <Typography variant="body1" color="text.secondary">
          Your account has been suspended by an administrator. If you believe this is an error,
          please contact {mailto ? 'support' : 'your administrator'} for assistance.
        </Typography>

        {mailto && (
          <Button
            variant="contained"
            color="primary"
            size="large"
            startIcon={<Icons.email />}
            href={mailto}
            sx={{ borderRadius: 9999, px: 4 }}
          >
            Contact Support
          </Button>
        )}

        <Button component={NextLink} href={RouteUrls.auth.signin} color="inherit" size="small">
          Back to Sign In
        </Button>
      </Box>
    </main>
  );
}
