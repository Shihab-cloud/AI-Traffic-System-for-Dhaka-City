import { Module } from '@nestjs/common';
import { FileModule } from '../file/file.module';
import { NotificationModule } from '../notification/notification.module';
import { SupportAudienceHelper } from './helpers/support-audience.helper';
import { SupportTicketLogService } from './support-ticket-log.service';
import { SupportUploadService } from './support-upload.service';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

// Models come from the global SchemaModule — no forFeature here.
@Module({
  imports: [FileModule, NotificationModule],
  controllers: [SupportController],
  providers: [SupportService, SupportTicketLogService, SupportUploadService, SupportAudienceHelper],
})
export class SupportModule {}
