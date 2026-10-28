import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import { MfaFactor, MfaFactorModel } from 'src/schemas/mfa/factor.schema';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { AmrEnum } from 'src/shared/enums/auth.enum';
import {
  MfaFactorStatusEnum,
  MfaFactorTypeEnum,
  type MfaStepUpScope,
} from 'src/shared/enums/mfa.enum';

export interface PolicyLoginContext {
  userId: string;
  /** Trusted-device verified by `TrustedDeviceService.isTrusted`. */
  trustedDevice: boolean;
}

export type LoginPolicyDecision =
  | { kind: 'allow'; amr: AmrEnum[] }
  | { kind: 'enroll_required' }
  | { kind: 'challenge_required'; availableFactors: MfaFactorTypeEnum[] };

@Injectable()
export class PolicyService {
  constructor(
    @InjectModel(MfaFactor.name) private readonly factorModel: MfaFactorModel,
    @InjectModel(User.name) private readonly userModel: UserModel,
  ) {}

  /**
   * MFA is opt-in for every role — no user is forced to enroll. Method kept
   * (rather than removing call sites) so a future per-role mandatory policy
   * can be reintroduced without rewiring the login decision tree.
   */
  isMandatoryEnrollment(_userId: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  /**
   * Decide what happens at login (called from BA databaseHook session.create.before).
   *
   * Order:
   *   1. Mandatory + no active factor → enroll_required (block).
   *   2. Trusted device cookie verified → allow (no challenge).
   *   3. Has active factor → challenge_required.
   *   4. Otherwise (member, opt-in, no factor) → allow.
   */
  async evaluateLogin(ctx: PolicyLoginContext): Promise<LoginPolicyDecision> {
    const factors = await this.factorModel
      .find({ userId: ctx.userId })
      .select('type status')
      .lean();
    let active = factors.filter((f) => f.status === MfaFactorStatusEnum.ACTIVE).map((f) => f.type);

    // Drop Email-OTP from the challenge menu when the user has no email on file.
    // The factor row may exist from before the email was removed; we just can't
    // deliver the code anywhere. Other factors (TOTP, backup codes) still work.
    if (active.includes(MfaFactorTypeEnum.EMAIL_OTP)) {
      const user = await this.userModel.findById(ctx.userId).select('email').lean();
      if (!user?.email) {
        active = active.filter((t) => t !== MfaFactorTypeEnum.EMAIL_OTP);
      }
    }

    if (active.length === 0) {
      if (await this.isMandatoryEnrollment(ctx.userId)) {
        return { kind: 'enroll_required' };
      }
      return { kind: 'allow', amr: [AmrEnum.PWD] };
    }

    if (ctx.trustedDevice) {
      return { kind: 'allow', amr: [AmrEnum.PWD, AmrEnum.TRUSTED_DEVICE] };
    }

    return { kind: 'challenge_required', availableFactors: active };
  }

  /** Whether a step-up scope must be checked. Today every scope is required. */
  isStepUpRequired(_scope: MfaStepUpScope): boolean {
    return true;
  }

  /**
   * Whether the user has an ACTIVE factor — the only thing that can answer a
   * step-up challenge.
   *
   * A verified email is not sufficient: `MfaService.startChallenge` requires a
   * `factorId` and throws "Factor not found" without a factor row. Reporting
   * only what is answerable is what lets the guard send those users to
   * enrollment (`reason: 'enroll_required'`) instead of a dead end.
   */
  async canAnswerStepUp(userId: string): Promise<boolean> {
    const factor = await this.factorModel
      .findOne({ userId, status: MfaFactorStatusEnum.ACTIVE })
      .select('_id')
      .lean();
    return !!factor;
  }
}
