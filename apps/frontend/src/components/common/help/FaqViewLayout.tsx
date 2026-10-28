'use client';

import FaqContactSupportCard, {
  FaqContactCta,
} from '@/components/common/help/FaqContactSupportCard';
import FaqSectionsList from '@/components/common/help/FaqSectionsList';
import { FaqResponse } from '@/lib/dtos/response/faq.res';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { ReactNode } from 'react';
import { Icons } from '@/lib/icons';

interface FaqViewLayoutProps {
  items: FaqResponse[];
  isFetching: boolean;
  contactCta: FaqContactCta;
  canManage?: boolean;
  onCreateClick?: () => void;
  onEdit?: (faq: FaqResponse) => void;
  onDelete?: (faq: FaqResponse) => void;
  onItemsChange?: (items: FaqResponse[]) => void;
  reorderBar?: ReactNode;
  modals?: ReactNode;
}

export default function FaqViewLayout({
  items,
  isFetching,
  contactCta,
  canManage = false,
  onCreateClick,
  onEdit,
  onDelete,
  onItemsChange,
  reorderBar,
  modals,
}: FaqViewLayoutProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          position: 'relative',
          pt: { xs: 5, md: 7 },
          pb: { xs: 4, md: 5 },
          px: 2,
          textAlign: 'center',
          borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
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
          sx={{
            alignItems: 'center',
            position: 'relative',
            maxWidth: 680,
            mx: 'auto',
          }}
        >
          <Stack
            direction="row"
            spacing={0.75}
            sx={{
              alignItems: 'center',
              bgcolor: 'action.hover',
              border: (theme) => `1px solid ${theme.palette.divider}`,
              borderRadius: 999,
              px: 1.25,
              py: 0.25,
            }}
          >
            <Icons.question size={12} />
            <Typography
              variant="caption"
              sx={{
                fontWeight: 600,
                letterSpacing: 1,
              }}
            >
              HELP CENTER
            </Typography>
          </Stack>

          <Typography
            variant="h2"
            sx={{
              fontWeight: 700,
              fontSize: { xs: '1.875rem', sm: '2.25rem', md: '2.5rem' },
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
            }}
          >
            Frequently Asked Questions
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontSize: { xs: '0.9375rem', md: '1rem' }, maxWidth: 520 }}
          >
            Find answers to the most common questions about the platform.
          </Typography>

          {canManage && onCreateClick && (
            <Button
              startIcon={<Icons.add />}
              variant="contained"
              color="primary"
              size="small"
              onClick={onCreateClick}
              sx={{ borderRadius: 9999, mt: 0.5 }}
            >
              New FAQ
            </Button>
          )}
        </Stack>
      </Box>

      <Box
        sx={{
          mx: 'auto',
          width: '100%',
          maxWidth: 820,
          px: { xs: 2, md: 4 },
          pt: { xs: 5, md: 7 },
          pb: { xs: 8, md: 12 },
        }}
      >
        {isFetching ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
            <CircularProgress />
          </Box>
        ) : items.length === 0 ? (
          <EmptyState canManage={canManage} onCreateClick={onCreateClick} />
        ) : (
          <FaqSectionsList
            items={items}
            canManage={canManage}
            onItemsChange={onItemsChange ?? (() => {})}
            onEdit={onEdit ?? (() => {})}
            onDelete={onDelete ?? (() => {})}
          />
        )}

        <FaqContactSupportCard cta={contactCta} />
      </Box>

      {reorderBar}
      {modals}
    </Box>
  );
}

function EmptyState({
  canManage,
  onCreateClick,
}: {
  canManage: boolean;
  onCreateClick?: () => void;
}) {
  return (
    <Stack
      spacing={2}
      sx={{
        alignItems: 'center',
        justifyContent: 'center',
        py: 10,
        textAlign: 'center',
      }}
    >
      <Box
        sx={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          bgcolor: 'action.hover',
          color: 'text.secondary',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icons.question size={32} />
      </Box>
      <Typography
        variant="h6"
        sx={{
          fontWeight: 600,
        }}
      >
        No FAQs yet
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
        {canManage
          ? 'Create your first FAQ so users can find quick answers.'
          : 'Check back soon — answers to common questions will appear here.'}
      </Typography>
      {canManage && onCreateClick && (
        <Button
          startIcon={<Icons.add />}
          variant="contained"
          color="primary"
          onClick={onCreateClick}
          sx={{ mt: 1, borderRadius: 9999 }}
        >
          Create the first FAQ
        </Button>
      )}
    </Stack>
  );
}
