'use client';

import { apiErrorMessage } from '@/lib/utils/common.util';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import BackupCodesPanel from '@/components/auth/BackupCodesPanel';
import { MfaChallengePurposeEnum, MfaFactorTypeEnum } from '@/lib/enums/mfa.enum';
import type { EnrollResult } from '@/lib/types/mfa.types';
import { type MfaCodeForm, MfaCodeFormValidation } from '@/lib/validators/mfa.validator';
import QRCode from 'react-qr-code';
import toast from 'react-hot-toast';
import useMfaAction from '@/hooks/actions/useMfaAction';

interface Props {
  /** Called when the full flow completes (factor active + backup codes shown). */
  onCompleted?: () => void;
  /** Optional CTA label for the final continue button. */
  finishLabel?: string;
}

type Stage = 'idle' | 'show_qr' | 'verifying' | 'show_backup' | 'done';

/**
 * Reusable enrollment flow:
 *   1. POST /mfa/enroll (TOTP) → otpauth URI + base32 secret.
 *   2. POST /mfa/challenge/start (purpose=ENROLL_VERIFY) → challengeId.
 *   3. POST /mfa/challenge/verify with first code → factor promoted to ACTIVE.
 *   4. POST /mfa/backup-codes/initial → 10 codes shown once.
 */
export default function TotpEnrollFlow({ onCompleted, finishLabel = 'Continue' }: Props) {
  const {
    useEnrollMutation,
    useChallengeStartMutation,
    useChallengeVerifyMutation,
    useInitialBackupCodesMutation,
  } = useMfaAction();
  const enroll = useEnrollMutation();
  const startChallenge = useChallengeStartMutation();
  const verifyChallenge = useChallengeVerifyMutation();
  const initialBackup = useInitialBackupCodesMutation();

  const [stage, setStage] = useState<Stage>('idle');
  const [enrollment, setEnrollment] = useState<EnrollResult | null>(null);
  const [challengeId, setChallengeId] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors },
  } = useForm<MfaCodeForm>({
    resolver: zodResolver(MfaCodeFormValidation),
    defaultValues: { code: '' },
    mode: 'onSubmit',
  });

  const otpauthUri = useMemo(() => enrollment?.setupData?.otpauthUri, [enrollment]);
  const secretBase32 = useMemo(() => enrollment?.setupData?.secretBase32, [enrollment]);

  /**
   * Open the ENROLL_VERIFY challenge for an already-created factor.
   *
   * Separate from `startEnroll` so a failure here can be retried on its own.
   * Retrying the whole enrollment instead created a *second* PENDING factor
   * row every time — and `enroll` has no uniqueness constraint, so a user who
   * kept pressing "Try again" accumulated orphaned factor and secret rows
   * indefinitely.
   */
  const openVerifyChallenge = (factorId: string) => {
    setErrorMessage('');
    startChallenge.mutate(
      { factorId, purpose: MfaChallengePurposeEnum.ENROLL_VERIFY },
      {
        onSuccess: (ch) => setChallengeId(ch.challengeId),
        onError: (err: Error) =>
          setErrorMessage(apiErrorMessage(err, 'Could not send a verification challenge')),
      },
    );
  };

  const startEnroll = () => {
    setStage('idle');
    setErrorMessage('');
    enroll.mutate(
      { type: MfaFactorTypeEnum.TOTP },
      {
        onSuccess: (data) => {
          setEnrollment(data);
          setStage('show_qr');
          // Open the verify challenge immediately so the user can submit the
          // first code without an extra round-trip.
          openVerifyChallenge(data.factorId);
        },
        onError: (err: Error) => setErrorMessage(apiErrorMessage(err, 'Could not start setup')),
      },
    );
  };

  // Auto-start on mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time async kickoff: fires enroll/challenge mutations whose callbacks drive stage state; not render-derivable
    if (stage === 'idle' && !enrollment) startEnroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitCode = handleSubmit(({ code }) => {
    if (!challengeId) return;
    setStage('verifying');
    setErrorMessage('');
    verifyChallenge.mutate(
      { challengeId, code },
      {
        onSuccess: () => {
          // Generate the user's first backup-code set.
          initialBackup.mutate(undefined, {
            onSuccess: (data) => {
              setBackupCodes(data.codes);
              setStage('show_backup');
            },
            onError: (err: Error) => {
              // If codes already existed (e.g. repeat enrollment), fall through
              // without showing them — user can regenerate from settings later.
              toast.error(apiErrorMessage(err, 'Could not generate backup codes'));
              setStage('done');
              onCompleted?.();
            },
          });
        },
        onError: (err: Error) => {
          setErrorMessage(apiErrorMessage(err, 'Verification failed. Try again.'));
          resetField('code');
          setStage('show_qr');
        },
      },
    );
  });

  const finish = () => {
    setStage('done');
    onCompleted?.();
  };

  if (stage === 'idle' && !enrollment && enroll.isPending) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <CircularProgress />
      </Paper>
    );
  }

  // Retry whenever there is an error and no challenge to answer — not gated on
  // `stage`, which is already `'show_qr'` by the time the challenge call can
  // fail, leaving a QR code with a permanently disabled input.
  if (errorMessage && !challengeId) {
    const canRetryChallenge = !!enrollment?.factorId;
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage}
        </Alert>
        <Button
          variant="contained"
          onClick={() =>
            canRetryChallenge ? openVerifyChallenge(enrollment.factorId) : startEnroll()
          }
        >
          Try again
        </Button>
      </Paper>
    );
  }

  if (stage === 'show_backup') {
    return (
      <Stack spacing={3}>
        <BackupCodesPanel codes={backupCodes} />
        <Button variant="contained" size="large" onClick={finish}>
          {finishLabel}
        </Button>
      </Stack>
    );
  }

  if (stage === 'done') return null;

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Typography variant="h6">Set up TOTP</Typography>
        <Typography variant="body2" color="text.secondary">
          Open Google Authenticator, Authy, 1Password, or any RFC 6238 authenticator app and scan
          the QR code below. Enter the 6-digit code it shows to confirm setup.
        </Typography>

        {otpauthUri ? (
          <Box
            sx={{
              p: 2,
              backgroundColor: '#fff',
              alignSelf: 'center',
              borderRadius: 1,
            }}
          >
            <QRCode value={otpauthUri} size={192} />
          </Box>
        ) : (
          <CircularProgress size={32} />
        )}

        {secretBase32 && (
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">
              Can&apos;t scan? Enter this secret manually:
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {secretBase32}
            </Typography>
          </Stack>
        )}

        <form onSubmit={submitCode}>
          <Stack spacing={2}>
            <TextField
              autoFocus
              label="Verification code"
              {...register('code')}
              slotProps={{
                htmlInput: {
                  inputMode: 'numeric',
                  pattern: '[0-9]*',
                  maxLength: 8,
                  // Lets iOS/Android offer the emailed code above the keyboard.
                  autoComplete: 'one-time-code',
                },
              }}
              error={!!errors.code}
              helperText={errors.code?.message}
              disabled={stage === 'verifying' || !challengeId}
            />
            {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={stage === 'verifying' || !challengeId}
            >
              {stage === 'verifying' ? 'Verifying…' : 'Verify and continue'}
            </Button>
          </Stack>
        </form>
      </Stack>
    </Paper>
  );
}
