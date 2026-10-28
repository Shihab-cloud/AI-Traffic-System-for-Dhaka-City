import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Notification, NotificationModel } from 'src/schemas/notification/notification.schema';
import type { PaginationQueryDto } from 'src/shared/dtos/query.dto';
import { MongoQueryBuilder } from 'src/utils/mongo-query-builder';
import type { CreateNotificationDto, DeliveryLogEntry } from 'src/lib/types/notification.types';

@Injectable()
export class NotificationDbService {
  constructor(
    @InjectModel(Notification.name) private readonly notificationModel: NotificationModel,
  ) {}

  /**
   * Inserts a new notification document with an empty delivery log.
   *
   * Always called before any delivery attempt so the notification is persisted
   * even if all channels fail. This makes the DB the source of truth for the
   * inbox regardless of real-time delivery outcome.
   */
  async create(dto: CreateNotificationDto): Promise<Notification> {
    return this.notificationModel.create({
      publisher: dto.publisher ?? null,
      subscriber: dto.subscriber,
      channelType: dto.channelType,
      title: dto.title ?? null,
      messageContent: dto.messageContent,
      metadata: dto.metadata ?? null,
      expiresAt: dto.expiresAt ?? null,
    });
  }

  async appendDeliveryLog(id: string, entry: DeliveryLogEntry): Promise<void> {
    await this.notificationModel.updateOne({ _id: id }, { $push: { deliveryLogs: entry } }).exec();
  }

  async findForUser(userId: string, query: PaginationQueryDto) {
    return this.notificationModel.paginate(
      {
        ...query.filter,
        ...MongoQueryBuilder.buildSearch(query.search, Notification),
        // Ownership scope LAST so a caller-supplied filter cannot displace it.
        // `subscriber` is a plain field name, so `MongoQueryBuilder` (which
        // blocks `$`-prefixed and dotted keys) passes it through — with the
        // spread after this clause, `?filter=subscriber[$notEmpty]=1` would
        // return every notification on the platform.
        subscriber: userId,
      },
      {
        page: query.page,
        limit: query.limit,
        sort: query.sortBy ?? { createdAt: -1 },
      },
    );
  }

  /** Returns the count of unread notifications for a user. Used for badge counts. */
  async countUnread(userId: string): Promise<number> {
    return this.notificationModel.countDocuments({ subscriber: userId, read: false }).exec();
  }

  /**
   * Marks a single notification as read.
   *
   * The userId condition prevents users from marking other users' notifications
   * as read — serves as an authorization guard at the DB level.
   */
  async markRead(id: string, userId: string): Promise<void> {
    await this.notificationModel.updateOne({ _id: id, subscriber: userId }, { read: true }).exec();
  }

  /** Marks all unread notifications for a user as read in one update. */
  async markAllRead(userId: string): Promise<void> {
    await this.notificationModel
      .updateMany({ subscriber: userId, read: false }, { read: true })
      .exec();
  }

  /**
   * Deletes expired or stale notifications.
   *
   * A document is deleted when EITHER condition holds:
   * - `expiresAt` is in the past (channel-specific TTL elapsed), OR
   * - `expiresAt` is null AND the document is older than 90 days (safety net for
   *   notifications created without an explicit TTL).
   *
   * Returns the count of deleted documents for logging purposes.
   * Called nightly by NotificationCleanupCron.
   */
  async deleteExpired(): Promise<number> {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const result = await this.notificationModel
      .deleteMany({
        $or: [
          { expiresAt: { $ne: null, $lt: now } },
          { expiresAt: null, createdAt: { $lt: ninetyDaysAgo } },
        ],
      })
      .exec();
    return result.deletedCount ?? 0;
  }
}
