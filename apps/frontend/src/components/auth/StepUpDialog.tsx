'use client';

import { apiErrorMessage } from '@/lib/utils/common.util';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Box,
  CircularProgress,
  FormControl,
  FormControlLabel,
  Link,
  Radio,
  RadioGroup,
  TextField,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import ModalLayout from '@/components/common/modal/ModalLayout';

import useMfaAction from '@/hooks/actions/useMfaAction';
import { MfaFactorStatusEnum, MfaFactorTypeEnum, type MfaStepUpScope } from '@/lib/enums/mfa.enum';
import { type MfaCodeForm, MfaCodeFormValidation } from '@/lib/validators/mfa.validator';

interface Props {
  open: boolean;
  scope: MfaStepUpScope;
  onComplete: (token: string | null) => void;
}

type Stage = 'pick_factor' | 'awaiting_code' | 'submitting' | 'error';

const FACTOR_LABEL: Record<MfaFactorTypeEnum, string> = {
  [MfaFactorTypeEnum.TOTP]: 'Authenticator app (TOTP)',
  [MfaFactorTypeEnum.EMAIL_OTP]: 'Email code',
  [MfaFactorTypeEnum.BACKUP_CODE]: 'Backup code',
};

export default function StepUpDialog({ open, scope, onComplete }: Props) {
  const { useFactorsQuery, useStepUpStartMutation, useStepUpVerifyMutation } = useMfaAction();
  const factorsQuery = useFactorsQuery(open);
  const stepUpStart = useStepUpStartMutation();
  const stepUpVerify = useStepUpVerifyMutation();

  const activeFactors = useMemo(
    () => (factorsQuery.data ?? []).filter((f) => f.status === MfaFactorStatusEnum.ACTIVE),
    [factorsQuery.data],
  );

  const [factorId, setFactorId] = useState<string>('');
  const [challengeId, setChallengeId] = useState<string>('');
  const [stage, setStage] = useState<Stage>('pick_factor');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const {
    register,
    handleSubmit,
    reset,
    resetField,
    control,
    formState: { errors },
  } = useForm<MfaCodeForm>({
    resolver: zodResolver(MfaCodeFormValidation),
    defaultValues: { code: '' },
    mode: 'onSubmit',
  });
  const code = useWatch({ control, name: 'code' });

  // Auto-select if exactly one factor and start the challenge.
  useEffect(() => {
    if (!open) return;
    if (factorsQuery.isLoading) return;
    if (activeFactors.length === 1 && !factorId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-selects the sole factor once the async factors query resolves
      setFactorId(activeFactors[0].id);
    }
  }, [open, factorsQuery.isLoading, activeFactors, factorId]);

  // When a factor is chosen, start the challenge automatically.
  useEffect(() => {
    if (!open || !factorId || challengeId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the step-up challenge when a factor is selected; resets stage/error before the mutation
    setStage('submitting');
    setErrorMessage('');
    stepUpStart.mutate(
      { factorId, scope },
      {
        onSuccess: (data) => {
          setChallengeId(data.challengeId);
          setStage('awaiting_code');
        },
        onError: (err: Error) => {
          setErrorMessage(apiErrorMessage(err, 'Failed to start challenge'));
          setStage('error');
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factorId, scope, open, challengeId]);

  const handleClose = () => {
    resetState();
    onComplete(null);
  };

  const resetState = () => {
    setFactorId('');
    setChallengeId('');
    reset({ code: '' });
    setStage('pick_factor');
    setErrorMessage('');
  };

  /** Back to the factor picker, discarding the open challenge. */
  const handleStartOver = resetState;

  /**
   * Re-issue a code for the same factor — the common case for a lost email.
   *
   * Clearing `challengeId` is the trigger: it is in the start-challenge
   * effect's deps, and that effect no-ops while a challenge is open.
   */
  const handleResend = () => {
    if (!factorId) return;
    setChallengeId('');
    reset({ code: '' });
    setErrorMessage('');
  };

  const canSwitchFactor = activeFactors.length > 1;

  const onVerify = handleSubmit(({ code }) => {
    if (!challengeId) return;
    setStage('submitting');
    setErrorMessage('');
    stepUpVerify.mutate(
      { challengeId, code },
      {
        onSuccess: (data) => {
          const token = data.token;
          resetState();
          onComplete(token);
        },
        onError: (err: Error) => {
          setErrorMessage(apiErrorMessage(err, 'Verification failed. Try again.'));
          resetField('code');
          setStage('awaiting_code');
        },
      },
    );
  });

  return (
    <ModalLayout
      title="Confirm your identity"
      subtitle="This action requires extra verification."
      maxWidth="xs"
      autoCloseOnConfirm={false}
      externalControl={{ open, onClose: handleClose }}
      slotProps={{
        cancel: { text: 'Cancel', disabled: stepUpVerify.isPending },
        confirm: {
          text: 'Verify',
          disabled: !code || stage !== 'awaiting_code' || stepUpVerify.isPending,
          onClick: (e) => onVerify(e),
        },
      }}
    >
      {factorsQuery.isLoading && <CircularProgress size={20} aria-label="Loading factors" />}

      {!factorsQuery.isLoading && activeFactors.length === 0 && (
        <Alert severity="error">
          No active MFA factor enrolled. Set one up in Settings → Security to perform this action.
        </Alert>
      )}

      {!factorId && activeFactors.length > 1 && (
        <FormControl>
          <RadioGroup value={factorId} onChange={(e) => setFactorId(e.target.value)}>
            {activeFactors.map((f) => (
              <FormControlLabel
                key={f.id}
                value={f.id}
                control={<Radio />}
                label={FACTOR_LABEL[f.type] ?? f.type}
              />
            ))}
          </RadioGroup>
        </FormControl>
      )}

      {stage === 'awaiting_code' && (
        <TextField
          autoFocus
          fullWidth
          label="Verification code"
          {...register('code')}
          margin="normal"
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
          disabled={stepUpVerify.isPending}
        />
      )}

      {stage === 'submitting' && <CircularProgress size={20} aria-label="Submitting" />}

      {errorMessage && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {errorMessage}
        </Alert>
      )}

      {/* Escape hatches. Present whenever a factor is chosen, including the
          `error` stage — otherwise Cancel is the only way out of a failure. */}
      {factorId && stage !== 'submitting' && (
        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
          <Link component="button" type="button" variant="body2" onClick={handleResend}>
            Send a new code
          </Link>
          {canSwitchFactor && (
            <Link component="button" type="button" variant="body2" onClick={handleStartOver}>
              Use a different method
            </Link>
          )}
        </Box>
      )}
    </ModalLayout>
  );
}
