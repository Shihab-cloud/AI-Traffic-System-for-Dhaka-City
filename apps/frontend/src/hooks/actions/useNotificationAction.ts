'use client';

import { QUERY_KEYS } from '@/lib/constants/query-keys';
import notificationService from '@/lib/services/notification.service';
import { apiErrorMessage } from '@/lib/utils/common.util';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { useCallback } from 'react';
import toast from 'react-hot-toast';

type ApiError = AxiosError<{ message: string }>;

const INBOX_KEY = QUERY_KEYS.notification.getInbox;
const UNREAD_KEY = QUERY_KEYS.notification.getUnreadCount;
const SETTINGS_KEY = QUERY_KEYS.notification.getUserSettings;
const CHANNEL_SETTINGS_KEY = QUERY_KEYS.notification.getUserSettingsChannels;

/**
 * How often the inbox + unread-count queries refetch while their hooks
 * are mounted and the tab is visible. Polling is the fallback for users
 * who haven't enabled browser push; for users with push on, FCM's
 * onMessage handler provides near-instant updates.
 */
const NOTIFICATION_POLL_INTERVAL_MS = 60_000;

export default function useNotificationAction() {
  const queryClient = useQueryClient();

  const invalidateInbox = useCallback(() => {
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) => queryKey[0] === INBOX_KEY || queryKey[0] === UNREAD_KEY,
    });
  }, [queryClient]);

  const invalidateSettings = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [SETTINGS_KEY] });
  }, [queryClient]);

  const invalidateChannelSettings = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [CHANNEL_SETTINGS_KEY] });
  }, [queryClient]);

  /** Paginated inbox — used by the popover (first page only, short limit). */
  const useInboxQuery = (page = 1, limit = 10) =>
    useQuery({
      queryKey: [INBOX_KEY, { page, limit }],
      queryFn: () => notificationService.getInbox({ page, limit }),
      refetchInterval: NOTIFICATION_POLL_INTERVAL_MS,
      refetchIntervalInBackground: false,
    });

  /** Infinite inbox for the full /notifications page. */
  const useInboxInfiniteQuery = (limit = 20, unreadOnly?: boolean) =>
    useInfiniteQuery({
      queryKey: [INBOX_KEY, 'infinite', { limit, unreadOnly }],
      initialPageParam: 1,
      queryFn: ({ pageParam }) =>
        notificationService.getInbox({
          page: pageParam,
          limit,
          filter: unreadOnly ? ['read=false'] : undefined,
        }),
      getNextPageParam: (lastPage) => {
        const fetched = lastPage.page * lastPage.limit;
        return fetched < lastPage.total ? lastPage.page + 1 : undefined;
      },
      refetchInterval: NOTIFICATION_POLL_INTERVAL_MS,
      refetchIntervalInBackground: false,
    });

  const useUnreadCountQuery = () =>
    useQuery({
      queryKey: [UNREAD_KEY],
      queryFn: () => notificationService.getUnreadCount(),
      refetchInterval: NOTIFICATION_POLL_INTERVAL_MS,
      refetchIntervalInBackground: false,
    });

  const useUserSettingsQuery = () =>
    useQuery({
      queryKey: [SETTINGS_KEY],
      queryFn: () => notificationService.getUserSettings(),
    });

  const useUserSettingsChannelsQuery = () =>
    useQuery({
      queryKey: [CHANNEL_SETTINGS_KEY],
      queryFn: () => notificationService.getUserSettingsChannels(),
    });

  const markReadMutation = useMutation({
    mutationFn: (id: ID) => notificationService.markRead(id),
    onMutate: () => {
      // Optimistically decrement badge; invalidateInbox on success restores exact count
      queryClient.setQueryData([UNREAD_KEY], (old: { count: number } | undefined) =>
        old && old.count > 0 ? { count: old.count - 1 } : old,
      );
    },
    onSuccess: invalidateInbox,
    onError: (error: ApiError) => {
      toast.error(apiErrorMessage(error, 'Failed to mark notification as read.'));
      invalidateInbox();
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onSuccess: () => {
      toast.success('All notifications marked as read');
      invalidateInbox();
    },
    onError: (error: ApiError) => {
      toast.error(apiErrorMessage(error, 'Failed to mark all notifications as read.'));
    },
  });

  const registerDeviceTokenMutation = useMutation({
    mutationFn: notificationService.registerDeviceToken,
    onError: (error: ApiError) => {
      toast.error(
        apiErrorMessage(
          error,
          'An error occurred registering your device for push notifications. Please try again later.',
        ),
      );
    },
  });

  const unregisterDeviceTokenMutation = useMutation({
    mutationFn: (token: string) => notificationService.unregisterDeviceToken(token),
    onSuccess: () => {
      toast.success('Your device has been unregistered from push notifications.');
    },
    onError: (error: ApiError) => {
      toast.error(
        apiErrorMessage(
          error,
          'An error occurred unregistering your device from push notifications. Please try again later.',
        ),
      );
    },
  });

  // Toasts and cache invalidation are handled per-call by the consumer
  // so that global saves and channel toggles can invalidate independently.
  const updateUserSettingsMutation = useMutation({
    mutationFn: notificationService.updateUserSettings,
    onError: (error: ApiError) => {
      toast.error(apiErrorMessage(error, 'Failed to update notification settings.'));
    },
  });

  const broadcastMutation = useMutation({
    mutationFn: notificationService.broadcast,
    // No success toast here: the only caller raises its own in the user's
    // vocabulary, and both firing meant two toasts stacked on every send.
    onError: (error: ApiError) => {
      toast.error(apiErrorMessage(error, 'Failed to broadcast notification.'));
    },
  });

  return {
    useInboxQuery,
    useInboxInfiniteQuery,
    useUnreadCountQuery,
    useUserSettingsQuery,
    useUserSettingsChannelsQuery,
    invalidateInbox,
    invalidateSettings,
    invalidateChannelSettings,
    markReadMutation,
    markAllReadMutation,
    registerDeviceTokenMutation,
    unregisterDeviceTokenMutation,
    updateUserSettingsMutation,
    broadcastMutation,
  };
}
