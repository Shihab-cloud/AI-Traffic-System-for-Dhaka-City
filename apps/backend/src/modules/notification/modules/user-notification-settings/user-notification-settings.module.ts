import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BACKGROUND_JOB_QUEUE_NAMES } from 'src/shared/enums/background-queue.enum';
import { ChannelModule } from '../channel/channel.module';
import { UserNotificationSettingsService } from './user-notification-settings.service';

// Models come from the global SchemaModule — no forFeature here.
@Module({
  imports: [
    BullModule.registerQueue({ name: BACKGROUND_JOB_QUEUE_NAMES.NOTIFICATION_DELAYED }),
    ChannelModule,
  ],
  controllers: [],
  providers: [UserNotificationSettingsService],
  exports: [UserNotificationSettingsService],
})
export class UserSettingsModule {}
