import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AmrEnum } from '../../shared/enums/auth.enum';
import type { Aal, JwtRole } from '../types/token.type';

export type CurrentUser = {
  id: string;
  email: string | null;
  role: JwtRole | null;
  /** Better Auth session id; populated when the JWT carries `sid`. Omitted on legacy tokens. */
  sid?: string;
  /** Authentication Assurance Level of the active session. Defaults to 1 on legacy tokens. */
  aal: Aal;
  /** Authentication Method References. Defaults to `[AmrEnum.PWD]` on legacy tokens. */
  amr: AmrEnum[];
  /** Unix seconds of the last MFA challenge satisfied for this session. */
  mfa_at?: number;
  /** True when this signed-in user is in the grace window without an enrolled factor. */
  enrollment_required?: boolean;
  /** True when the user must complete activation (set new password / optionally add email) before reaching app routes. */
  activation_required?: boolean;
};
interface AuthenticatedRequest extends Request {
  user: CurrentUser;
}

export const GetUser = createParamDecorator(
  (data: keyof CurrentUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

    const user: CurrentUser = {
      id: request.user.id,
      email: request.user.email,
      role: request.user.role,
      sid: request.user.sid,
      aal: request.user.aal,
      amr: request.user.amr,
      mfa_at: request.user.mfa_at,
      enrollment_required: request.user.enrollment_required,
      activation_required: request.user.activation_required,
    };

    return data ? user?.[data] : user;
  },
);
