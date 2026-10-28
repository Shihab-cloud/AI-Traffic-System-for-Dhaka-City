import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Permissions } from 'src/lib/decorators/permissions.decorator';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { GetUser } from 'src/lib/decorators/user.decorator';
import { BroadcastNotificationRequest } from 'src/lib/dto/request/broadcast-notification.req';
import { UpdateGlobalNotificationSettingsRequest } from 'src/lib/dto/request/update-notification-settings.req';
import { ResponseSerializerInterceptor } from 'src/lib/interceptors/response-serializer.interceptor';
import { QueryTransformPipe } from 'src/lib/pipes/query.pipe';
import { ParamIdValidationPipe } from 'src/lib/pipes/validation.pipe';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { PaginationQueryDto } from 'src/shared/dtos/query.dto';
import { RegisterDeviceTokenRequest } from '../../lib/dto/request/register-device-token.req';
import {
  PaginatedNotificationResponse,
  UnreadNotificationCountResponse,
} from '../../lib/dto/response/notification.res';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  // region notification db

  @ApiOperation({ summary: 'Get paginated notification inbox for current user' })
  @ApiResponse({ type: PaginatedNotificationResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(PaginatedNotificationResponse))
  @Get()
  async getNotifications(
    @GetUser() user: CurrentUser,
    @Query(QueryTransformPipe) query: PaginationQueryDto,
  ) {
    return this.notificationService.listInbox(user.id, query);
  }

  @ApiOperation({ summary: 'Get unread notification count' })
  @ApiResponse({ type: UnreadNotificationCountResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(UnreadNotificationCountResponse))
  @Get('unread-count')
  async getUnreadCount(@GetUser() user: CurrentUser): Promise<UnreadNotificationCountResponse> {
    const count = await this.notificationService.countUnread(user.id);
    return { count };
  }

  // NOTE: literal route `read-all` must be declared BEFORE the `:id/read`
  // parametric route, otherwise Nest matches `:id` first and `/notifications/read-all`
  // hits markRead with id="read-all".
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @Put('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllReadByUser(@GetUser() user: CurrentUser): Promise<void> {
    await this.notificationService.markAllRead(user.id);
  }

  @ApiOperation({ summary: 'Mark a single notification as read' })
  @ApiParam({ name: 'id', type: String })
  @Put(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @Param('id', ParamIdValidationPipe) id: string,
    @GetUser() user: CurrentUser,
  ): Promise<void> {
    await this.notificationService.markRead(id, user.id);
  }

  // region device token

  @ApiOperation({ summary: 'Register an FCM device token' })
  @Post('device-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async registerDeviceToken(
    @Body() dto: RegisterDeviceTokenRequest,
    @GetUser() user: CurrentUser,
  ): Promise<void> {
    await this.notificationService.registerDeviceToken(user.id, dto);
  }

  @ApiOperation({ summary: 'Unregister an FCM device token' })
  @ApiParam({ name: 'token', type: String })
  @Delete('device-token/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregisterDeviceToken(
    @Param('token') token: string,
    @GetUser() user: CurrentUser,
  ): Promise<void> {
    await this.notificationService.unregisterDeviceToken(token, user.id);
  }

  // region broadcast

  @ApiOperation({ summary: 'Broadcast a notification (admin only)' })
  @ApiResponse({ status: 204 })
  @Permissions({ permissions: [PermissionsEnum.BROADCAST_NOTIFICATION] })
  // Platform-wide fan-out, gated by the `BROADCAST_NOTIFICATION` permission.
  @Post('broadcast')
  @HttpCode(HttpStatus.NO_CONTENT)
  async broadcast(
    @Body() dto: BroadcastNotificationRequest,
    @GetUser() publisher: CurrentUser,
  ): Promise<void> {
    await this.notificationService.enqueueBroadcast(publisher, dto);
  }

  // region user settings

  @ApiOperation({ summary: 'Get current user notification settings' })
  @Get('/user-settings')
  async getUserNotificationSettings(@GetUser() user: CurrentUser) {
    return this.notificationService.getSettings(user.id);
  }

  @ApiOperation({
    summary: 'Update notification settings (global flags + per-channel preference patch)',
  })
  @Put('/user-settings')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateNotificationSettings(
    @Body() dto: UpdateGlobalNotificationSettingsRequest,
    @GetUser() user: CurrentUser,
  ): Promise<void> {
    await this.notificationService.updateSettings(user.id, dto);
  }

  @ApiOperation({ summary: 'List per-channel preference overrides for current user' })
  @Get('/user-settings/channel-preferences')
  async listNotificationChannelPreferences(@GetUser() user: CurrentUser) {
    return this.notificationService.listChannelPreferences(user.id);
  }
}
