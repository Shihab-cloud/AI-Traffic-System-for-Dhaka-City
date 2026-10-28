import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BACKGROUND_JOB_QUEUE_NAMES } from 'src/shared/enums/background-queue.enum';
import { NotifyChannelSubscribersService } from '../../adapters/notify-channel-subscribers.service';
import { ChannelModule } from '../channel/channel.module';
import { NotificationBroadcastService } from './notification-broadcast.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: BACKGROUND_JOB_QUEUE_NAMES.NOTIFICATION_BROADCAST }),
    ChannelModule,
  ],
  providers: [NotificationBroadcastService, NotifyChannelSubscribersService],
  exports: [NotificationBroadcastService, NotifyChannelSubscribersService],
})
export class BroadcastModule {}
