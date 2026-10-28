import { APIUrl } from '@/lib/constants/url.config';
import {
  EnrollFactorRequest,
  StartChallengeRequest,
  StartLoginChallengeRequest,
  StartStepUpRequest,
  VerifyBackupCodeRequest,
  VerifyChallengeRequest,
  VerifyLoginChallengeRequest,
  VerifyStepUpRequest,
} from '@/lib/dtos/request/mfa.req';
import {
  BackupCodesRemaining,
  BackupCodesResult,
  ChallengeStarted,
  EnrollResult,
  ListedFactor,
  StepUpTokenIssued,
  TrustedDevice,
} from '@/lib/types/mfa.types';
import httpClient, { httpClientWithoutToken } from '@/lib/utils/httpClient';

class MfaService {
  // ── Factors ────────────────────────────────────────────────────────────────

  async listFactors() {
    const res = await httpClient.get<ListedFactor[]>(APIUrl.mfa.factors());
    return res.data;
  }

  async enroll(data: EnrollFactorRequest) {
    const res = await httpClient.post<EnrollResult>(APIUrl.mfa.enroll(), data);
    return res.data;
  }

  /**
   * Disable all factors. Requires step-up — the global httpClient interceptor
   * will pop the step-up dialog automatically when the server responds 401.
   */
  async disable() {
    await httpClient.post(APIUrl.mfa.disable());
  }

  /**
   * Postpone forced enrollment for the current session. Backend drops the
   * `enrollment_required` flag from session state; flag reapplies at next
   * sign-in. Caller should hard-navigate away so the proxy re-reads session.
   */
  async postpone() {
    await httpClient.post(APIUrl.mfa.postpone());
  }

  // ── Challenge (login + enroll-verify, NOT step-up) ─────────────────────────

  async startChallenge(data: StartChallengeRequest) {
    const res = await httpClient.post<ChallengeStarted>(APIUrl.mfa.challengeStart(), data);
    return res.data;
  }

  async verifyChallenge(data: VerifyChallengeRequest) {
    const res = await httpClient.post<{ ok: true; factorType: string; purpose: string }>(
      APIUrl.mfa.challengeVerify(),
      data,
    );
    return res.data;
  }

  // ── Step-up ────────────────────────────────────────────────────────────────

  async startStepUp(data: StartStepUpRequest) {
    const res = await httpClient.post<ChallengeStarted>(APIUrl.mfa.stepUpStart(), data);
    return res.data;
  }

  async verifyStepUp(data: VerifyStepUpRequest) {
    const res = await httpClient.post<StepUpTokenIssued>(APIUrl.mfa.stepUpVerify(), data);
    return res.data;
  }

  // ── Backup codes ──────────────────────────────────────────────────────────

  /** First-time generation. Errors if codes already exist (use regenerate then). */
  async initialBackupCodes() {
    const res = await httpClient.post<BackupCodesResult>(APIUrl.mfa.backupInitial());
    return res.data;
  }

  /** Regenerate. Requires step-up. */
  async regenerateBackupCodes() {
    const res = await httpClient.post<BackupCodesResult>(APIUrl.mfa.backupRegenerate());
    return res.data;
  }

  async backupCodesRemaining() {
    const res = await httpClient.get<BackupCodesRemaining>(APIUrl.mfa.backupRemaining());
    return res.data;
  }

  async verifyBackupCode(data: VerifyBackupCodeRequest) {
    const res = await httpClient.post<{ ok: true; remaining: number }>(
      APIUrl.mfa.backupVerify(),
      data,
    );
    return res.data;
  }

  // ── Trusted devices ───────────────────────────────────────────────────────

  async listTrustedDevices() {
    const res = await httpClient.get<TrustedDevice[]>(APIUrl.mfa.trustedDevices());
    return res.data;
  }

  async revokeTrustedDevice(id: string) {
    await httpClient.delete(APIUrl.mfa.trustedDevice(id));
  }

  // ── Public login flow (no JWT — bound to attemptToken) ────────────────────

  async startLoginChallenge(data: StartLoginChallengeRequest) {
    const res = await httpClientWithoutToken.post<ChallengeStarted>(
      APIUrl.mfa.loginChallenge(),
      data,
    );
    return res.data;
  }

  async verifyLoginChallenge(data: VerifyLoginChallengeRequest) {
    const res = await httpClientWithoutToken.post<{ ok: true }>(APIUrl.mfa.loginVerify(), data);
    return res.data;
  }
}

const mfaService = new MfaService();
export default mfaService;
