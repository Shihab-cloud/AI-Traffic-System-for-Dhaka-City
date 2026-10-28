import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserModel } from 'src/schemas/public/user.schema';
import type { DeliveryLogEntry } from 'src/lib/types/notification.types';
import { ChannelRegistryService } from '../../modules/channel/core/channel-registry.service';
import type { NotificationDeliveryDto, ResolvedPrefs } from 'src/lib/types/notification.types';
import {
  DeliveryChannelEnum,
  DeliveryLogStatusEnum,
} from 'src/shared/enums/notification-delivery-status.enum';
import { EmailNotificationService } from '../../modules/email/email-notification.service';

@Injectable()
export class EmailDeliveryService {
  private readonly logger = new Logger(EmailDeliveryService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: UserModel,
    private readonly emailNotificationService: EmailNotificationService,
    private readonly channelRegistry: ChannelRegistryService,
  ) {}

  isEnabled(dto: NotificationDeliveryDto, prefs: ResolvedPrefs): boolean {
    return prefs.emailEnabled && !this.channelRegistry.meta(dto.channelType).silent;
  }

  async deliver(dto: NotificationDeliveryDto): Promise<DeliveryLogEntry | null> {
    const user = await this.userModel
      .findById(dto.userId)
      .select('email name')
      .lean<{ email?: string; name?: string }>()
      .exec();

    if (!user?.email) return null;

    const triedAt = new Date().toISOString();
    try {
      await this.emailNotificationService.sendEmailNotificationFromTemplate(
        user.email,
        user.name ?? '',
        dto,
      );
      const now = new Date().toISOString();
      return {
        channel: DeliveryChannelEnum.EMAIL,
        status: DeliveryLogStatusEnum.SENT,
        triedAt,
        sentAt: now,
        deferredAt: null,
        failedAt: null,
      };
    } catch (err) {
      this.logger.error(`Email delivery failed for user ${dto.userId}: ${err}`);
      const now = new Date().toISOString();
      return {
        channel: DeliveryChannelEnum.EMAIL,
        status: DeliveryLogStatusEnum.FAILED,
        triedAt,
        sentAt: null,
        deferredAt: null,
        failedAt: now,
        error: String(err),
      };
    }
  }
}
