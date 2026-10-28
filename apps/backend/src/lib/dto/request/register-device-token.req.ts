import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { NotificationDevicePlatformEnum } from 'src/shared/enums/notification-device-platform.enum';

export class RegisterDeviceTokenRequest {
  @ApiProperty({ description: 'FCM device token', maxLength: 4096 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token!: string;

  @ApiProperty({ enum: NotificationDevicePlatformEnum })
  @IsEnum(NotificationDevicePlatformEnum)
  platform!: NotificationDevicePlatformEnum;
}
