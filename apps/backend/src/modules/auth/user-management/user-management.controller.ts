import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/lib/decorators/auth.decorator';
import { Permissions } from 'src/lib/decorators/permissions.decorator';
import { RequiresStepUp } from 'src/lib/decorators/step-up.decorator';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { GetUser } from 'src/lib/decorators/user.decorator';
import { ResponseSerializerInterceptor } from 'src/lib/interceptors/response-serializer.interceptor';
import { QueryTransformPipe } from 'src/lib/pipes/query.pipe';
import { ParamIdValidationPipe } from 'src/lib/pipes/validation.pipe';
import { RateLimit } from 'src/lib/decorators/rate-limit.decorator';
import { PaginationQueryDto, PaginationQueryOptions } from 'src/shared/dtos/query.dto';
import { timingSafeEqualStr } from 'src/utils/password.util';
import { MfaStepUpScope } from 'src/shared/enums/mfa.enum';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { UserCreateRequest, UserUpdateRequest } from '../../../lib/dto/request/user-management.req';
import {
  AdminBootstrapResponse,
  PaginatedUserResponse,
  TempPasswordResponse,
  UserResponse,
} from '../../../lib/dto/response/user.res';
import { UserManagementService } from './user-management.service';

@ApiTags('User Management')
@Controller('user-management')
export class UserManagementController {
  constructor(
    private userService: UserManagementService,
    private configService: ConfigService,
  ) {}

  @ApiOperation({ summary: 'Create a new user account' })
  @ApiResponse({ type: UserResponse })
  @Permissions({ permissions: [PermissionsEnum.CREATE_USER] })
  @UseInterceptors(new ResponseSerializerInterceptor(UserResponse))
  @Post()
  async createUser(@Body() createUserDto: UserCreateRequest, @GetUser() user: CurrentUser) {
    const result = await this.userService.createUser(createUserDto, user);
    return result;
  }

  /**
   * One-time bootstrap of the first administrator.
   *
   * `@Public()` by necessity — it exists for the moment before any account can
   * authorize anything. That makes the `x-admin-secret` header the only thing
   * standing in front of a full-privilege account, so it is treated as a
   * credential: constant-time comparison, rate limited, and a token the env
   * schema requires to be 32+ chars and not the shipped placeholder.
   */
  @ApiOperation({ summary: 'Create the first admin user (bootstrap)' })
  @ApiResponse({ type: AdminBootstrapResponse })
  @Public()
  @RateLimit({ window: 300, max: 5 })
  @UseInterceptors(new ResponseSerializerInterceptor(AdminBootstrapResponse))
  @Post('admin')
  async createAdmin(@Headers('x-admin-secret') secret: string) {
    const expected = this.configService.get<string>('ADMIN_SETUP_TOKEN');

    if (!expected || !secret || !timingSafeEqualStr(secret, expected)) {
      throw new HttpException('Invalid admin setup token', HttpStatus.FORBIDDEN);
    }

    return this.userService.createAdmin();
  }

  @ApiOperation({ summary: 'Update a user account' })
  @ApiResponse({ type: UserResponse })
  @Permissions({ permissions: [PermissionsEnum.UPDATE_USER] })
  @UseInterceptors(new ResponseSerializerInterceptor(UserResponse))
  @Put(':userId')
  async updateUser(
    @Param('userId', ParamIdValidationPipe) userId: string,
    @Body() userUpdateDto: UserUpdateRequest,
    @GetUser() user: CurrentUser,
  ) {
    const result = await this.userService.updateUser(userId, userUpdateDto, user);
    return result;
  }

  @ApiOperation({
    summary: 'Generate a fresh temp password for a user (admin)',
    description:
      'For emailless users: generates a new temp password, hashes it into the user ' +
      'record, forces `mustResetPassword=true`, and revokes existing sessions. The plaintext ' +
      'is returned exactly once and is not stored anywhere recoverable.',
  })
  @ApiResponse({ type: TempPasswordResponse })
  @Permissions({ permissions: [PermissionsEnum.UPDATE_USER] })
  @RequiresStepUp(MfaStepUpScope.USER_RESET_CREDENTIALS)
  @UseInterceptors(new ResponseSerializerInterceptor(TempPasswordResponse))
  @Post(':userId/reset-credentials')
  async resetCredentials(
    @Param('userId', ParamIdValidationPipe) userId: string,
    @GetUser() user: CurrentUser,
  ) {
    return this.userService.resetCredentials(userId, user);
  }

  @ApiOperation({
    summary: 'Remove all MFA factors from a user (admin)',
    description:
      'Recovery for a lost authenticator. Removes every factor, backup code and trusted device, ' +
      'and revokes the user’s sessions so they sign in again with password only. The acting admin ' +
      'is recorded on the MFA audit trail.',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions({ permissions: [PermissionsEnum.UPDATE_USER] })
  @RequiresStepUp(MfaStepUpScope.USER_RESET_MFA)
  @Post(':userId/reset-mfa')
  async resetMfa(
    @Param('userId', ParamIdValidationPipe) userId: string,
    @GetUser() user: CurrentUser,
  ): Promise<void> {
    await this.userService.resetMfa(userId, user);
  }

  @ApiOperation({ summary: 'Revoke all sessions for a user (admin)' })
  @Permissions({ permissions: [PermissionsEnum.INVALIDATE_TOKEN] })
  @RequiresStepUp(MfaStepUpScope.USER_REVOKE_SESSIONS)
  @Post(':userId/revoke-sessions')
  async revokeSessions(
    @Param('userId', ParamIdValidationPipe) userId: string,
    @GetUser() user: CurrentUser,
  ) {
    return this.userService.revokeSessions(userId, user);
  }

  @ApiOperation({ summary: 'Delete a user account' })
  @ApiResponse({ type: UserResponse })
  @Permissions({ permissions: [PermissionsEnum.DELETE_USER] })
  @RequiresStepUp(MfaStepUpScope.USER_DELETE)
  @UseInterceptors(new ResponseSerializerInterceptor(UserResponse))
  @Delete(':userId')
  async deleteUser(
    @Param('userId', ParamIdValidationPipe) userId: string,
    @GetUser() user: CurrentUser,
  ) {
    const result = await this.userService.deleteUser(userId, user);
    return result;
  }

  @ApiOperation({ summary: 'List all users' })
  @ApiResponse({ type: PaginatedUserResponse })
  @ApiQuery({ type: PaginationQueryOptions })
  @Permissions({ permissions: [PermissionsEnum.READ_USER] })
  @UseInterceptors(new ResponseSerializerInterceptor(PaginatedUserResponse))
  @Get()
  async getUsers(@Query(QueryTransformPipe) query: PaginationQueryDto) {
    const result = await this.userService.getUsers(query);
    return result;
  }

  @ApiOperation({ summary: 'Get user details' })
  @ApiResponse({ type: UserResponse })
  @Permissions({ permissions: [PermissionsEnum.READ_USER] })
  @UseInterceptors(new ResponseSerializerInterceptor(UserResponse))
  @Get(':userId')
  async getUserById(@Param('userId', ParamIdValidationPipe) userId: string) {
    const result = await this.userService.getUserById(userId);
    return result;
  }

  @ApiOperation({ summary: 'Ban a user account' })
  @ApiResponse({ type: UserResponse })
  @Permissions({ permissions: [PermissionsEnum.UPDATE_USER] })
  @RequiresStepUp(MfaStepUpScope.USER_BAN)
  @UseInterceptors(new ResponseSerializerInterceptor(UserResponse))
  @Patch(':userId/ban')
  async banUser(
    @Param('userId', ParamIdValidationPipe) userId: string,
    @GetUser() user: CurrentUser,
  ) {
    return this.userService.banUser(userId, user);
  }

  @ApiOperation({ summary: 'Unban a user account' })
  @ApiResponse({ type: UserResponse })
  @Permissions({ permissions: [PermissionsEnum.UPDATE_USER] })
  // Same scope as ban: both change who may sign in, and restoring access is
  // the half an attacker with a stolen admin session actually wants.
  @RequiresStepUp(MfaStepUpScope.USER_BAN)
  @UseInterceptors(new ResponseSerializerInterceptor(UserResponse))
  @Patch(':userId/unban')
  async unbanUser(
    @Param('userId', ParamIdValidationPipe) userId: string,
    @GetUser() user: CurrentUser,
  ) {
    return this.userService.unbanUser(userId, user);
  }
}
