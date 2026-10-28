import { Module } from '@nestjs/common';
import { MailModule } from 'src/modules/mail/mail.module';
import { ChannelModule } from '../channel/channel.module';
import { EmailNotificationService } from './email-notification.service';

@Module({
  imports: [MailModule, ChannelModule],
  providers: [EmailNotificationService],
  exports: [EmailNotificationService],
})
export class EmailNotificationModule {}
