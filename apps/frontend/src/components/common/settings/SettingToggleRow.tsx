'use client';

import { Box, CircularProgress, FormControlLabel, Switch, Typography } from '@mui/material';
import { ReactNode, useId } from 'react';

interface SettingToggleRowProps {
  title: ReactNode;
  /** Secondary line shown under the title. */
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  /**
   * This row's own save is in flight — shows a spinner beside its switch.
   *
   * Separate from `disabled` because a screen that saves one setting at a time
   * disables *every* row while any one is writing; without this the whole card
   * greys out and nothing says which toggle caused it.
   */
  pending?: boolean;
  onChange: (next: boolean) => void;
}

/**
 * A single labelled toggle row — title + description on the left, a Switch on
 * the right. Designed to sit inside an outlined `Paper` card, stacked and
 * separated by `Divider`s (see the notification + app settings screens).
 */
export default function SettingToggleRow({
  title,
  description,
  checked,
  disabled,
  pending = false,
  onChange,
}: SettingToggleRowProps) {
  const titleId = useId();

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', px: 3, py: 2 }} aria-busy={pending}>
      <Box sx={{ flexGrow: 1, pr: 2 }}>
        <Typography
          id={titleId}
          sx={{
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {title}
        </Typography>
        {description && (
          <Typography
            sx={{
              fontSize: 12,
              color: 'text.secondary',
            }}
          >
            {description}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        {/* Reserves its width always, so a row does not shift sideways when a save starts. */}
        <Box sx={{ width: 16, height: 16, display: 'grid', placeItems: 'center' }}>
          {pending && <CircularProgress size={16} />}
        </Box>
        {/*
          `FormControlLabel` needs a visible `label` to name the control; this
          row already shows the name via the title `Typography` above, so the
          label stays empty and the Switch's own input is named through
          `aria-labelledby` instead — otherwise the checkbox has no accessible
          name at all.
        */}
        <FormControlLabel
          label=""
          sx={{ mr: 0 }}
          control={
            <Switch
              checked={checked}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked)}
              slotProps={{ input: { 'aria-labelledby': titleId } }}
            />
          }
        />
      </Box>
    </Box>
  );
}
