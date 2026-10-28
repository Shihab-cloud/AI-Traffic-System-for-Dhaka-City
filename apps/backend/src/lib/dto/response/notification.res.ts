import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { BaseResponse, PaginatedResponse } from 'src/lib/dto/response/base.res';
import type { DeliveryLogEntry, NotificationMetadata } from 'src/lib/types/notification.types';
import { NotificationChannelEnum } from '../../../shared/enums/notification-channel.enum';

export class NotificationResponse extends BaseResponse {
  @ApiProperty({ enum: NotificationChannelEnum })
  @Expose()
  channelType!: NotificationChannelEnum;

  @ApiProperty({ nullable: true })
  @Expose()
  title!: string | null;

  @ApiProperty()
  @Expose()
  messageContent!: string;

  @ApiProperty({ nullable: true })
  @Expose()
  metadata!: NotificationMetadata | null;

  @ApiProperty()
  @Expose()
  read!: boolean;

  @ApiProperty({ isArray: true, type: Object })
  @Expose()
  deliveryLogs!: DeliveryLogEntry[];

  @ApiProperty({ nullable: true })
  @Expose()
  expiresAt!: Date | null;
}

export class PaginatedNotificationResponse extends PaginatedResponse<NotificationResponse> {
  @ApiProperty({ type: NotificationResponse, isArray: true })
  @Type(() => NotificationResponse)
  docs!: NotificationResponse[];
}

export class UnreadNotificationCountResponse {
  @ApiProperty()
  @Expose()
  count!: number;
}
