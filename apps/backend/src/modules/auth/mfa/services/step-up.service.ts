import { randomUUID } from 'crypto';

import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import { MfaStepUpToken, MfaStepUpTokenModel } from 'src/schemas/mfa/step-up-token.schema';
import type {
  ChallengeStarted,
  StepUpConsumeTokenInput,
  StepUpStartChallengeInput,
  StepUpVerifyInput,
  StepUpVerifyResult,
} from 'src/lib/types/mfa.types';
import { MfaAuditEventEnum, MfaChallengePurposeEnum } from 'src/shared/enums/mfa.enum';
import { StepUpTokenSigner } from '../crypto/token-signer';
import { MfaService } from './mfa.service';
import { PolicyService } from './policy.service';

const STEP_UP_TOKEN_TTL_SEC = 5 * 60;

/**
 * StepUpService — orchestrates the step-up auth dance.
 *
 *   1. Client calls /api/mfa/step-up/start with scope + factorId  → challengeId.
 *   2. Client submits code to /api/mfa/step-up/verify              → step_up_token.
 *   3. Client retries the original sensitive endpoint with the token in the
 *      `Authorization-Step-Up` header. StepUpGuard consumes the token
 *      atomically (findOneAndDelete) and allows the call.
 *
 * Single-use, sid-bound, scope-bound, expiring. No replay window at the DB level.
 */
@Injectable()
export class StepUpService {
  constructor(
    @InjectModel(MfaStepUpToken.name) private readonly tokenModel: MfaStepUpTokenModel,
    private readonly mfa: MfaService,
    private readonly signer: StepUpTokenSigner,
    private readonly policy: PolicyService,
  ) {}

  /**
   * Public-endpoint façade for `/api/mfa/step-up/start`. Enforces the policy
   * gate (caller must have at least one factor that can answer step-up) and
   * the session-id requirement before opening the challenge. Throws on either
   * gate failure so the controller stays parse → call → return.
   */
  async startGuardedChallenge(input: StepUpStartChallengeInput): Promise<ChallengeStarted> {
    if (!input.sessionId) {
      throw new UnauthorizedException({ error: 'no_session_id' });
    }
    if (!(await this.policy.canAnswerStepUp(input.userId))) {
      throw new BadRequestException('No factor available for step-up');
    }
    return this.startChallenge(input);
  }

  /**
   * Public-endpoint façade for `/api/mfa/step-up/verify`. Wraps `verifyAndIssue`
   * with the session-id requirement and converts the discriminated-union
   * failure shape to a 401 so the controller stays thin.
   */
  async verifyGuarded(input: StepUpVerifyInput): Promise<{
    token: string;
    jti: string;
    expiresAt: Date;
    scope: string;
  }> {
    if (!input.sessionId) {
      throw new UnauthorizedException({ error: 'no_session_id' });
    }
    const result = await this.verifyAndIssue(input);
    if (!result.ok) {
      throw new UnauthorizedException({ error: 'mfa_verification_failed', reason: result.reason });
    }
    return result.issued;
  }

  /**
   * Open a step-up challenge. The challenge belongs to a session — the caller
   * MUST pass the active session id (from the JWT's `sid` claim) so the issued
   * token can be bound to that session.
   */
  startChallenge(input: StepUpStartChallengeInput): Promise<ChallengeStarted> {
    return this.mfa.startChallenge({
      userId: input.userId,
      factorId: input.factorId,
      purpose: MfaChallengePurposeEnum.STEP_UP,
      scope: input.scope,
      sessionId: input.sessionId,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  /**
   * Verify the challenge code and, on success, issue a step-up token bound to
   * (user, session, scope). Token row inserted in `mfa_step_up_tokens` so the
   * guard can consume atomically.
   */
  async verifyAndIssue(input: StepUpVerifyInput): Promise<StepUpVerifyResult> {
    const result = await this.mfa.verifyChallenge({
      challengeId: input.challengeId,
      code: input.code,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    if (!result.ok) return { ok: false, reason: result.reason ?? 'invalid_code' };
    if (result.purpose !== MfaChallengePurposeEnum.STEP_UP) {
      return { ok: false, reason: 'wrong_purpose' };
    }
    if (!result.scope) {
      return { ok: false, reason: 'wrong_purpose' };
    }
    // Required, not conditional. A challenge that somehow carries no session
    // id would otherwise skip the binding entirely and mint a step-up token
    // usable from any session — the invariant is held here, not by trusting
    // that the two code paths which set it always do.
    if (result.sessionId !== input.sessionId) {
      return { ok: false, reason: 'wrong_session' };
    }
    if (!result.userId) return { ok: false, reason: 'not_found' };

    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + STEP_UP_TOKEN_TTL_SEC * 1000);

    await this.tokenModel.create({
      jti,
      userId: result.userId,
      sessionId: input.sessionId,
      scope: result.scope,
      expiresAt,
    });

    const token = await this.signer.sign({
      sub: result.userId,
      sid: input.sessionId,
      scope: result.scope,
      jti,
      expiresAtSec: Math.floor(expiresAt.getTime() / 1000),
    });

    await this.mfa.audit({
      userId: result.userId,
      event: MfaAuditEventEnum.STEP_UP_ISSUED,
      factorType: result.factorType,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { scope: result.scope, jti },
    });

    return { ok: true, issued: { token, jti, expiresAt, scope: result.scope } };
  }

  /**
   * Consume a step-up token for a specific (user, session, scope). Atomic
   * findOneAndDelete — exactly one consumer wins. Token signature is verified
   * first; if signature is bad we never touch the DB.
   *
   * Returns true if the token authorizes this exact scope on this exact session
   * for this exact user. Otherwise returns false.
   */
  async consumeToken(input: StepUpConsumeTokenInput): Promise<boolean> {
    let claims: { sub: string; sid: string; scope: string; jti: string; exp: number };
    try {
      claims = await this.signer.verify(input.token);
    } catch {
      return false;
    }
    if (claims.sub !== input.expectedSub) return false;
    if (claims.sid !== input.expectedSid) return false;
    if (claims.scope !== input.expectedScope) return false;

    const deleted = await this.tokenModel.findOneAndDelete({
      jti: claims.jti,
      userId: claims.sub,
      sessionId: claims.sid,
      scope: claims.scope,
      // Mongo's TTL sweep lags by up to ~60s, so expiry is enforced in the
      // filter rather than left to the row disappearing on time.
      expiresAt: { $gt: new Date() },
    });
    if (!deleted) return false;

    await this.mfa.audit({
      userId: claims.sub,
      event: MfaAuditEventEnum.STEP_UP_CONSUMED,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { scope: claims.scope, jti: claims.jti },
    });
    return true;
  }
}
