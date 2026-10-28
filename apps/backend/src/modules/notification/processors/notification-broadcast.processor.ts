import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Job, Queue } from 'bullmq';
import { QueryFilter, Types } from 'mongoose';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { BACKGROUND_JOB_QUEUE_NAMES } from 'src/shared/enums/background-queue.enum';
import { NotificationTargetEnum } from 'src/shared/enums/notification-target.enum';
import { NotifyUserService } from '../adapters/notify-user.service';
import {
  MAX_BROADCAST_STEPS,
  type BroadcastJobData,
} from '../modules/broadcast/notification-broadcast.service';
import { reviveJobPayload } from '../utils/revive-job-payload.util';

@Processor(BACKGROUND_JOB_QUEUE_NAMES.NOTIFICATION_BROADCAST)
export class NotificationBroadcastProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationBroadcastProcessor.name);

  constructor(
    private readonly notificationService: NotifyUserService,
    @InjectModel(User.name) private readonly userModel: UserModel,
    @InjectQueue(BACKGROUND_JOB_QUEUE_NAMES.NOTIFICATION_BROADCAST)
    private readonly broadcastQueue: Queue,
  ) {
    super();
  }

  /**
   * Processes one chunk of a notification broadcast.
   *
   * Uses keyset pagination (`_id > lastId` ORDER BY `_id`) so concurrent
   * inserts/deletes cannot cause skipped or duplicated recipients.
   *
   * Push opt-out is enforced downstream in NotifyUserService — this query
   * selects all users in scope without filtering by notification preferences.
   *
   * Target scoping:
   *   PLATFORM — all users, no extra filter
   *   USERS    — _id IN (explicit list), still paginated
   */
  async process(job: Job<BroadcastJobData>): Promise<void> {
    const {
      target,
      baseDto,
      chunkSize,
      lastId,
      step = 0,
      contentByUserId,
      deliveryOverrides,
    } = job.data;
    const hydratedDto = reviveJobPayload(baseDto);
    const targetLabel = target.type;

    this.logger.log(
      `[notification-broadcast] Job ${job.id} — step=${step} lastId=${lastId ?? '-'} target=${targetLabel}`,
    );

    if (step >= MAX_BROADCAST_STEPS) {
      this.logger.error(
        `[notification-broadcast] Job ${job.id} aborted — exceeded MAX_BROADCAST_STEPS (${MAX_BROADCAST_STEPS}). lastId=${lastId ?? '-'}`,
      );
      return;
    }

    if (target.type === NotificationTargetEnum.USERS && target.userIds.length === 0) {
      this.logger.log(`[notification-broadcast] Job ${job.id} — empty userIds, skipping`);
      return;
    }

    // `User._id` is typed `string` (BaseSchema); mongoose casts string values to
    // ObjectId at the `_id` path, so plain hex strings are passed here.
    const filter: QueryFilter<User> = {};

    if (lastId) filter._id = { $gt: lastId };

    if (target.type === NotificationTargetEnum.USERS) {
      filter._id = {
        ...(typeof filter._id === 'object' ? filter._id : {}),
        $in: target.userIds,
      };
    }

    const batch = await this.userModel
      .find(filter)
      .select('_id')
      .sort({ _id: 1 })
      .limit(chunkSize)
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();

    if (batch.length === 0) {
      this.logger.log(`[notification-broadcast] Job ${job.id} — fan-out complete`);
      return;
    }

    const results = await Promise.allSettled(
      batch.map((u) => {
        const userId = String(u._id);
        const personalized = contentByUserId?.[userId];
        const dto = personalized
          ? {
              ...hydratedDto,
              subscriber: userId,
              messageContent: personalized.messageContent,
              title: personalized.title ?? hydratedDto.title,
              metadata: personalized.metadata ?? hydratedDto.metadata,
            }
          : { ...hydratedDto, subscriber: userId };
        return this.notificationService.notifyUser(dto, deliveryOverrides);
      }),
    );

    // A chunk that partially fails must not report success.
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    if (failures.length > 0) {
      const firstReason: unknown = failures[0].reason;
      this.logger.error(
        `[notification-broadcast] Job ${job.id} — ${failures.length}/${batch.length} recipients failed`,
        firstReason instanceof Error ? firstReason.stack : String(firstReason),
      );
    }

    // Enqueue the continuation BEFORE throwing on failures, so a partial chunk
    // does not also halt the rest of the fan-out. The chunk itself is retried
    // by BullMQ; the continuation carries on regardless.
    if (batch.length === chunkSize) {
      const nextLastId = String(batch[batch.length - 1]._id);
      await this.broadcastQueue.add(
        job.name,
        { ...job.data, lastId: nextLastId, step: step + 1 },
        {
          // Deterministic id so a retry of *this* job cannot enqueue the same
          // continuation twice. Retries were impossible before (`attempts: 1`),
          // so adding them without this would have converted silent loss into
          // duplicate notifications.
          jobId: `${job.data.broadcastId}:${step + 1}`,
        },
      );
    }

    if (failures.length > 0) {
      // Fail the job so BullMQ retries this chunk. `notifyUser` is not yet
      // idempotent per recipient, so a retry can re-notify the recipients that
      // succeeded — accepted deliberately: a duplicate notification is a
      // smaller harm than a silently missing one.
      throw new Error(
        `${failures.length} of ${batch.length} recipients failed in broadcast chunk ${step}`,
      );
    }

    this.logger.log(
      `[notification-broadcast] Job ${job.id} — dispatched ${batch.length} notifications`,
    );
  }
}
