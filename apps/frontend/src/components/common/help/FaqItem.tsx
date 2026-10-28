'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { FaqResponse } from '@/lib/dtos/response/faq.res';
import { Icons } from '@/lib/icons';

interface FaqItemProps {
  faq: FaqResponse;
  canManage: boolean;
  onEdit?: (faq: FaqResponse) => void;
  onDelete?: (faq: FaqResponse) => void;
}

export default function FaqItem({ faq, canManage, onEdit, onDelete }: FaqItemProps) {
  const [open, setOpen] = useState(false);

  return (
    <Box
      id={`faq-${faq.id}`}
      sx={{
        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        '&:last-of-type': { borderBottom: 0 },
        '& .faq-admin-actions': {
          opacity: { xs: 1, md: 0 },
          transition: 'opacity 0.15s ease',
        },
        '&:hover .faq-admin-actions': { opacity: 1 },
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        sx={{
          all: 'unset',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          width: '100%',
          py: 2.75,
          cursor: 'pointer',
          transition: 'background-color 0.15s ease',
          borderRadius: 1,
          mx: -1.5,
          px: 1.5,
          '&:hover': { bgcolor: 'action.hover' },
          '&:focus-visible': {
            outline: (theme) => `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
        }}
      >
        <Typography
          variant="body1"
          sx={{
            fontWeight: 600,
            flex: 1,
            fontSize: { xs: '1rem', md: '1.0625rem' },
            lineHeight: 1.5,
          }}
        >
          {faq.question}
        </Typography>

        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          {!faq.isPublished && canManage && (
            <Chip
              size="small"
              label="Draft"
              sx={{
                fontWeight: 600,
                bgcolor: 'warning.main',
                color: 'warning.contrastText',
              }}
            />
          )}

          {canManage && (
            <Stack
              direction="row"
              spacing={0.25}
              className="faq-admin-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <Tooltip title="Edit">
                <IconButton size="small" onClick={() => onEdit?.(faq)}>
                  <Icons.edit size={16} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete">
                <IconButton size="small" color="error" onClick={() => onDelete?.(faq)}>
                  <Icons.delete size={16} />
                </IconButton>
              </Tooltip>
            </Stack>
          )}

          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: open ? 'primary.main' : 'action.hover',
              color: open ? 'primary.contrastText' : 'text.primary',
              transition: 'background-color 0.2s ease, color 0.2s ease, transform 0.2s ease',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              ml: 1,
            }}
          >
            <Icons.expand size={20} />
          </Box>
        </Stack>
      </Box>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <Box sx={{ pb: 3, pr: { xs: 0, md: 6 } }}>
              <Typography
                variant="body1"
                sx={{
                  color: 'text.secondary',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.75,
                }}
              >
                {faq.answer}
              </Typography>
            </Box>
          </motion.div>
        )}
      </AnimatePresence>
    </Box>
  );
}
