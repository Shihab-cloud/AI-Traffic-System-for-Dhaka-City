import { Body, Controller, Get, Patch, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from 'src/lib/decorators/auth.decorator';
import { Permissions } from 'src/lib/decorators/permissions.decorator';
import { type CurrentUser, GetUser } from 'src/lib/decorators/user.decorator';
import { UpdateSystemSettingsRequest } from 'src/lib/dto/request/system-settings.req';
import {
  PublicSystemSettingsResponse,
  SystemSettingsResponse,
} from 'src/lib/dto/response/system-settings.res';
import { ResponseSerializerInterceptor } from 'src/lib/interceptors/response-serializer.interceptor';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { SystemSettingsService } from './system-settings.service';

@ApiTags('System-Settings')
@Controller('system-settings')
export class SystemSettingsController {
  constructor(private readonly systemSettingsService: SystemSettingsService) {}

  @ApiOperation({ summary: 'Get full system settings, including audit metadata (admin only).' })
  @ApiResponse({ type: SystemSettingsResponse })
  @Permissions({ permissions: [PermissionsEnum.ADMIN] })
  @UseInterceptors(new ResponseSerializerInterceptor(SystemSettingsResponse))
  @Get()
  async get() {
    return this.systemSettingsService.get();
  }

  @ApiOperation({
    summary: 'Get client-relevant system setting flags (public, no auth).',
  })
  @ApiResponse({ type: PublicSystemSettingsResponse })
  @Public()
  @UseInterceptors(new ResponseSerializerInterceptor(PublicSystemSettingsResponse))
  @Get('public')
  async getPublic() {
    return this.systemSettingsService.getData();
  }

  @ApiOperation({ summary: 'Update system settings (admin only).' })
  @ApiResponse({ type: SystemSettingsResponse })
  @Permissions({ permissions: [PermissionsEnum.ADMIN] })
  @UseInterceptors(new ResponseSerializerInterceptor(SystemSettingsResponse))
  @Patch()
  async update(@Body() dto: UpdateSystemSettingsRequest, @GetUser() user: CurrentUser) {
    return this.systemSettingsService.update(dto, user.id);
  }
}
