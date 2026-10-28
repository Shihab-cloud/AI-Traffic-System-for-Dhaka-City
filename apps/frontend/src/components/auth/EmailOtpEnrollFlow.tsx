'use client';

import { apiErrorMessage } from '@/lib/utils/common.util';
import {
  Alert,
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import BackupCodesPanel from '@/components/auth/BackupCodesPanel';
import { MfaChallengePurposeEnum, MfaFactorTypeEnum } from '@/lib/enums/mfa.enum';
import type { EnrollResult } from '@/lib/types/mfa.types';
import { type MfaCodeForm, MfaCodeFormValidation } from '@/lib/validators/mfa.validator';
import toast from 'react-hot-toast';
import useMfaAction from '@/hooks/actions/useMfaAction';

interface Props {
  onCompleted?: () => void;
  finishLabel?: string;
}

type Stage = 'idle' | 'awaiting_code' | 'verifying' | 'show_backup' | 'done';

/**
 * Email OTP enrollment flow.
 *
 *   1. POST /mfa/enroll (EMAIL_OTP) → factor row in PENDING.
 *   2. POST /mfa/challenge/start (purpose=ENROLL_VERIFY) → adapter sends
 *      a 6-digit code to the user's account email.
 *   3. POST /mfa/challenge/verify with the code → promotes factor to ACTIVE
 *      and clears `enrollment_required` from session state.
 *   4. (first-time only) POST /mfa/backup-codes/initial → 10 codes shown
 *      once, identical UX to TOTP enrollment.
 */
export default function EmailOtpEnrollFlow({ onCompleted, finishLabel = 'Continue' }: Props) {
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

  /**
   * Open (or re-open) the ENROLL_VERIFY challenge for an existing factor.
   *
   * Kept separate from `startEnroll` so "Try again" after a send failure does
   * not re-enroll. `enroll` inserts a new PENDING factor row every call with no
   * uniqueness constraint, so retrying the whole flow left an orphaned factor —
   * and its envelope-encrypted secret — behind each time.
   */
  const openVerifyChallenge = (factorId: string) => {
    setErrorMessage('');
    startChallenge.mutate(
      { factorId, purpose: MfaChallengePurposeEnum.ENROLL_VERIFY },
      {
        onSuccess: (ch) => {
          setChallengeId(ch.challengeId);
          setStage('awaiting_code');
        },
        onError: (err: Error) =>
          setErrorMessage(apiErrorMessage(err, 'Could not send the verification code')),
      },
    );
  };

  const startEnroll = () => {
    setStage('idle');
    setErrorMessage('');
    enroll.mutate(
      { type: MfaFactorTypeEnum.EMAIL_OTP },
      {
        onSuccess: (data) => {
          setEnrollment(data);
          openVerifyChallenge(data.factorId);
        },
        onError: (err: Error) => setErrorMessage(apiErrorMessage(err, 'Could not start setup')),
      },
    );
  };

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
          initialBackup.mutate(undefined, {
            onSuccess: (data) => {
              setBackupCodes(data.codes);
              setStage('show_backup');
            },
            onError: () => {
              // Codes already exist (e.g. enrolling a second factor). Skip.
              setStage('done');
              onCompleted?.();
            },
          });
        },
        onError: (err: Error) => {
          setErrorMessage(apiErrorMessage(err, 'Verification failed. Try again.'));
          resetField('code');
          setStage('awaiting_code');
        },
      },
    );
  });

  const resendCode = () => {
    if (!enrollment) return;
    setErrorMessage('');
    startChallenge.mutate(
      { factorId: enrollment.factorId, purpose: MfaChallengePurposeEnum.ENROLL_VERIFY },
      {
        onSuccess: (ch) => {
          setChallengeId(ch.challengeId);
          toast.success('A new code has been sent to your email.');
        },
        onError: (err: Error) => setErrorMessage(apiErrorMessage(err, 'Failed to resend code')),
      },
    );
  };

  const finish = () => {
    setStage('done');
    onCompleted?.();
  };

  if (stage === 'idle' && enroll.isPending) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <CircularProgress />
      </Paper>
    );
  }

  // Any error with no challenge to answer — not just the `idle` stage, which
  // the flow has usually already left by the time the send can fail.
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
        <Typography variant="h6">Set up Email OTP</Typography>
        <Typography variant="body2" color="text.secondary">
          We&apos;ve emailed a 6-digit verification code to your account email. Enter it below to
          confirm setup. The code expires in 5 minutes.
        </Typography>

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
            <Stack direction="row" spacing={1}>
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={stage === 'verifying' || !challengeId}
              >
                {stage === 'verifying' ? 'Verifying…' : 'Verify and continue'}
              </Button>
              <Button onClick={resendCode} disabled={startChallenge.isPending} variant="text">
                Resend code
              </Button>
            </Stack>
          </Stack>
        </form>
      </Stack>
    </Paper>
  );
}
