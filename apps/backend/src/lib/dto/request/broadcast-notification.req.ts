import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DocumentType } from 'src/shared/enums/document-type.enum';
import { NotificationChannelEnum } from 'src/shared/enums/notification-channel.enum';

export class BroadcastNotificationRequest {
  @ApiProperty({ description: 'Notification message content', maxLength: 5000 })
  @IsString()
  @MaxLength(5000)
  message!: string;

  @ApiProperty({
    required: false,
    enum: NotificationChannelEnum,
    description: 'Channel to broadcast on; defaults to SYSTEM_ANNOUNCEMENT',
  })
  @IsOptional()
  @IsEnum(NotificationChannelEnum)
  channelType?: NotificationChannelEnum;

  @ApiProperty({
    required: false,
    enum: DocumentType,
    description:
      'Optional document type — included in the FCM data payload for deep-link routing on notification tap',
  })
  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;
}
