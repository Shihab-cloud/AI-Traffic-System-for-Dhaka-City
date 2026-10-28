import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../lib/providers/redis.provider';
import { NotificationDbService } from '../adapters/notification.db.service';

@Injectable()
export class NotificationCleanupCron {
  private readonly logger = new Logger(NotificationCleanupCron.name);

  constructor(
    private readonly notificationDbService: NotificationDbService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron('0 2 * * *', { timeZone: 'UTC' })
  async deleteExpired(): Promise<void> {
    // A single-process deploy (and the brief blue-green overlap) can run two
    // instances at once; a day-keyed Redis lock ensures only one runs the
    // cleanup per tick. SET NX returns null if another instance already holds it.
    const key = `cron:notification-cleanup:${new Date().toISOString().slice(0, 10)}`;
    const acquired = await this.redis.set(key, '1', 'EX', 600, 'NX');
    if (!acquired) {
      this.logger.debug('[notification-cleanup] Lock held by another instance — skipping');
      return;
    }
    this.logger.log('[notification-cleanup] Running nightly expired notification cleanup');
    const deleted = await this.notificationDbService.deleteExpired();
    this.logger.log(`[notification-cleanup] Deleted ${deleted} expired notifications`);
  }
}
