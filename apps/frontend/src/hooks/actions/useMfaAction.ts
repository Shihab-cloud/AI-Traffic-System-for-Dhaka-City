'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { QUERY_KEYS } from '@/lib/constants/query-keys';
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
import mfaService from '@/lib/services/mfa.service';

export default function useMfaAction() {
  const qc = useQueryClient();

  // ── Queries ──────────────────────────────────────────────────────────────

  const useFactorsQuery = (enabled = true) =>
    useQuery({
      queryKey: [QUERY_KEYS.mfa.factors],
      queryFn: () => mfaService.listFactors(),
      enabled,
    });

  const useBackupRemainingQuery = (enabled = true) =>
    useQuery({
      queryKey: [QUERY_KEYS.mfa.backupRemaining],
      queryFn: () => mfaService.backupCodesRemaining(),
      enabled,
    });

  const useTrustedDevicesQuery = (enabled = true) =>
    useQuery({
      queryKey: [QUERY_KEYS.mfa.trustedDevices],
      queryFn: () => mfaService.listTrustedDevices(),
      enabled,
    });

  // ── Mutations: enrollment + lifecycle ────────────────────────────────────

  const useEnrollMutation = () =>
    useMutation({
      mutationFn: (data: EnrollFactorRequest) => mfaService.enroll(data),
      onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEYS.mfa.factors] }),
    });

  const useDisableMfaMutation = () =>
    useMutation({
      mutationFn: () => mfaService.disable(),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: [QUERY_KEYS.mfa.factors] });
        qc.invalidateQueries({ queryKey: [QUERY_KEYS.mfa.backupRemaining] });
        qc.invalidateQueries({ queryKey: [QUERY_KEYS.mfa.trustedDevices] });
      },
    });

  // ── Mutations: challenge (login + enroll-verify) ─────────────────────────

  const useChallengeStartMutation = () =>
    useMutation({
      mutationFn: (data: StartChallengeRequest) => mfaService.startChallenge(data),
    });

  const useChallengeVerifyMutation = () =>
    useMutation({
      mutationFn: (data: VerifyChallengeRequest) => mfaService.verifyChallenge(data),
      onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEYS.mfa.factors] }),
    });

  // ── Mutations: step-up ────────────────────────────────────────────────────

  const useStepUpStartMutation = () =>
    useMutation({
      mutationFn: (data: StartStepUpRequest) => mfaService.startStepUp(data),
    });

  const useStepUpVerifyMutation = () =>
    useMutation({
      mutationFn: (data: VerifyStepUpRequest) => mfaService.verifyStepUp(data),
    });

  // ── Mutations: backup codes ──────────────────────────────────────────────

  const useInitialBackupCodesMutation = () =>
    useMutation({
      mutationFn: () => mfaService.initialBackupCodes(),
      onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEYS.mfa.backupRemaining] }),
    });

  const useRegenerateBackupCodesMutation = () =>
    useMutation({
      mutationFn: () => mfaService.regenerateBackupCodes(),
      onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEYS.mfa.backupRemaining] }),
    });

  const useVerifyBackupCodeMutation = () =>
    useMutation({
      mutationFn: (data: VerifyBackupCodeRequest) => mfaService.verifyBackupCode(data),
      onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEYS.mfa.backupRemaining] }),
    });

  // ── Mutations: trusted devices ───────────────────────────────────────────

  const useRevokeTrustedDeviceMutation = () =>
    useMutation({
      mutationFn: (id: string) => mfaService.revokeTrustedDevice(id),
      onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEYS.mfa.trustedDevices] }),
    });

  // ── Mutations: public login flow (no JWT) ─────────────────────────────────

  const useLoginChallengeStartMutation = () =>
    useMutation({
      mutationFn: (data: StartLoginChallengeRequest) => mfaService.startLoginChallenge(data),
    });

  const useLoginChallengeVerifyMutation = () =>
    useMutation({
      mutationFn: (data: VerifyLoginChallengeRequest) => mfaService.verifyLoginChallenge(data),
    });

  return {
    useFactorsQuery,
    useBackupRemainingQuery,
    useTrustedDevicesQuery,
    useEnrollMutation,
    useDisableMfaMutation,
    useChallengeStartMutation,
    useChallengeVerifyMutation,
    useStepUpStartMutation,
    useStepUpVerifyMutation,
    useInitialBackupCodesMutation,
    useRegenerateBackupCodesMutation,
    useVerifyBackupCodeMutation,
    useRevokeTrustedDeviceMutation,
    useLoginChallengeStartMutation,
    useLoginChallengeVerifyMutation,
  };
}
