'use client';

import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

import AppLogo from '@/components/common/logo/AppLogo';
import EmailOtpEnrollFlow from '@/components/auth/EmailOtpEnrollFlow';
import useSystemSettingsAction from '@/hooks/actions/useSystemSettingsAction';
import { useSession } from '@/lib/auth-client';
import { MfaSetupMode } from '@/lib/enums/mfa.enum';
import { PermissionsEnum } from '@/lib/enums/permission.enum';
import { defaultRedirectForPermissions } from '@/lib/routes/route.config';
import mfaService from '@/lib/services/mfa.service';
import TotpEnrollFlow from '@/components/auth/TotpEnrollFlow';

/**
 * Forced-enrollment flow for mandatory-MFA users in the grace window. Also
 * reachable from settings as the opt-in entry point.
 *
 * Placed under /(public)/ so the proxy middleware doesn't re-redirect a user
 * whose JWT carries `enrollment_required`. The page itself is JWT-aware (it
 * calls /api/mfa/enroll which requires the bearer token).
 */
export default function MfaSetupPage() {
  const [mode, setMode] = useState<MfaSetupMode>(MfaSetupMode.PICK);
  const [skipping, setSkipping] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  const { data: session } = useSession();
  const { usePublicSettingsQuery } = useSystemSettingsAction();
  const settingsQuery = usePublicSettingsQuery();

  const mfaEnabled = settingsQuery.data?.mfaEnabled;

  // Hard navigate (not router.replace) so the FE drops its cached JWT and
  // forces a fresh `customSession` read — without this the stale
  // session.enrollment_required flag would bounce the user back here.
  const goToDashboard = () => {
    const permissions = (
      session?.user as { role?: { permissions?: PermissionsEnum[] } } | undefined
    )?.role?.permissions;
    window.location.href = defaultRedirectForPermissions(permissions);
  };

  // MFA is off instance-wide — the setup entry is not a valid destination.
  useEffect(() => {
    if (settingsQuery.isSuccess && !mfaEnabled) {
      goToDashboard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- goToDashboard reads session at call time; re-running on its identity would loop the hard navigation
  }, [settingsQuery.isSuccess, mfaEnabled]);

  const handleSkip = async () => {
    setSkipping(true);
    setSkipError(null);
    try {
      await mfaService.postpone();
      goToDashboard();
    } catch (e) {
      setSkipping(false);
      setSkipError(e instanceof Error ? e.message : 'Failed to skip — please try again.');
    }
  };

  // Don't flash the setup screen before flags resolve or when MFA is disabled.
  if (settingsQuery.isLoading || !mfaEnabled) return null;

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <Box className="flex w-full max-w-2xl flex-col gap-6">
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <AppLogo size={32} />
          <Typography
            variant="h4"
            sx={{
              fontWeight: 600,
              textAlign: 'center',
            }}
          >
            Secure your account
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
              textAlign: 'center',
            }}
          >
            Multi-factor authentication is required for your role. Pick how you want to verify
            sign-ins from now on.
          </Typography>
        </Stack>

        {mode === MfaSetupMode.PICK && (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Typography variant="h6">Choose a verification method</Typography>
              <Stack spacing={1}>
                <Button variant="contained" size="large" onClick={() => setMode(MfaSetupMode.TOTP)}>
                  Use an authenticator app (TOTP)
                </Button>
                <Typography variant="caption" color="text.secondary" sx={{ pl: 1 }}>
                  Scan a QR with Google Authenticator, Authy, 1Password, etc. Strongest option.
                  Works offline.
                </Typography>
              </Stack>
              <Stack spacing={1}>
                <Button
                  variant="outlined"
                  size="large"
                  onClick={() => setMode(MfaSetupMode.EMAIL_OTP)}
                >
                  Email me a code
                </Button>
                <Typography variant="caption" color="text.secondary" sx={{ pl: 1 }}>
                  A 6-digit code is sent to your account email at sign-in. Easy setup, but only as
                  secure as your inbox.
                </Typography>
              </Stack>
              <Stack spacing={0.5} sx={{ alignItems: 'center', pt: 1 }}>
                <Button
                  variant="text"
                  size="small"
                  onClick={handleSkip}
                  disabled={skipping}
                  sx={{ textTransform: 'none' }}
                >
                  {skipping ? 'Skipping…' : 'Skip for now'}
                </Button>
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                    textAlign: 'center',
                  }}
                >
                  We&apos;ll ask again next time you sign in.
                </Typography>
                {skipError && (
                  <Typography
                    variant="caption"
                    sx={{
                      color: 'error.main',
                      textAlign: 'center',
                    }}
                  >
                    {skipError}
                  </Typography>
                )}
              </Stack>
            </Stack>
          </Paper>
        )}

        {mode === MfaSetupMode.TOTP && (
          <Stack spacing={2}>
            <TotpEnrollFlow finishLabel="Go to dashboard" onCompleted={goToDashboard} />
            <Button onClick={() => setMode(MfaSetupMode.PICK)} variant="text">
              Use a different method
            </Button>
          </Stack>
        )}

        {mode === MfaSetupMode.EMAIL_OTP && (
          <Stack spacing={2}>
            <EmailOtpEnrollFlow finishLabel="Go to dashboard" onCompleted={goToDashboard} />
            <Button onClick={() => setMode(MfaSetupMode.PICK)} variant="text">
              Use a different method
            </Button>
          </Stack>
        )}
      </Box>
    </main>
  );
}
