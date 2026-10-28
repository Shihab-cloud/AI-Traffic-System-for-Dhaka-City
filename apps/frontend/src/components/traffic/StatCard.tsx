'use client';

import { Box, Paper, Typography, alpha } from '@mui/material';

import type { IconType } from '@/lib/icons';

/** One number with a label, for the tops of dashboards. */
export default function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'primary',
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: IconType;
  tone?: 'primary' | 'warning' | 'success' | 'error' | 'info';
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, display: 'flex', gap: 1.5, alignItems: 'center', minWidth: 0 }}>
      {Icon && (
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            flex: '0 0 auto',
            color: `${tone}.main`,
            bgcolor: (t) => alpha(t.palette[tone].main, t.palette.mode === 'dark' ? 0.2 : 0.1),
            fontSize: 20,
          }}
        >
          <Icon />
        </Box>
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary" noWrap>
          {label}
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.3 }} noWrap>
          {value}
        </Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {hint}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}
