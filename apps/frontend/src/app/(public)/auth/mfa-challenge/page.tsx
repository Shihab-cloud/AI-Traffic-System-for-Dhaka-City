'use client';

import { apiErrorMessage } from '@/lib/utils/common.util';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';

import AppLogo from '@/components/common/logo/AppLogo';
import { RouteUrls } from '@/lib/routes/route.config';
import { authClient } from '@/lib/auth-client';
import { MfaFactorTypeEnum } from '@/lib/enums/mfa.enum';
import type { MfaPendingLogin } from '@/lib/types/mfa.types';
import { MfaChallengeValidation, type MfaChallengeForm } from '@/lib/validators/auth.validator';
import { safeCallbackUrl } from '@/lib/utils/url.util';
import toast from 'react-hot-toast';
import useMfaAction from '@/hooks/actions/useMfaAction';

const MFA_PENDING_KEY = 'mfa_pending';

const FACTOR_LABEL: Record<MfaFactorTypeEnum, string> = {
  [MfaFactorTypeEnum.TOTP]: 'Authenticator app (TOTP)',
  [MfaFactorTypeEnum.EMAIL_OTP]: 'Email code',
  [MfaFactorTypeEnum.BACKUP_CODE]: 'Backup code',
};

export default function MfaChallengePage() {
  const router = useRouter();
  const { useLoginChallengeStartMutation, useLoginChallengeVerifyMutation } = useMfaAction();
  const startChallenge = useLoginChallengeStartMutation();
  const verifyChallenge = useLoginChallengeVerifyMutation();

  // Server / UI state — not user input. Stays as useState.
  const [pending, setPending] = useState<MfaPendingLogin | null>(null);
  const [challengeId, setChallengeId] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [completing, setCompleting] = useState(false);

  // Form state — factor selection + verification code, validated by zod.
  const {
    register,
    handleSubmit,
    control,
    setValue,
    resetField,
    formState: { errors },
  } = useForm<MfaChallengeForm>({
    resolver: zodResolver(MfaChallengeValidation),
    defaultValues: { factorType: undefined, code: '', rememberDevice: false },
    mode: 'onSubmit',
  });
  const factorType = useWatch({ control, name: 'factorType' });

  // Hydrate pending state on mount. Missing → bounce back to signin.
  useEffect(() => {
    const raw = sessionStorage.getItem(MFA_PENDING_KEY);
    if (!raw) {
      router.replace(RouteUrls.auth.signin);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as MfaPendingLogin;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates pending-login state from sessionStorage on mount; client-only store can't be read during SSR/render
      setPending(parsed);
      if (parsed.availableFactors.length === 1) {
        setValue('factorType', parsed.availableFactors[0]);
      }
    } catch {
      sessionStorage.removeItem(MFA_PENDING_KEY);
      router.replace(RouteUrls.auth.signin);
    }
  }, [router, setValue]);

  // When a factor is chosen, open a server-side challenge.
  useEffect(() => {
    if (!pending || !factorType || challengeId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears stale error before firing the challenge mutation; reacts to factorType, which auto-selects for a single factor
    setErrorMessage('');
    startChallenge.mutate(
      { attemptToken: pending.attemptToken, factorType },
      {
        onSuccess: (data) => setChallengeId(data.challengeId),
        onError: (err: Error) => setErrorMessage(apiErrorMessage(err, 'Failed to start challenge')),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, factorType]);

  const factorOptions = useMemo(() => pending?.availableFactors ?? [], [pending]);

  const onSubmit = handleSubmit(({ code, rememberDevice }) => {
    if (!pending || !challengeId) return;
    setErrorMessage('');
    verifyChallenge.mutate(
      { attemptToken: pending.attemptToken, challengeId, code, rememberDevice },
      {
        onSuccess: async () => {
          // Proof emitted server-side. Now retry sign-in with stored creds.
          setCompleting(true);
          const looksLikeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(pending.identifier);
          const res = looksLikeEmail
            ? await authClient.signIn.email({
                email: pending.identifier,
                password: pending.password,
              })
            : await authClient.signIn.username({
                username: pending.identifier,
                password: pending.password,
              });
          // Clear creds regardless of outcome.
          sessionStorage.removeItem(MFA_PENDING_KEY);
          if (res.error) {
            setCompleting(false);
            setErrorMessage(res.error.message ?? 'Failed to complete sign-in');
            return;
          }
          const sessionData = res.data as { activation_required?: boolean } | null | undefined;
          if (sessionData?.activation_required) {
            router.replace(RouteUrls.auth.activate);
            return;
          }
          toast.success('Signed in successfully.');
          // MFA-verify response carries no `role` (customSession injects it
          // only on getSession calls). /dashboard is a placeholder the proxy
          // rewrites to the role-specific dashboard using the fresh session.
          router.replace(safeCallbackUrl(pending.callbackUrl ?? null) ?? RouteUrls.dashboard.index);
        },
        onError: (err: Error) => {
          resetField('code');
          setErrorMessage(apiErrorMessage(err, 'Verification failed. Try again.'));
        },
      },
    );
  });

  const handleCancel = () => {
    sessionStorage.removeItem(MFA_PENDING_KEY);
    router.replace(RouteUrls.auth.signin);
  };

  if (!pending) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <CircularProgress />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Box
        className="flex w-full max-w-md flex-col items-center gap-6 rounded-lg p-8"
        sx={{ backgroundColor: 'background.paper' }}
      >
        <AppLogo size={32} />

        <Typography
          variant="h5"
          sx={{
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          Verify it&apos;s you
        </Typography>

        <Typography
          variant="body2"
          sx={{
            color: 'text.secondary',
            textAlign: 'center',
          }}
        >
          Multi-factor authentication is required to complete sign-in.
        </Typography>

        {factorOptions.length > 1 && !challengeId && (
          <FormControl fullWidth error={!!errors.factorType}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Choose a verification method
            </Typography>
            <RadioGroup
              value={factorType ?? ''}
              onChange={(e) =>
                setValue('factorType', e.target.value as MfaFactorTypeEnum, {
                  shouldValidate: false,
                })
              }
            >
              {factorOptions.map((f) => (
                <FormControlLabel
                  key={f}
                  value={f}
                  control={<Radio />}
                  label={FACTOR_LABEL[f] ?? f}
                />
              ))}
            </RadioGroup>
            {errors.factorType?.message && (
              <Typography variant="caption" color="error">
                {errors.factorType.message}
              </Typography>
            )}
          </FormControl>
        )}

        {factorType && !challengeId && (
          <Box className="flex items-center gap-2">
            <CircularProgress size={20} />
            <Typography variant="body2">
              {factorType === MfaFactorTypeEnum.EMAIL_OTP
                ? 'Sending a code to your email…'
                : 'Preparing challenge…'}
            </Typography>
          </Box>
        )}

        {challengeId && (
          <form onSubmit={onSubmit} className="flex w-full flex-col gap-4">
            <Typography variant="body2">
              {factorType === MfaFactorTypeEnum.EMAIL_OTP
                ? 'Enter the 6-digit code we just emailed you.'
                : 'Open your authenticator app and enter the current 6-digit code.'}
            </Typography>
            <TextField
              autoFocus
              fullWidth
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
              disabled={verifyChallenge.isPending || completing}
            />
            <FormControlLabel
              control={
                <Checkbox
                  {...register('rememberDevice')}
                  disabled={verifyChallenge.isPending || completing}
                />
              }
              label="Remember this device for 30 days"
            />
            <Typography variant="caption" color="text.secondary">
              You will still be asked to confirm your identity for sensitive actions.
            </Typography>
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={verifyChallenge.isPending || completing}
            >
              {completing ? 'Signing in…' : 'Verify'}
            </Button>
          </form>
        )}

        {errorMessage && (
          <Alert severity="error" sx={{ width: '100%' }}>
            {errorMessage}
          </Alert>
        )}

        <Button onClick={handleCancel} variant="text" size="small">
          Cancel and return to sign-in
        </Button>
      </Box>
    </main>
  );
}
