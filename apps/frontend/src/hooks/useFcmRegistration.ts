'use client';

import useNotificationAction from '@/hooks/actions/useNotificationAction';
import { useSession } from '@/lib/auth-client';
import { NotificationDevicePlatformEnum } from '@/lib/enums/notification-device-platform.enum';
import {
  FcmPermissionStateEnum,
  type FcmPermissionStateType,
} from '@/lib/enums/fcm-permission-state.enum';
import {
  isFcmSupported,
  listenForegroundMessages,
  requestPermissionAndGetToken,
} from '@/lib/notification/fcm';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

/**
 * Manages the push-notification registration lifecycle for the signed-in user.
 *
 * - Reads current browser permission to drive UI hints.
 * - On `enable()`, requests permission, fetches an FCM token, POSTs it to the
 *   backend, and sets `permission` to 'granted'. No-ops if already granted.
 * - When FCM delivers a message while the tab is visible, toasts it and
 *   invalidates inbox + unread-count queries so the UI reflects the new
 *   notification immediately (background delivery is handled by the service worker).
 */
export function useFcmRegistration() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const { registerDeviceTokenMutation, invalidateInbox } = useNotificationAction();
  // Read the current browser permission once on mount to drive UI hints.
  // Browser-API only; guarded for SSR (this is a client component, but the
  // initializer also runs during server render).
  const [permission, setPermission] = useState<FcmPermissionStateType>(() => {
    // `UNKNOWN` is the pre-init sentinel only — it means "we have not looked
    // yet", not "the user has not decided". Mapping the browser's `'default'`
    // onto it collapsed those two states together, and since
    // `EnablePushAutoDialog` opens only on `DEFAULT`, the opt-in prompt could
    // never appear for exactly the users it exists for.
    if (typeof window === 'undefined') return FcmPermissionStateEnum.UNKNOWN;
    if (!isFcmSupported()) return FcmPermissionStateEnum.UNSUPPORTED;
    switch (Notification.permission) {
      case 'granted':
        return FcmPermissionStateEnum.GRANTED;
      case 'denied':
        return FcmPermissionStateEnum.DENIED;
      default:
        return FcmPermissionStateEnum.DEFAULT;
    }
  });

  // If already granted, fetch a token and (re-)register it with the backend.
  // The backend upserts on the unique token column, so re-POSTing the same
  // token is a no-op. We deliberately do NOT gate on a localStorage cache:
  // FCM may invalidate a token server-side (REGISTRATION_TOKEN_NOT_REGISTERED)
  // which deletes the DB row, while `getToken()` continues to return the same
  // string — a cache check would then permanently skip re-registration.
  useEffect(() => {
    if (!userId || permission !== FcmPermissionStateEnum.GRANTED) return;
    let cancelled = false;
    (async () => {
      const token = await requestPermissionAndGetToken();
      if (cancelled || !token) return;
      registerDeviceTokenMutation.mutate(
        { token, platform: NotificationDevicePlatformEnum.WEB },
        { onSuccess: () => localStorage.setItem('fcm-token', token) },
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only `mutate`/`mutateAsync` are stable in v5, and that is what this calls
  }, [userId, permission]);

  // Foreground message listener — toast + refresh inbox while tab is visible.
  useEffect(() => {
    if (!isFcmSupported() || permission !== FcmPermissionStateEnum.GRANTED) return;
    return listenForegroundMessages((payload) => {
      const title = payload.notification?.title ?? 'New notification';
      const body = payload.notification?.body;
      toast(body ? `${title}: ${body}` : title);
      invalidateInbox();
    });
  }, [permission, invalidateInbox]);

  const enable = async (): Promise<FcmPermissionStateType> => {
    if (!isFcmSupported()) {
      setPermission(FcmPermissionStateEnum.UNSUPPORTED);
      return FcmPermissionStateEnum.UNSUPPORTED;
    }

    const resolvePermissionFallback = (): FcmPermissionStateType => {
      // No token came back. Report what the browser actually says rather than
      // flattening everything to a sentinel: `DEFAULT` here means the user
      // dismissed the native prompt without choosing, which the caller needs to
      // distinguish from an outright denial.
      const next: FcmPermissionStateType =
        Notification?.permission === 'denied'
          ? FcmPermissionStateEnum.DENIED
          : FcmPermissionStateEnum.DEFAULT;
      setPermission(next);
      return next;
    };

    const token = await requestPermissionAndGetToken();
    if (!token) return resolvePermissionFallback();

    try {
      await registerDeviceTokenMutation.mutateAsync(
        { token, platform: NotificationDevicePlatformEnum.WEB },
        {
          onSuccess: () => {
            localStorage.setItem('fcm-token', token);
            toast.success('Your device has been registered for push notifications.');
          },
        },
      );
      setPermission(FcmPermissionStateEnum.GRANTED);
      return FcmPermissionStateEnum.GRANTED;
    } catch {
      // The browser may already have granted permission, but the backend
      // never stored the token — reflect that the UI is NOT in the granted
      // state so the dialog/preferences page can prompt a retry. onError in
      // the mutation definition surfaces the failure toast.
      return resolvePermissionFallback();
    }
  };

  return { permission, enable };
}
