'use client';

import Link from 'next/link';
import { Box, Button, Typography } from '@mui/material';
import { RouteUrls } from '@/lib/routes/route.config';
import { Icons } from '@/lib/icons';

export type FaqContactCta = { kind: 'signin' } | { kind: 'support-link'; href: string };

interface FaqContactSupportCardProps {
  cta: FaqContactCta;
}

export default function FaqContactSupportCard({ cta }: FaqContactSupportCardProps) {
  return (
    <Box
      sx={{
        mt: { xs: 8, md: 14 },
        p: { xs: 4, md: 6 },
        borderRadius: 3,
        bgcolor: 'background.paper',
        border: (theme) => `1px solid ${theme.palette.divider}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        textAlign: 'center',
      }}
    >
      <Box
        sx={{
          width: 48,
          height: 48,
          borderRadius: 2,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icons.support size={22} />
      </Box>
      <Typography
        variant="h5"
        sx={{
          fontWeight: 700,
        }}
      >
        Still need help?
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 420 }}>
        Reach out to our support team and we&apos;ll get back to you as soon as we can.
      </Typography>
      {cta.kind === 'signin' && (
        <Button
          component={Link}
          href={RouteUrls.auth.signin}
          variant="contained"
          color="primary"
          startIcon={<Icons.login />}
          sx={{ borderRadius: 9999, mt: 1 }}
        >
          Sign in to contact support
        </Button>
      )}
      {cta.kind === 'support-link' && (
        <Button
          component={Link}
          href={cta.href}
          variant="contained"
          color="primary"
          startIcon={<Icons.support />}
          sx={{ borderRadius: 9999, mt: 1 }}
        >
          Contact support
        </Button>
      )}
    </Box>
  );
}
