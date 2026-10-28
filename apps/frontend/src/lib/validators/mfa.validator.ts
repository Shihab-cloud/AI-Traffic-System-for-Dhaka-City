import { z } from 'zod';

import { MfaChallengePurposeEnum, MfaFactorTypeEnum, MfaStepUpScope } from '@/lib/enums/mfa.enum';

/** Shared MFA code field — 6–8 digits, whitespace tolerant. */
export const mfaCodeField = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6,8}$/, { message: 'Code must be 6–8 digits.' }));

/** RHF-friendly schema for any MFA code submission (verify / step-up / enroll). */
export const MfaCodeFormValidation = z.object({
  code: mfaCodeField,
});

export type MfaCodeForm = z.infer<typeof MfaCodeFormValidation>;

/**
 * Wire schemas mirroring `apps/backend/src/lib/dto/request/mfa.req.ts`.
 * Constraints match backend `class-validator` decorators so frontend can
 * pre-validate before round-trip and infer wire types via `z.infer`.
 */

export const EnrollFactorValidation = z.object({
  type: z.nativeEnum(MfaFactorTypeEnum),
});

export const StartChallengeValidation = z.object({
  factorId: z.string().uuid(),
  purpose: z.nativeEnum(MfaChallengePurposeEnum),
  scope: z.string().max(80).optional(),
});

export const VerifyChallengeValidation = z.object({
  challengeId: z.string().uuid(),
  code: z.string().max(64),
});

export const StartStepUpValidation = z.object({
  factorId: z.string().uuid(),
  scope: z.nativeEnum(MfaStepUpScope),
});

export const VerifyStepUpValidation = z.object({
  challengeId: z.string().uuid(),
  code: z.string().max(64),
});

export const VerifyBackupCodeValidation = z.object({
  code: z.string().max(64),
});

export const StartLoginChallengeValidation = z.object({
  attemptToken: z.string().max(128),
  factorType: z.nativeEnum(MfaFactorTypeEnum),
});

export const VerifyLoginChallengeValidation = z.object({
  attemptToken: z.string().max(128),
  challengeId: z.string().uuid(),
  code: z.string().max(64),
  /**
   * Skip the login challenge on this browser for 30 days. Step-up is
   * unaffected — device trust never waives an action gate.
   */
  rememberDevice: z.boolean().optional(),
});
