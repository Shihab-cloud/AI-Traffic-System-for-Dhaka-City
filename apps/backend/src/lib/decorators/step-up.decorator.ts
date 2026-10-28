import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

import type { MfaStepUpScope } from '../../shared/enums/mfa.enum';

export const STEP_UP_SCOPE_KEY = 'mfa.step_up.scope';

export interface StepUpRequirement {
  scope: MfaStepUpScope;
  /**
   * Restricts the requirement to the requests that actually carry the
   * sensitive change. Without it a route is gated for every call, which on a
   * route users reach routinely (profile editing) locks out everyone who has
   * not enrolled a factor.
   */
  when?: (request: Request) => boolean;
}

/**
 * Mark a route as requiring a fresh MFA step-up.
 *
 * The request is rejected (401 `step_up_required`) unless it carries a valid
 * `Authorization-Step-Up` header bound to the same session, scoped to `scope`,
 * and not yet consumed. Tokens are single-use and expire 5 minutes after issue.
 *
 *   @Permissions({ permissions: [PermissionsEnum.DELETE_USER] })
 *   @RequiresStepUp(MfaStepUpScope.USER_DELETE)
 *   remove(...) { ... }
 *
 *   @RequiresStepUp(MfaStepUpScope.ACCOUNT_EMAIL_CHANGE, {
 *     when: (req) => emailIsChanging(req),
 *   })
 */
export const RequiresStepUp = (
  scope: MfaStepUpScope,
  options: Omit<StepUpRequirement, 'scope'> = {},
) => SetMetadata<string, StepUpRequirement>(STEP_UP_SCOPE_KEY, { scope, ...options });
