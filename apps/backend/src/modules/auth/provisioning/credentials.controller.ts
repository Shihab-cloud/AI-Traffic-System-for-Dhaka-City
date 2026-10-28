import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Permissions } from 'src/lib/decorators/permissions.decorator';
import { GetUser, type CurrentUser } from 'src/lib/decorators/user.decorator';
import {
  PendingCredentialResponse,
  RegenerateCredentialResponse,
} from 'src/lib/dto/response/credentials.res';
import { ParamIdValidationPipe } from 'src/lib/pipes/validation.pipe';
import { RequiresStepUp } from 'src/lib/decorators/step-up.decorator';
import { MfaStepUpScope } from 'src/shared/enums/mfa.enum';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { ProvisioningService } from './provisioning.service';

@ApiTags('Credentials')
@Controller('credentials')
export class CredentialsController {
  constructor(private readonly provisioningService: ProvisioningService) {}

  @Get('pending')
  @Permissions({ permissions: [PermissionsEnum.READ_USER] })
  @ApiOperation({
    summary: 'List users with a pending plaintext temp password',
    description:
      'Returned only for emailless, not-yet-activated users, and only for users the caller outranks. Rows disappear after the user activates.',
  })
  @ApiResponse({ status: 200, type: PendingCredentialResponse, isArray: true })
  async listPending(@GetUser() user: CurrentUser) {
    return this.provisioningService.listPendingCredentials(user);
  }

  @Post(':userId/regenerate')
  @HttpCode(200)
  @Permissions({ permissions: [PermissionsEnum.UPDATE_USER] })
  // Same guarantee as the `/user-management/:id/reset-credentials` twin: both
  // return a plaintext password, so both need a fresh proof of identity.
  @RequiresStepUp(MfaStepUpScope.USER_RESET_CREDENTIALS)
  @ApiOperation({
    summary: 'Issue a fresh temp password for one user',
    description:
      'Use when the previous temp password was lost. Rotates the credential account password and updates `users.pendingTempPassword`. Only valid for emailless users who have not yet activated.',
  })
  @ApiResponse({ status: 200, type: RegenerateCredentialResponse })
  async regenerate(
    @Param('userId', ParamIdValidationPipe) userId: string,
    @GetUser() user: CurrentUser,
  ) {
    return this.provisioningService.regenerateCredentials(userId, user);
  }
}
