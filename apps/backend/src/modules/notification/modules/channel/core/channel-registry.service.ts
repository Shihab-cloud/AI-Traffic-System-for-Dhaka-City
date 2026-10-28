import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { NotificationChannelEnum } from '../../../../../shared/enums/notification-channel.enum';
import { ALL_CHANNELS } from './registry';
import type { ChannelHandler, ChannelMeta, DefaultChannelPayload } from './types';

interface RegisteredHandler {
  instance: ChannelHandler<DefaultChannelPayload>;
  meta: ChannelMeta;
}

/**
 * Resolves each channel class to its DI instance at boot and indexes by `meta.type`.
 *
 * Used by `NotificationService` to dispatch publish calls to the right handler,
 * and by delivery-side services (FCM, email, settings) to read per-channel meta
 * without depending on a static config map.
 */
@Injectable()
export class ChannelRegistryService implements OnModuleInit {
  private readonly handlers = new Map<NotificationChannelEnum, RegisteredHandler>();

  constructor(private readonly moduleRef: ModuleRef) {}

  onModuleInit(): void {
    for (const Cls of ALL_CHANNELS) {
      const meta = Cls.meta;
      const instance = this.moduleRef.get(Cls, {
        strict: false,
      });
      this.handlers.set(meta.type, { instance, meta });
    }
  }

  /** Throws if the channel type has no registered handler. */
  get(type: NotificationChannelEnum): RegisteredHandler {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`No notification channel handler registered for type "${type}"`);
    }
    return handler;
  }

  /** Returns just the static meta for a channel — used by delivery-side services. */
  meta(type: NotificationChannelEnum): ChannelMeta {
    return this.get(type).meta;
  }
}
