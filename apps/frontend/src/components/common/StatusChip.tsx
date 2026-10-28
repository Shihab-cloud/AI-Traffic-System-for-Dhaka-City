'use client';

import { Chip } from '@mui/material';

/**
 * Keys are lowercase; lookups normalise, because every call site passes an
 * UPPERCASE enum value (`SupportTicketStatusEnum.SUBMITTED === 'SUBMITTED'`).
 */
const statusColorMap: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  // Generic statuses
  active: 'success',
  inactive: 'error',
  banned: 'error',
  password_missing: 'warning',
  invited: 'info',
  pending: 'warning',
  // Ticket statuses
  submitted: 'info',
  in_review: 'warning',
  resolved: 'success',
  // Ticket priorities
  low: 'default',
  medium: 'info',
  high: 'warning',
  critical: 'error',
  // Traffic: violations, tickets, reviews, payments, surveillance runs, plate reads
  new: 'warning',
  ticketed: 'success',
  dismissed: 'default',
  unpaid: 'warning',
  under_review: 'info',
  paid: 'success',
  cancelled: 'default',
  overdue: 'error',
  accepted: 'success',
  rejected: 'error',
  succeeded: 'success',
  failed: 'error',
  starting: 'info',
  running: 'success',
  finished: 'default',
  stopped: 'default',
  error: 'error',
  idle: 'default',
  confirmed: 'success',
  uncertain: 'warning',
  partial: 'warning',
  unreadable: 'default',
  'no plate found': 'default',
};

interface StatusChipProps {
  /**
   * Nullable: support-log components pass `details?.oldStatus`, an unchecked
   * cast off a stored JSON blob that is genuinely absent on older rows.
   */
  status?: string | null;
  variant?: 'filled' | 'outlined';
  size?: 'small' | 'medium';
}

/** `IN_REVIEW` → `In Review`. */
function toLabel(status: string): string {
  return status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function StatusChip({
  status,
  variant = 'outlined',
  size = 'small',
}: StatusChipProps) {
  if (!status) return null;

  const color = statusColorMap[status.toLowerCase()] ?? 'default';

  return <Chip label={toLabel(status)} color={color} variant={variant} size={size} />;
}
