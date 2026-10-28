'use client';

import { Box, Button, CircularProgress, Divider, Link, Typography } from '@mui/material';

import AppLogo from '@/components/common/logo/AppLogo';
import AuthTrafficPanel from '@/components/auth/AuthTrafficPanel';
import NextLink from 'next/link';
import { RouteUrls } from '@/lib/routes/route.config';
import SignupDisabledNotice from '@/components/auth/SignupDisabledNotice';
import SignupForm from '@/components/auth/SignupForm';
import { SignupRequest } from '@/lib/dtos/request/auth.req';
import { authClient } from '@/lib/auth-client';
import toast from 'react-hot-toast';
import useAuthAction from '@/hooks/actions/useAuthAction';
import useSystemSettingsAction from '@/hooks/actions/useSystemSettingsAction';
import { useRouter } from 'next/navigation';
import { BrandMarks } from '@/lib/icons';

function SignupPage() {
  const router = useRouter();
  const { signupMutation } = useAuthAction();
  const { usePublicSettingsQuery } = useSystemSettingsAction();
  const publicSettings = usePublicSettingsQuery();

  // Only an explicit `false` closes the page. Loading, a failed read and a
  // missing field all fall through to the form: `/system-settings/public` is
  // unauthenticated cover only — `POST /api/auth/sign-up/email` refuses with
  // `SIGNUP_DISABLED` whatever is rendered here, so showing the form when the
  // read fails cannot create an account. The Google button is hidden with the
  // form purely so the closed page reads coherently; the backend gates email
  // sign-up only (see `isSignUpEnabled` in the backend's better-auth.ts).
  const signupDisabled = publicSettings.data?.signupEnabled === false;

  const onSignup = (data: SignupRequest) => {
    signupMutation.mutate(data, {
      onSuccess: () => {
        toast.success('Account created successfully.');
        // Sign-up response carries no `role` (customSession injects it only on
        // getSession calls), so computing the destination here would hit
        // defaultRedirectForPermissions(undefined) → /not-found. /dashboard is
        // a placeholder the proxy rewrites to the role-specific dashboard.
        router.replace(RouteUrls.dashboard.index);
      },
    });
  };

  const onGoogleSignin = () => {
    // OAuth callback has no client-side role context. Use /dashboard as a
    // placeholder — the proxy redirects to the role-specific dashboard once
    // the session cookie is set.
    authClient.signIn.social({ provider: 'google', callbackURL: RouteUrls.dashboard.index });
  };

  return (
    <main className="flex">
      <Box
        className="hidden min-h-screen flex-1 items-center justify-center p-8 lg:flex"
        sx={{
          backgroundColor: 'background.secondary',
        }}
      >
        <AuthTrafficPanel
          title="See your cases, pay online or ask for a review."
          points={[
            "Register with the email on your vehicle's registration",
            'Tickets arrive by email with the photo evidence',
            'Pay by card, bKash, Nagad or Rocket; the invoice is emailed',
          ]}
        />
      </Box>
      <section className="flex min-h-screen flex-1 flex-col items-center justify-center gap-10 px-6">
        <AppLogo size={35} />

        <Typography
          variant="h4"
          sx={{
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          {/* Names the action, not the failure — it also matches the "Request
              access" button `SignupDisabledNotice` renders directly below, so the
              page reads as one instruction instead of a refusal plus an
              unrelated button. */}
          {signupDisabled ? 'Request access' : 'Hello New User!'}
        </Typography>

        <div className="flex w-full flex-col gap-5 md:w-4/6">
          {publicSettings.isLoading ? (
            <div className="flex justify-center py-6">
              <CircularProgress />
            </div>
          ) : signupDisabled ? (
            <SignupDisabledNotice />
          ) : (
            <>
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

              {/* `isSuccess` as well as `isPending`: `router.replace` is not
                  instant, and without it the form is live again the moment the
                  response lands. */}
              <SignupForm
                onSubmit={onSignup}
                pending={signupMutation.isPending || signupMutation.isSuccess}
              />
            </>
          )}

          <Typography
            sx={{
              textAlign: 'center',
            }}
          >
            Already have an account?{' '}
            <Link
              component={NextLink}
              href={RouteUrls.auth.signin}
              sx={{
                fontWeight: 600,
              }}
            >
              Sign In
            </Link>
          </Typography>
        </div>
      </section>
    </main>
  );
}

export default SignupPage;
