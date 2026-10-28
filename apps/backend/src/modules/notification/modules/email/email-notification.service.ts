import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from 'src/lib/logger/logger.service';
import { MailService } from 'src/modules/mail/mail.service';
import { ChannelRegistryService } from '../channel/core/channel-registry.service';
import type { NotificationDeliveryDto } from 'src/lib/types/notification.types';

@Injectable()
export class EmailNotificationService {
  constructor(
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly loggerService: LoggerService,
    private readonly channelRegistry: ChannelRegistryService,
  ) {}

  async sendEmailNotificationFromTemplate(
    email: string,
    username: string,
    dto: NotificationDeliveryDto,
  ): Promise<void> {
    const meta = this.channelRegistry.meta(dto.channelType);
    if (meta.silent) return;

    if (!meta.emailTemplate) {
      this.loggerService.warn(
        `Could not send email: template file path not found for channelType "${dto.channelType}"`,
      );
      return;
    }

    const context: Record<string, unknown> = {
      ...dto.metadata,
      appName: this.configService.get<string>('APP_NAME'),
      username,
      messageContent: dto.messageContent,
      title: dto.title ?? meta.title,
      frontendUrl: this.configService.get<string>('FRONTEND_URL') ?? '',
    };

    await this.mailService.sendEmailFromTemplate({
      to: email,
      subject: dto.title ?? meta.title,
      template: meta.emailTemplate,
      context,
    });
  }
}
