import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Body } from '@nestjs/common';

import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { GetUser } from 'src/lib/decorators/user.decorator';
import { ActivateAccountRequest } from 'src/lib/dto/request/activate.req';
import { ProvisioningService } from './provisioning.service';

// Lives outside `/auth/*` because main.ts registers Better Auth as a catch-all
// wildcard (`/api/auth/*splat`), which would shadow any Nest controller mounted
// under `/auth`. `/account/activate` keeps the route admin-route-readable and
// stays out of BA's territory.
@ApiTags('Authentication')
@Controller('account')
export class ActivationController {
  constructor(private readonly provisioningService: ProvisioningService) {}

  @Post('activate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Complete first-login activation in one step',
    description:
      'For admin-provisioned users carrying a temp password. Replaces the temp password ' +
      'with a permanent one and, for emailless callers, attaches a (yet-to-be-verified) ' +
      'email. A verification link is dispatched fire-and-forget — the address only becomes ' +
      'a trusted recovery channel once verified. Caller must hold a session with ' +
      '`activation_required: true`.',
  })
  @ApiResponse({ status: 200, schema: { example: { ok: true } } })
  @ApiResponse({
    status: 400,
    description: 'Emailless caller did not supply an email (`EMAIL_REQUIRED`).',
  })
  @ApiResponse({ status: 403, description: 'Session is not in an activation-required state.' })
  @ApiResponse({ status: 409, description: 'Email already in use by another account.' })
  async activate(@GetUser() user: CurrentUser, @Body() dto: ActivateAccountRequest) {
    return this.provisioningService.activate(user, dto);
  }

  @Post('email/resend-verification')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resend the verification email for the caller',
    description:
      "Re-issues the verification link for the caller's currently-attached email. No-op " +
      'if the email is already verified. Used by the in-app "Verify your email" banner.',
  })
  @ApiResponse({ status: 200, schema: { example: { ok: true } } })
  @ApiResponse({ status: 400, description: 'Caller has no email on file.' })
  async resendVerification(@GetUser() user: CurrentUser) {
    return this.provisioningService.resendOwnVerificationEmail(user);
  }
}
