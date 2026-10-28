import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { MfaService } from 'src/modules/auth/mfa/services/mfa.service';
import { StepUpService } from 'src/modules/auth/mfa/services/step-up.service';
import { STEP_UP_SCOPE_KEY, type StepUpRequirement } from '../decorators/step-up.decorator';
import type { CurrentUser } from '../decorators/user.decorator';
import { resolveClientIp } from '../utils/client-ip.util';

const STEP_UP_HEADER = 'authorization-step-up';

/**
 * StepUpGuard — runs after AuthGuard + PermissionsGuard. If the route carries
 * @RequiresStepUp(scope), this guard requires a valid step-up token in the
 * `Authorization-Step-Up` header.
 *
 * The token is single-use, sid-bound, scope-bound. Consumption is atomic at
 * the DB level (findOneAndDelete).
 *
 * Failure response shape (HTTP 401):
 *   { error: 'step_up_required', scope: '<scope>' }
 *
 * The frontend uses this to drive the step-up flow: open a challenge, verify,
 * retry the original request with the issued token.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly stepUp: StepUpService,
    private readonly mfa: MfaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<StepUpRequirement | undefined>(
      STEP_UP_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement) return true;

    const { scope } = requirement;
    const request = context.switchToHttp().getRequest<Request & { user?: CurrentUser }>();
    if (requirement.when && !requirement.when(request)) return true;

    const user = request.user;
    if (!user || !user.sid) {
      throw new HttpException(
        { error: 'step_up_required', scope, reason: 'no_session_id' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const headerVal = request.headers[STEP_UP_HEADER];
    const token = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    if (!token) {
      // Fails closed either way. `canAnswerStepUp` only picks the reason, so
      // the frontend can send a user with no usable factor to enrollment
      // instead of looping them through a challenge they cannot complete.
      const reason = (await this.mfa.canAnswerStepUp(user.id)) ? undefined : 'enroll_required';
      throw new HttpException(
        { error: 'step_up_required', scope, ...(reason ? { reason } : {}) },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const ok = await this.stepUp.consumeToken({
      token,
      expectedSub: user.id,
      expectedSid: user.sid,
      expectedScope: scope,
      // Resolved from the forwarded chain, not `request.ip` — `trust proxy` is
      // not set, so `request.ip` is the proxy's bridge address and the
      // STEP_UP_CONSUMED audit row would disagree with the issue row.
      ip: resolveClientIp(request),
      userAgent: request.headers['user-agent'] ?? null,
    });

    if (!ok) {
      throw new HttpException(
        { error: 'step_up_required', scope, reason: 'invalid_token' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    return true;
  }
}
