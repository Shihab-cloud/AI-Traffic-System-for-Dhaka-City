'use client';

import { IconButton, Tooltip } from '@mui/material';

interface TableActionButtonProps {
  /** Shown on hover and read by a screen reader — the icon alone says nothing to either. */
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  color?: 'default' | 'primary' | 'error' | 'warning';
  disabled?: boolean;
}

/**
 * Width of a row-actions column holding `count` of these side by side: 40px a button plus the
 * actions cell's 12px padding each side. Any less and the buttons wrap onto a second line.
 */
export const tableActionsWidth = (count: number) => 24 + count * 40;

/** One action in a table row's actions column, as an icon button. */
export default function TableActionButton({
  title,
  icon,
  onClick,
  color = 'default',
  disabled,
}: TableActionButtonProps) {
  return (
    <Tooltip title={title}>
      {/* A disabled button fires no events, so the tooltip needs an element that does. */}
      <span>
        {/* Default size, not small: 40px is a fingertip, and what `tableActionsWidth` budgets. */}
        <IconButton aria-label={title} color={color} disabled={disabled} onClick={onClick}>
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}
