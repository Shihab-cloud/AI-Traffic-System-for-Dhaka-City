import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ChannelRegistryService } from './core/channel-registry.service';
import { ALL_CHANNELS } from './core/registry';

/**
 * Owns the channel registry. Keeps `ChannelRegistryService` available without
 * pulling in the full `NotificationModule` — needed by sub-modules (email,
 * fcm, user-settings) that read per-channel meta during delivery.
 */
@Module({
  imports: [DiscoveryModule],
  providers: [...ALL_CHANNELS, ChannelRegistryService],
  exports: [ChannelRegistryService],
})
export class ChannelModule {}
