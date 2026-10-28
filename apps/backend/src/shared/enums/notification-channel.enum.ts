export enum NotificationChannelEnum {
  GENERAL = 'GENERAL',
  ANNOUNCEMENT = 'ANNOUNCEMENT',
  TO_USER = 'TO_USER',
  TO_USERS = 'TO_USERS',
  SUPPORT_TICKET_NOTIFY = 'SUPPORT_TICKET_NOTIFY',
}

/**
 * Sparse map of per-user channel disables.
 *
 * Convention: a key is *only present* when the user has explicitly disabled
 * push for that channel — and the stored value is always `false`. Re-enabling
 * a channel removes the key. Absent key ⇒ channel is enabled (per defaults).
 *
 * This keeps the JSONB blob minimal and avoids persisting "default state".
 */
export type PreferenceConfigType = Partial<Record<NotificationChannelEnum, false>>;
