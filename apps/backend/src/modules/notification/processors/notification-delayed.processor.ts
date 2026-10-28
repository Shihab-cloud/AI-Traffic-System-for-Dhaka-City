import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { BACKGROUND_JOB_QUEUE_NAMES } from 'src/shared/enums/background-queue.enum';
import { NotifyUserService } from '../adapters/notify-user.service';
import type { CreateNotificationDto } from 'src/lib/types/notification.types';
import { reviveJobPayload } from '../utils/revive-job-payload.util';

interface DelayedJobData {
  notificationDto: CreateNotificationDto;
}

@Processor(BACKGROUND_JOB_QUEUE_NAMES.NOTIFICATION_DELAYED)
export class NotificationDelayedProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationDelayedProcessor.name);

  constructor(private readonly notificationService: NotifyUserService) {
    super();
  }

  /**
   * Re-delivers a notification that was deferred due to quiet hours.
   *
   * The job is enqueued with a BullMQ delay calculated from the quiet hours end
   * time. On execution, notifyUser is called again which will re-evaluate prefs —
   * if quiet hours have since changed, the updated settings take effect.
   */
  async process(job: Job<DelayedJobData>): Promise<void> {
    this.logger.log(`[notification-delayed] Delivering deferred notification job ${job.id}`);
    const hydrated = reviveJobPayload(job.data.notificationDto);
    await this.notificationService.notifyUser(hydrated);
    this.logger.log(`[notification-delayed] Job ${job.id} complete`);
  }
}
