import { z } from 'zod';

import {
  EnrollFactorValidation,
  StartChallengeValidation,
  StartLoginChallengeValidation,
  StartStepUpValidation,
  VerifyBackupCodeValidation,
  VerifyChallengeValidation,
  VerifyLoginChallengeValidation,
  VerifyStepUpValidation,
} from '@/lib/validators/mfa.validator';

export type EnrollFactorRequest = z.infer<typeof EnrollFactorValidation>;
export type StartChallengeRequest = z.infer<typeof StartChallengeValidation>;
export type VerifyChallengeRequest = z.infer<typeof VerifyChallengeValidation>;
export type StartStepUpRequest = z.infer<typeof StartStepUpValidation>;
export type VerifyStepUpRequest = z.infer<typeof VerifyStepUpValidation>;
export type VerifyBackupCodeRequest = z.infer<typeof VerifyBackupCodeValidation>;
export type StartLoginChallengeRequest = z.infer<typeof StartLoginChallengeValidation>;
export type VerifyLoginChallengeRequest = z.infer<typeof VerifyLoginChallengeValidation>;
