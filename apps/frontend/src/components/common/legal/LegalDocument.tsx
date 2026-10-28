'use client';

import { Box, Link, Stack, Typography } from '@mui/material';
import NextLink from 'next/link';
import type { ReactNode } from 'react';

import Footer from '@/components/common/footer/Footer';
import AppLogo from '@/components/common/logo/AppLogo';
import { LEGAL_CONFIG } from '@/lib/constants/legal.config';
import { RouteUrls } from '@/lib/routes/route.config';
import { Icons } from '@/lib/icons';

export interface LegalSection {
  /** The anchor the contents list links to — stable, so a link someone shared keeps working. */
  id: string;
  title: string;
  content: ReactNode;
}

interface LegalDocumentProps {
  title: string;
  /** One or two sentences under the title: what the document covers and for whom. */
  summary: string;
  sections: LegalSection[];
  /** The other legal document, linked at the end so a reader of one finds the other. */
  related: { label: string; href: string };
}

/**
 * The frame both legal pages share: a hero with the date it was last changed, the sections with a
 * contents list beside them on a wide screen, and the app footer.
 *
 * Public pages have no app shell, so this carries its own way back — the logo and a "Back to the
 * app" link — and is readable signed out, since the sign-up form links here.
 */
export default function LegalDocument({ title, summary, sections, related }: LegalDocumentProps) {
  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
      }}
    >
      <Box
        component="header"
        sx={{
          px: { xs: 2, md: 4 },
          py: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        {/* The logo is its own link home. */}
        <AppLogo size={26} />
        <Link
          component={NextLink}
          href={RouteUrls.root}
          variant="body2"
          underline="hover"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 500 }}
        >
          <Icons.back size={16} />
          Back to the app
        </Link>
      </Box>

      <Box
        sx={{
          position: 'relative',
          pt: { xs: 5, md: 7 },
          pb: { xs: 4, md: 5 },
          px: 2,
          textAlign: 'center',
          borderBottom: 1,
          borderColor: 'divider',
          overflow: 'hidden',
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background: (theme) =>
              `radial-gradient(ellipse at 50% 0%, ${theme.palette.primary.main}12, transparent 60%)`,
            pointerEvents: 'none',
          }}
        />
        <Stack
          spacing={1.5}
          sx={{ alignItems: 'center', position: 'relative', maxWidth: 680, mx: 'auto' }}
        >
          <Stack
            direction="row"
            spacing={0.75}
            sx={{
              alignItems: 'center',
              bgcolor: 'action.hover',
              border: 1,
              borderColor: 'divider',
              borderRadius: 999,
              px: 1.25,
              py: 0.25,
            }}
          >
            <Icons.legal size={12} />
            <Typography variant="caption" sx={{ fontWeight: 600, letterSpacing: 1 }}>
              LEGAL
            </Typography>
          </Stack>
          <Typography
            variant="h1"
            sx={{
              fontWeight: 700,
              fontSize: { xs: '1.875rem', sm: '2.25rem', md: '2.5rem' },
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontSize: { xs: '0.9375rem', md: '1rem' }, maxWidth: 560 }}
          >
            {summary}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Last updated {LEGAL_CONFIG.lastUpdated}
          </Typography>
        </Stack>
      </Box>

      <Box
        sx={{
          mx: 'auto',
          width: '100%',
          maxWidth: 1080,
          px: { xs: 2, md: 4 },
          pt: { xs: 4, md: 6 },
          pb: { xs: 8, md: 12 },
          display: 'grid',
          gap: { xs: 4, lg: 8 },
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: '220px minmax(0, 1fr)' },
          alignItems: 'start',
        }}
      >
        {/* Beside the text on a wide screen; on a narrow one the headings are the contents. */}
        <Box
          component="nav"
          aria-label="On this page"
          sx={{ display: { xs: 'none', lg: 'block' }, position: 'sticky', top: 24 }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontWeight: 600, letterSpacing: 1, display: 'block', mb: 1.5 }}
          >
            ON THIS PAGE
          </Typography>
          <Stack spacing={1}>
            {sections.map((section, index) => (
              <Link
                key={section.id}
                href={`#${section.id}`}
                variant="body2"
                color="text.secondary"
                underline="hover"
              >
                {index + 1}. {section.title}
              </Link>
            ))}
          </Stack>
        </Box>

        <Box component="article" sx={{ maxWidth: 720, display: 'grid', gap: { xs: 4, md: 5 } }}>
          {sections.map((section, index) => (
            <Box
              component="section"
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-title`}
              sx={{ scrollMarginTop: 24, display: 'grid', gap: 1.5 }}
            >
              <Typography
                id={`${section.id}-title`}
                variant="h2"
                sx={{ fontSize: { xs: '1.25rem', md: '1.375rem' }, fontWeight: 600 }}
              >
                {index + 1}. {section.title}
              </Typography>
              {section.content}
            </Box>
          ))}

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ pt: 2, borderTop: 1, borderColor: 'divider' }}
          >
            See also the{' '}
            <Link component={NextLink} href={related.href}>
              {related.label}
            </Link>
            .
          </Typography>
        </Box>
      </Box>

      <Footer />
    </Box>
  );
}
