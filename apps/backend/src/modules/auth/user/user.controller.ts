import { Body, Controller, Get, Param, Put, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Permissions } from 'src/lib/decorators/permissions.decorator';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { RequiresStepUp } from 'src/lib/decorators/step-up.decorator';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { GetUser } from 'src/lib/decorators/user.decorator';
import { PasswordUpdateRequest, ProfileUpdateRequest } from 'src/lib/dto/request/user.req';
import { UserResponse } from 'src/lib/dto/response/user.res';
import { ResponseSerializerInterceptor } from 'src/lib/interceptors/response-serializer.interceptor';
import { ParamIdValidationPipe } from 'src/lib/pipes/validation.pipe';
import { MfaStepUpScope } from 'src/shared/enums/mfa.enum';
import { UserService } from './user.service';

@ApiTags('User Profile')
@Controller('user')
export class UserController {
  constructor(private userService: UserService) {}

  @ApiOperation({ summary: 'Change your account password' })
  @ApiResponse({ status: 200, description: 'Password updated successfully' })
  // Password change carries its own current-password check; step-up is left
  // off here to mirror backend-drizzle. Flip on by uncommenting if policy changes.
  // @RequiresStepUp(MfaStepUpScope.ACCOUNT_PASSWORD_CHANGE)
  @Put('password')
  async updatePassword(
    @GetUser() user: CurrentUser,
    @Body() updatePasswordDto: PasswordUpdateRequest,
  ) {
    const result = await this.userService.updatePassword(user.id, updatePasswordDto);
    return result;
  }

  @ApiOperation({ summary: 'Update your profile information' })
  @ApiResponse({ type: UserResponse })
  // Only a change of address needs step-up. Gating the whole route would keep
  // every user who has not enrolled a factor from editing their own name.
  @RequiresStepUp(MfaStepUpScope.ACCOUNT_EMAIL_CHANGE, {
    when: (request) => changesEmail(request),
  })
  @UseInterceptors(new ResponseSerializerInterceptor(UserResponse))
  @Put()
  async updateProfile(
    @GetUser() user: CurrentUser,
    @Body() profileUpdateRequest: ProfileUpdateRequest,
  ) {
    const result = await this.userService.updateProfile(user.id, profileUpdateRequest);
    return result;
  }

  @ApiOperation({ summary: 'Get your profile information' })
  @ApiResponse({ type: UserResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(UserResponse))
  @Get()
  async getCurrentUser(@GetUser() user: CurrentUser) {
    const result = await this.userService.getUserById(user.id);
    return result;
  }

  @ApiOperation({ summary: 'Get profile information by id' })
  @ApiResponse({ type: UserResponse })
  @Permissions({ permissions: [PermissionsEnum.READ_USER] })
  @UseInterceptors(new ResponseSerializerInterceptor(UserResponse))
  @Get(':id')
  async getUserById(@Param('id', ParamIdValidationPipe) id: string) {
    const result = await this.userService.getUserById(id);
    return result;
  }
}

/**
 * Whether this profile update would move the account to a different address.
 *
 * Compared against the session's own email rather than the database: the guard
 * runs before the handler, and a read here would be a second round trip on
 * every profile save.
 */
function changesEmail(request: Request & { user?: CurrentUser }): boolean {
  const submitted = (request.body as { email?: unknown } | undefined)?.email;
  if (typeof submitted !== 'string') return false;
  return submitted.toLowerCase() !== request.user?.email?.toLowerCase();
}
