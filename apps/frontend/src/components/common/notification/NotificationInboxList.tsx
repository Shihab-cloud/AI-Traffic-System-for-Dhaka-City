'use client';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Paper,
  Skeleton,
  Stack,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { NotificationResponse } from '@/lib/dtos/response/notification.res';
import NotificationEmpty from './NotificationEmpty';
import NotificationItem from './NotificationItem';
import { getDeepLink } from '@/lib/notification/deep-link';
import type { AppRole } from '@/lib/notification/deep-link';
import useNotificationAction from '@/hooks/actions/useNotificationAction';
import { useInfiniteScrollSentinel } from '@/hooks/useInfiniteScrollSentinel';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth-client';

type Filter = 'all' | 'unread';

const PAGE_SIZE = 20;

/** Enough rows to fill the fold, so the skeleton describes the list rather than teasing it. */
const SKELETON_ROW_COUNT = 5;

/**
 * Full-page inbox list.
 *
 * - Infinite scroll via `useInfiniteScrollSentinel`.
 * - Filter toolbar toggles between all and unread (runs separate queries).
 * - Skeleton rows during initial fetch give immediate structural feedback.
 */
export default function NotificationInboxList() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role?.name as AppRole | undefined;
  const [filter, setFilter] = useState<Filter>('all');

  const { useInboxInfiniteQuery, useUnreadCountQuery, markReadMutation, markAllReadMutation } =
    useNotificationAction();
  const query = useInboxInfiniteQuery(PAGE_SIZE, filter === 'unread');
  const { data: unreadData } = useUnreadCountQuery();

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);

  const sentinelRef = useInfiniteScrollSentinel({
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    onLoadMore: query.fetchNextPage,
  });

  const handleItemClick = (notification: NotificationResponse) => {
    if (!notification.read) {
      markReadMutation.mutate(notification.id);
    }
    router.push(getDeepLink(notification.metadata, role));
  };

  /*
   * The four states are early returns rather than a ternary chain: nested in JSX
   * they read as one expression four levels deep, and the list branch — the only
   * one with real structure — ended up furthest from the eye.
   */
  const renderBody = () => {
    if (query.isLoading) {
      return (
        <Stack divider={<Divider />}>
          {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </Stack>
      );
    }

    if (query.isError) {
      // Not "please refresh the page": a full reload is the user's only recovery
      // there, and it drops any other unsaved state on the way.
      return (
        <Box sx={{ p: 2.5 }}>
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => query.refetch()}>
                Retry
              </Button>
            }
          >
            Failed to load notifications.
          </Alert>
        </Box>
      );
    }

    if (items.length === 0) return <NotificationEmpty variant="page" />;

    return (
      <Box>
        <Stack divider={<Divider />}>
          {items.map((n) => (
            <NotificationItem key={n.id} notification={n} onClick={handleItemClick} />
          ))}
        </Stack>

        {/* Outside the stack: a sentinel is not a row and must not earn a divider. */}
        <div ref={sentinelRef} />

        {query.isFetchingNextPage && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={20} />
          </Box>
        )}

        {!query.hasNextPage && (
          <Box sx={{ textAlign: 'center', fontSize: 12, color: 'text.disabled', py: 3 }}>
            You&apos;re all caught up.
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2.5,
          py: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </FilterButton>
          <FilterButton active={filter === 'unread'} onClick={() => setFilter('unread')}>
            Unread
          </FilterButton>
        </Box>
        <Button
          size="small"
          onClick={() => markAllReadMutation.mutate(undefined)}
          disabled={!unreadData?.count || markAllReadMutation.isPending}
          sx={{ textTransform: 'none', fontSize: 13 }}
        >
          Mark all read
        </Button>
      </Box>

      {renderBody()}
    </Paper>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="small"
      variant={active ? 'contained' : 'text'}
      onClick={onClick}
      sx={{ textTransform: 'none', fontSize: 13, minWidth: 68 }}
    >
      {children}
    </Button>
  );
}

function SkeletonRow() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, px: 2.5, py: 1.75 }}>
      <Skeleton variant="circular" width={36} height={36} />
      <Box sx={{ flexGrow: 1 }}>
        <Skeleton width="40%" height={16} />
        <Skeleton width="80%" height={14} sx={{ mt: 0.5 }} />
        <Skeleton width="20%" height={12} sx={{ mt: 0.5 }} />
      </Box>
    </Box>
  );
}
