'use client';

import { Box, Divider, Paper, Stack, Typography } from '@mui/material';
import { ReactNode } from 'react';

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  /** Optional band below the rows, on `background.default` — for a hint or a bulk action. */
  footer?: ReactNode;
}

/**
 * The settings card primitive: an outlined `Paper` with a title/description
 * header, then its children stacked and separated by dividers.
 *
 * Every settings screen used to hand-roll this — `Paper variant="outlined"` plus
 * `Box px:3 pt:2.5 pb:1` plus a `<Divider />` interleaved between each row —
 * which is ~60 lines per screen and one easy place to get the divider rhythm
 * wrong (a trailing divider, or none between the last two rows). `Stack
 * divider={…}` places them for you, so children are just rows.
 */
export default function SettingsSection({
  title,
  description,
  children,
  footer,
}: SettingsSectionProps) {
  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box sx={{ px: 3, py: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        {description && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
            {description}
          </Typography>
        )}
      </Box>

      <Divider />

      <Stack divider={<Divider />}>{children}</Stack>

      {footer && (
        <>
          <Divider />
          <Box sx={{ px: 3, py: 1.5, bgcolor: 'background.default' }}>{footer}</Box>
        </>
      )}
    </Paper>
  );
}
