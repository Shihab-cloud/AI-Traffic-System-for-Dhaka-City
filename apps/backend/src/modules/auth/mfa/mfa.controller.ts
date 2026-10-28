import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from 'src/lib/decorators/auth.decorator';
import { RateLimit, type RateLimitRule } from 'src/lib/decorators/rate-limit.decorator';
import { RequiresStepUp } from 'src/lib/decorators/step-up.decorator';
import { GetUser, type CurrentUser } from 'src/lib/decorators/user.decorator';
import {
  EnrollFactorRequest,
  StartChallengeRequest,
  StartLoginChallengeRequest,
  StartStepUpRequest,
  VerifyBackupCodeRequest,
  VerifyChallengeRequest,
  VerifyLoginChallengeRequest,
  VerifyStepUpRequest,
} from 'src/lib/dto/request/mfa.req';
import {
  BackupCodeVerifyResponse,
  BackupCodesRemainingResponse,
  BackupCodesResponse,
  ChallengeStartedResponse,
  FactorEnrollResponse,
  ListedFactorResponse,
  MfaOkResponse,
  StepUpTokenResponse,
  TrustedDeviceResponse,
  VerifyChallengeResponse,
} from 'src/lib/dto/response/mfa.res';
import { ResponseSerializerInterceptor } from 'src/lib/interceptors/response-serializer.interceptor';
import { resolveClientIp } from 'src/lib/utils/client-ip.util';
import { MfaStepUpScope } from 'src/shared/enums/mfa.enum';
import { MfaService } from './services/mfa.service';
import { TRUSTED_DEVICE_COOKIE_NAME } from './services/trusted-device.service';
import { StepUpService } from './services/step-up.service';
import { ParamIdValidationPipe } from 'src/lib/pipes/validation.pipe';

/**
 * Per-IP ceilings for the endpoints that accept a secret from the caller.
 *
 * The per-challenge `attemptsRemaining` counter does not bound a caller who
 * keeps opening fresh challenges, so these are the only cross-challenge limit;
 * there is no per-user lockout. Kept loose enough for an office behind one
 * NAT, since a shared egress IP is a single bucket.
 */
const CODE_VERIFY_LIMIT: RateLimitRule = { window: 60, max: 10 };

/**
 * Endpoints that open a challenge. Looser than verification (a user retrying a
 * flow legitimately hits these more often) but still bounded, because Email-OTP
 * challenges send mail.
 */
const CODE_DELIVERY_LIMIT: RateLimitRule = { window: 60, max: 15 };

@ApiTags('MFA')
@Controller('mfa')
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly stepUp: StepUpService,
  ) {}

  // ─── Login MFA challenge (public — bound to attemptToken) ────────────────

  @Public()
  @Post('login/challenge')
  @RateLimit(CODE_DELIVERY_LIMIT)
  @ApiOperation({
    summary:
      'Open an MFA challenge for an in-progress login. Authorized by `attemptToken` returned in the MFA_REQUIRED response from /api/auth/sign-in/email.',
  })
  @ApiResponse({ type: ChallengeStartedResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(ChallengeStartedResponse))
  startLoginChallenge(@Body() dto: StartLoginChallengeRequest, @Req() req: Request) {
    return this.mfa.startLoginChallenge({
      attemptToken: dto.attemptToken,
      factorType: dto.factorType,
      ip: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Public()
  @Post('login/verify')
  @RateLimit(CODE_VERIFY_LIMIT)
  @ApiOperation({
    summary:
      'Verify the login MFA challenge. On success, emits a short-lived proof so the client can retry /api/auth/sign-in/email and obtain an AAL2 session.',
  })
  @ApiResponse({ type: MfaOkResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(MfaOkResponse))
  async verifyLoginChallenge(
    @Body() dto: VerifyLoginChallengeRequest,
    @Req() req: Request,
    // `passthrough` so Nest still serializes the returned object through the
    // interceptor — the response object is only borrowed to set the cookie.
    @Res({ passthrough: true }) res: Response,
  ): Promise<MfaOkResponse> {
    const result = await this.mfa.completeLoginChallenge({
      attemptToken: dto.attemptToken,
      challengeId: dto.challengeId,
      code: dto.code,
      ip: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
      rememberDevice: dto.rememberDevice,
    });

    if (result.trustedDevice) {
      res.cookie(TRUSTED_DEVICE_COOKIE_NAME, result.trustedDevice.cookieValue, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        expires: result.trustedDevice.expiresAt,
      });
    }

    return { ok: true };
  }

  // ─── Factors ─────────────────────────────────────────────────────────────

  @Get('factors')
  @ApiOperation({ summary: 'List enrolled factors for the current user.' })
  @ApiResponse({ type: ListedFactorResponse, isArray: true })
  @UseInterceptors(new ResponseSerializerInterceptor(ListedFactorResponse))
  listFactors(@GetUser() user: CurrentUser) {
    return this.mfa.listFactors(user.id);
  }

  @Post('enroll')
  @RateLimit(CODE_DELIVERY_LIMIT)
  @ApiOperation({
    summary: 'Begin enrolling a factor. Returns setup data (e.g. otpauth URI for TOTP).',
  })
  @ApiResponse({ type: FactorEnrollResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(FactorEnrollResponse))
  enroll(@GetUser() user: CurrentUser, @Body() dto: EnrollFactorRequest, @Req() req: Request) {
    return this.mfa.enroll({
      userId: user.id,
      type: dto.type,
      ip: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresStepUp(MfaStepUpScope.ACCOUNT_DISABLE_MFA)
  @ApiOperation({
    summary:
      'Tear down all MFA factors for the user. Requires step-up. Invalidates the user sessions.',
  })
  async disable(@GetUser() user: CurrentUser, @Req() req: Request): Promise<void> {
    await this.mfa.disableAll({
      userId: user.id,
      sessionId: user.sid ?? null,
      ip: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Post('postpone')
  @ApiOperation({
    summary:
      'Postpone forced enrollment for the current session. Clears `enrollment_required` from session state so the FE stops redirecting to /auth/mfa-setup; flag reapplies at next sign-in.',
  })
  @ApiResponse({ type: MfaOkResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(MfaOkResponse))
  postpone(@GetUser() user: CurrentUser) {
    return this.mfa.postponeEnrollment({
      userId: user.id,
      sessionId: user.sid ?? '',
    });
  }

  // ─── Challenge (login + enroll-verify) ───────────────────────────────────

  @Post('challenge/start')
  @RateLimit(CODE_DELIVERY_LIMIT)
  @ApiOperation({
    summary: 'Open a challenge for login or factor enrollment. For Email-OTP, sends the code.',
  })
  @ApiResponse({ type: ChallengeStartedResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(ChallengeStartedResponse))
  startChallenge(
    @GetUser() user: CurrentUser,
    @Body() dto: StartChallengeRequest,
    @Req() req: Request,
  ) {
    return this.mfa.startAuthenticatedChallenge({
      userId: user.id,
      factorId: dto.factorId,
      purpose: dto.purpose,
      sessionId: user.sid ?? null,
      ip: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Post('challenge/verify')
  @RateLimit(CODE_VERIFY_LIMIT)
  @ApiOperation({
    summary: 'Verify a challenge code. For login challenges this completes the AAL2 transition.',
  })
  @ApiResponse({ type: VerifyChallengeResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(VerifyChallengeResponse))
  verifyChallenge(
    @GetUser() user: CurrentUser,
    @Body() dto: VerifyChallengeRequest,
    @Req() req: Request,
  ) {
    return this.mfa.verifyChallengeAndClearEnrollmentFlag({
      userId: user.id,
      sessionId: user.sid ?? null,
      challengeId: dto.challengeId,
      code: dto.code,
      ip: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  // ─── Step-up ─────────────────────────────────────────────────────────────

  @Post('step-up/start')
  @RateLimit(CODE_DELIVERY_LIMIT)
  @ApiOperation({ summary: 'Open a step-up challenge for a sensitive action scope.' })
  @ApiResponse({ type: ChallengeStartedResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(ChallengeStartedResponse))
  startStepUp(@GetUser() user: CurrentUser, @Body() dto: StartStepUpRequest, @Req() req: Request) {
    return this.stepUp.startGuardedChallenge({
      userId: user.id,
      sessionId: user.sid ?? '',
      scope: dto.scope,
      factorId: dto.factorId,
      ip: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Post('step-up/verify')
  @RateLimit(CODE_VERIFY_LIMIT)
  @ApiOperation({
    summary:
      'Verify the step-up challenge. Returns a single-use token to be passed in `Authorization-Step-Up` on the next sensitive call.',
  })
  @ApiResponse({ type: StepUpTokenResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(StepUpTokenResponse))
  verifyStepUp(
    @GetUser() user: CurrentUser,
    @Body() dto: VerifyStepUpRequest,
    @Req() req: Request,
  ) {
    return this.stepUp.verifyGuarded({
      challengeId: dto.challengeId,
      code: dto.code,
      sessionId: user.sid ?? '',
      ip: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  // ─── Backup codes ────────────────────────────────────────────────────────

  @Post('backup-codes/initial')
  @ApiOperation({
    summary:
      'Generate the user’s first backup-codes set. Errors if codes already exist (caller should use /regenerate, which requires step-up).',
  })
  @ApiResponse({ type: BackupCodesResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(BackupCodesResponse))
  initialBackupCodes(@GetUser() user: CurrentUser, @Req() req: Request) {
    return this.mfa.issueInitialBackupCodes({
      userId: user.id,
      ip: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Post('backup-codes/regenerate')
  @RequiresStepUp(MfaStepUpScope.ACCOUNT_REGEN_BACKUP_CODES)
  @ApiOperation({
    summary:
      'Regenerate backup codes — invalidates all previous codes, returns the new plaintext list once. Requires step-up.',
  })
  @ApiResponse({ type: BackupCodesResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(BackupCodesResponse))
  regenerateBackupCodes(@GetUser() user: CurrentUser, @Req() req: Request) {
    return this.mfa.regenerateBackupCodes({
      userId: user.id,
      ip: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Post('backup-codes/verify')
  @RateLimit(CODE_VERIFY_LIMIT)
  @ApiOperation({
    summary:
      'Verify a backup code. Single-use. On success, the code is consumed and cannot be reused.',
  })
  @ApiResponse({ type: BackupCodeVerifyResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(BackupCodeVerifyResponse))
  verifyBackupCode(
    @GetUser() user: CurrentUser,
    @Body() dto: VerifyBackupCodeRequest,
    @Req() req: Request,
  ) {
    return this.mfa.verifyBackupCode({
      userId: user.id,
      code: dto.code,
      ip: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Get('backup-codes/remaining')
  @ApiOperation({ summary: 'Number of unconsumed backup codes left for the user.' })
  @ApiResponse({ type: BackupCodesRemainingResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(BackupCodesRemainingResponse))
  backupCodesRemaining(@GetUser() user: CurrentUser) {
    return this.mfa.backupCodesRemaining(user.id);
  }

  // ─── Trusted devices ─────────────────────────────────────────────────────

  @Get('trusted-devices')
  @ApiOperation({ summary: 'List active trusted devices for the user.' })
  @ApiResponse({ type: TrustedDeviceResponse, isArray: true })
  @UseInterceptors(new ResponseSerializerInterceptor(TrustedDeviceResponse))
  listTrustedDevices(@GetUser() user: CurrentUser) {
    return this.mfa.listTrustedDevices(user.id);
  }

  @Delete('trusted-devices/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a trusted device.' })
  revokeTrustedDevice(
    @GetUser() user: CurrentUser,
    @Param('deviceId', ParamIdValidationPipe) deviceId: string,
  ): Promise<void> {
    return this.mfa.revokeTrustedDevice({ userId: user.id, deviceId });
  }
}
