import { BullModule } from '@nestjs/bullmq';
import { Module, type Provider } from '@nestjs/common';
import { BACKGROUND_JOB_QUEUE_NAMES } from 'src/shared/enums/background-queue.enum';
import { EmailDeliveryService } from './adapters/delivery/email-delivery.service';
import { PushDeliveryService } from './adapters/delivery/push-delivery.service';
import { NotificationRouterService } from './adapters/notification-router.service';
import { NotificationDbService } from './adapters/notification.db.service';
import { NotifyUserService } from './adapters/notify-user.service';
import { NotificationCleanupCron } from './cron/notification-cleanup.cron';
import { BroadcastModule } from './modules/broadcast/broadcast.module';
import { ChannelModule } from './modules/channel/channel.module';
import { EmailNotificationModule } from './modules/email/email-notification.module';
import { FcmModule } from './modules/fcm/fcm.module';
import { UserSettingsModule } from './modules/user-notification-settings/user-notification-settings.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationBroadcastProcessor } from './processors/notification-broadcast.processor';
import { NotificationDelayedProcessor } from './processors/notification-delayed.processor';

/**
 * Notification feature root. Processors (`@Processor`) and the cleanup cron
 * (`@Cron`) always register — the single process runs both. `ScheduleModule.forRoot()`
 * is loaded by AppModule, not here.
 */
// Models come from the global SchemaModule — no forFeature here.
const workerProviders: Provider[] = [NotificationBroadcastProcessor, NotificationDelayedProcessor];
const schedulerProviders: Provider[] = [NotificationCleanupCron];

@Module({
  imports: [
    BullModule.registerQueue(
      { name: BACKGROUND_JOB_QUEUE_NAMES.NOTIFICATION_BROADCAST },
      { name: BACKGROUND_JOB_QUEUE_NAMES.NOTIFICATION_DELAYED },
    ),
    ChannelModule,
    FcmModule,
    EmailNotificationModule,
    UserSettingsModule,
    BroadcastModule,
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationRouterService,
    NotifyUserService,
    NotificationDbService,
    PushDeliveryService,
    EmailDeliveryService,
    ...schedulerProviders,
    ...workerProviders,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
