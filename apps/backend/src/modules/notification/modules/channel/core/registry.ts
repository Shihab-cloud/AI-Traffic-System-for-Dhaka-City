import { NotificationChannelEnum } from '../../../../../shared/enums/notification-channel.enum';
import { AnnouncementChannel } from '../channels/announcement.channel';
import { GeneralChannel } from '../channels/general.channel';
import { SupportTicketNotifyChannel } from '../channels/support-ticket-notify.channel';
import { ToUserChannel } from '../channels/to-user.channel';
import { ToUsersChannel } from '../channels/to-users.channel';
import type { ChannelHandler, ChannelMeta, DefaultChannelPayload } from './types';

/** Constructor signature every channel class must satisfy: `static meta` + `build()`. */
type ChannelClass = (new (...args: any[]) => ChannelHandler<DefaultChannelPayload>) & {
  readonly meta: ChannelMeta;
};

/**
 * Single source of truth — channel-type → handler class.
 *
 * Adding a new channel:
 *   1. Create `channels/<name>.channel.ts` with class + static meta.
 *   2. Import + add to this map. That's it.
 *
 * `satisfies Record<NotificationChannelEnum, ChannelClass>` enforces at compile
 * time that every enum value has a registered channel — adding an enum value
 * without a map entry is a TypeScript error.
 *
 * The map key MUST equal the class's `static meta.type` (verified at runtime
 * in ChannelRegistryService.onModuleInit).
 */
export const CHANNELS = {
  [NotificationChannelEnum.GENERAL]: GeneralChannel,
  [NotificationChannelEnum.ANNOUNCEMENT]: AnnouncementChannel,
  [NotificationChannelEnum.TO_USER]: ToUserChannel,
  [NotificationChannelEnum.TO_USERS]: ToUsersChannel,
  [NotificationChannelEnum.SUPPORT_TICKET_NOTIFY]: SupportTicketNotifyChannel,
} as const satisfies Record<NotificationChannelEnum, ChannelClass>;

export const ALL_CHANNELS = Object.values(CHANNELS);

type InstOf<C> = C extends new (...a: never[]) => infer I ? I : never;
type PayloadOf<C> = InstOf<C> extends ChannelHandler<infer P> ? P : never;

export type ChannelKey = keyof typeof CHANNELS;
export type PayloadByChannel = {
  [K in ChannelKey]: PayloadOf<(typeof CHANNELS)[K]>;
};
