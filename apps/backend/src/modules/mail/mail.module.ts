import { MailService } from './mail.service';
import { Module } from '@nestjs/common';

@Module({
  exports: [MailService],
  providers: [MailService],
})
export class MailModule {}
