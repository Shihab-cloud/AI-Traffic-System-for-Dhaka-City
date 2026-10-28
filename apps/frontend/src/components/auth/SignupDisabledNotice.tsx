'use client';

import { Button, Stack, Typography } from '@mui/material';

import { accessRequestMailto } from '@/lib/utils/url.util';
import { Icons } from '@/lib/icons';

/**
 * Shown in place of the sign-up form when an admin has turned off self-serve
 * registration (`signupEnabled` in system settings).
 *
 * The address comes from `NEXT_PUBLIC_SUPPORT_EMAIL`. When it is unset the
 * button is dropped entirely; the sentence on its own still tells the visitor
 * what to do. Read inside the component (not at module scope) so tests can
 * stub the variable per case.
 */
export default function SignupDisabledNotice() {
  const mailto = accessRequestMailto(process.env.NEXT_PUBLIC_SUPPORT_EMAIL);

  return (
    <Stack sx={{ gap: 2.5, textAlign: 'center' }}>
      <Typography sx={{ color: 'text.secondary' }}>
        Sign-up is currently closed. Accounts are created by an administrator.
      </Typography>

      {mailto && (
        <Button
          variant="contained"
          size="large"
          fullWidth
          startIcon={<Icons.emailSent />}
          component="a"
          href={mailto}
        >
          Request access
        </Button>
      )}
    </Stack>
  );
}
