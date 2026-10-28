/**
 * Mirrors the browser's `Notification.permission` API which returns lowercase
 * strings (`'default'`, `'granted'`, `'denied'`). `'unknown'` is our pre-init
 * sentinel and `'unsupported'` covers browsers without the API. Values stay
 * lowercase to match the platform API — listed in the standards doc exemption
 * section.
 */
export const FcmPermissionStateEnum = {
  UNKNOWN: 'unknown',
  DEFAULT: 'default',
  GRANTED: 'granted',
  DENIED: 'denied',
  UNSUPPORTED: 'unsupported',
} as const;

export type FcmPermissionStateType =
  (typeof FcmPermissionStateEnum)[keyof typeof FcmPermissionStateEnum];
