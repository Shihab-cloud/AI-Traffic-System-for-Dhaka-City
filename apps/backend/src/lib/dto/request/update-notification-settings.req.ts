import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';
import { NotificationChannelEnum } from '../../../shared/enums/notification-channel.enum';

function IsBooleanValueRecord(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isBooleanValueRecord',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          return Object.values(value as Record<string, unknown>).every(
            (v) => typeof v === 'boolean',
          );
        },
        defaultMessage() {
          return 'preferences: all values must be boolean (true or false)';
        },
      },
    });
  };
}

// IANA timezone names supported by the runtime — rejects values like "Wibble/Wobble"
// at the API boundary instead of crashing Intl.DateTimeFormat at delivery time.
const SUPPORTED_TIMEZONES = Intl.supportedValuesOf('timeZone');

/**
 * Single update endpoint for a user's notification settings.
 *
 * Settings + per-channel preferences live on the same row, so the client patches
 * everything through this one DTO. Any field omitted is left unchanged.
 *
 * `preferences` is treated as a *patch*, not a replace:
 *   - `{ [channel]: false }` ⇒ disable that channel (server stores `false`).
 *   - `{ [channel]: true }`  ⇒ re-enable that channel (server deletes the key
 *     from the JSONB, since absent ⇒ enabled).
 *   - channels not mentioned in the patch are left as-is.
 */
export class UpdateGlobalNotificationSettingsRequest {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  emailFallbackEnabled?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  criticalBypassQuietHours?: boolean;

  @ApiProperty({ required: false, nullable: true, example: '22:00' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'quietHoursStart must be HH:mm' })
  quietHoursStart?: string | null;

  @ApiProperty({ required: false, nullable: true, example: '08:00' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'quietHoursEnd must be HH:mm' })
  quietHoursEnd?: string | null;

  @ApiProperty({ required: false, example: 'Asia/Dhaka' })
  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_TIMEZONES, { message: 'timezone must be a valid IANA zone (e.g., Asia/Dhaka)' })
  timezone?: string;

  @ApiProperty({
    required: false,
    description:
      'Per-channel push toggle patch. `false` disables the channel; `true` re-enables it (clears the override).',
    example: { 'support-ticket-message': false },
  })
  @IsOptional()
  @IsObject()
  @IsBooleanValueRecord()
  preferences?: Partial<Record<NotificationChannelEnum, boolean>>;
}
