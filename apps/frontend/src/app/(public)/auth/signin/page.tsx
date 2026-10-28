'use client';

import { Box, Button, Divider, Link, Typography } from '@mui/material';
import { useRouter, useSearchParams } from 'next/navigation';

import AppLogo from '@/components/common/logo/AppLogo';
import AuthTrafficPanel from '@/components/auth/AuthTrafficPanel';
import NextLink from 'next/link';
import { RouteUrls } from '@/lib/routes/route.config';
import SigninForm from '@/components/auth/SigninForm';
import { SigninRequest } from '@/lib/dtos/request/auth.req';
import { authClient } from '@/lib/auth-client';
import { safeCallbackUrl } from '@/lib/utils/url.util';
import {
  type MfaPendingLogin,
  SignInRequiresEnrollmentError,
  SignInRequiresMfaError,
} from '@/lib/types/mfa.types';
import toast from 'react-hot-toast';
import useAuthAction from '@/hooks/actions/useAuthAction';
import useSystemSettingsAction from '@/hooks/actions/useSystemSettingsAction';
import { BrandMarks } from '@/lib/icons';

const MFA_PENDING_KEY = 'mfa_pending';

function SigninPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'));

  const { signinMutation } = useAuthAction();
  const { usePublicSettingsQuery } = useSystemSettingsAction();
  const publicSettings = usePublicSettingsQuery();

  const onSignin = async (data: SigninRequest) => {
    signinMutation.mutate(data, {
      onSuccess: (res) => {
        toast.success('Signed in successfully.');
        // Activation gate: admin-provisioned users land on /auth/activate first.
        // The backend marks the session with `activation_required: true`; we
        // read it off the response and bypass `redirectTo` until the user
        // completes activation.
        const sessionData = res as { activation_required?: boolean } | null | undefined;
        if (sessionData?.activation_required) {
          router.replace(RouteUrls.auth.activate);
          return;
        }
        // Defer role-based routing to the proxy: the sign-in response does NOT
        // include `role` (that field is injected by customSession, which only
        // runs on getSession calls). Computing the destination here would hit
        // defaultRedirectForPermissions(undefined) → /not-found. /dashboard is
        // a placeholder the proxy intercepts and rewrites to the user's role
        // dashboard using the freshly-issued session — same pattern as the
        // Google sign-in path below.
        router.replace(callbackUrl || RouteUrls.dashboard.index);
      },
      onError: (error) => {
        if (error instanceof SignInRequiresMfaError) {
          // Stash credentials briefly so /auth/mfa-challenge can re-submit
          // sign-in after the proof key is emitted. sessionStorage is per-tab
          // and cleared on tab close — see plan for security trade-off.
          const pending: MfaPendingLogin = {
            identifier: data.identifier,
            password: data.password,
            attemptToken: error.attemptToken,
            availableFactors: error.availableFactors,
            callbackUrl: callbackUrl ?? undefined,
          };
          sessionStorage.setItem(MFA_PENDING_KEY, JSON.stringify(pending));
          router.push(RouteUrls.auth.mfaChallenge);
          return;
        }
        if (error instanceof SignInRequiresEnrollmentError) {
          toast.error(
            'Multi-factor authentication is required. Contact your administrator to enable MFA on your account.',
          );
          return;
        }
        // Other errors handled by the mutation's own onError (toast/redirect).
      },
    });
  };

  const onGoogleSignin = () => {
    // Better Auth navigates to callbackURL after Google completes. Use /dashboard
    // as the placeholder destination — the server-side proxy intercepts this
    // path and redirects to the role-specific dashboard once the session cookie
    // is set. We can't read the role here (no session yet), so we delegate to
    // the proxy as the single source of truth.
    authClient.signIn.social({
      provider: 'google',
      callbackURL: callbackUrl || RouteUrls.dashboard.index,
    });
  };

  return (
    <main className="flex">
      <section className="flex min-h-screen flex-1 flex-col items-center justify-center gap-10 px-6">
        <AppLogo size={35} />

        <Typography
          variant="h4"
          sx={{
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          Hello! Welcome Back.
        </Typography>

        <div className="flex w-full flex-col gap-5 md:w-4/6">
          <Button
            variant="outlined"
            size="large"
            color="ghost"
            fullWidth
            startIcon={<BrandMarks.google />}
            onClick={onGoogleSignin}
          >
            Continue with Google
          </Button>

          <Divider>OR</Divider>

          {/* `isSuccess` as well as `isPending`: `router.replace` is not instant,
              and without it the form is live again the moment the response lands. */}
          <SigninForm
            onSubmit={onSignin}
            pending={signinMutation.isPending || signinMutation.isSuccess}
          />

          {/* Hidden only on an explicit `false`; loading/error keep the link (fail-open). */}
          {publicSettings.data?.signupEnabled !== false && (
            <Typography
              sx={{
                textAlign: 'center',
              }}
            >
              Don&apos;t have an account?{' '}
              <Link
                component={NextLink}
                href={RouteUrls.auth.signup}
                sx={{
                  fontWeight: 600,
                }}
              >
                Sign Up
              </Link>
            </Typography>
          )}
        </div>
      </section>
      <Box
        className="hidden min-h-screen flex-[1.5] items-center justify-center p-8 lg:flex"
        sx={{
          backgroundColor: 'background.secondary',
        }}
      >
        <AuthTrafficPanel
          title="Every case is checked by an officer before a ticket is sent."
          points={[
            'Photos of the vehicle, the time, the place and what was measured',
            'Pay online by card, bKash, Nagad or Rocket',
            'Disagree? Apply for a review from your case',
          ]}
        />
      </Box>
    </main>
  );
}

export default SigninPage;
