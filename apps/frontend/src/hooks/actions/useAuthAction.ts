'use client';

import { ActivateAccountRequest } from '@/lib/dtos/request/activate.req';
import { ResetPasswordRequest, SigninRequest, SignupRequest } from '@/lib/dtos/request/auth.req';

import { APIUrl } from '@/lib/constants/url.config';
import { RouteUrls } from '@/lib/routes/route.config';
import { authClient } from '@/lib/auth-client';
import httpClient from '@/lib/utils/httpClient';
import { MfaFactorTypeEnum } from '@/lib/enums/mfa.enum';
import notificationService from '@/lib/services/notification.service';
import { SignInRequiresEnrollmentError, SignInRequiresMfaError } from '@/lib/types/mfa.types';
import toast from 'react-hot-toast';
import { useMutation } from '@tanstack/react-query';

export default function useAuthAction() {
  const signinMutation = useMutation({
    mutationFn: async (data: SigninRequest) => {
      const looksLikeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.identifier);
      const res = looksLikeEmail
        ? await authClient.signIn.email({
            email: data.identifier,
            password: data.password,
          })
        : await authClient.signIn.username({
            username: data.identifier,
            password: data.password,
          });

      if (res.error) {
        // Better Auth surfaces APIError body fields on res.error. Detect our
        // custom MFA codes and rethrow as structured errors so the caller can
        // route appropriately.
        const code = res.error.code ?? res.error.message;
        const body = res.error as unknown as {
          mfa?: { attemptToken?: string; availableFactors?: MfaFactorTypeEnum[] };
        };
        if (code === 'MFA_REQUIRED' && body.mfa?.attemptToken) {
          throw new SignInRequiresMfaError(body.mfa.attemptToken, body.mfa.availableFactors ?? []);
        }
        if (code === 'MFA_ENROLL_REQUIRED') {
          throw new SignInRequiresEnrollmentError();
        }
        throw new Error(res.error.message ?? 'Invalid credentials.');
      }

      return res.data;
    },
    onError: (error: Error) => {
      // MFA-required errors are routed by the page-level onError handler; do
      // not surface a toast for them here.
      if (
        error instanceof SignInRequiresMfaError ||
        error instanceof SignInRequiresEnrollmentError
      ) {
        return;
      }
      if (error.message.toLowerCase().includes('account_banned')) {
        window.location.href = RouteUrls.auth.accountBanned;
      } else {
        toast.error(error.message || 'Sign in failed.');
      }
    },
  });

  const signupMutation = useMutation({
    mutationFn: async (data: SignupRequest) => {
      const res = await authClient.signUp.email({
        email: data.email,
        password: data.password,
        name: `${data.firstName} ${data.lastName}`,
        firstName: data.firstName,
        lastName: data.lastName,
      });

      if (res.error) throw new Error(res.error.message ?? 'Sign up failed.');

      return res.data;
    },
  });

  const signoutMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem('fcm-token');
      if (token) {
        await notificationService.unregisterDeviceToken(token).catch(() => {});
      }

      const res = await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            // Clear FCM token cache so the next user always re-registers
            localStorage.removeItem('fcm-token');
            // Hard navigate immediately — before Better Auth's session signal
            // update triggers React re-renders and RSC refetches that would
            // cause the middleware to redirect with a callbackUrl param.
            window.location.href = RouteUrls.auth.signin;
          },
        },
      });

      if (res.error) throw new Error(res.error.message ?? 'Sign out failed.');

      return res.data;
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (data: ResetPasswordRequest) => {
      const res = await authClient.resetPassword({
        newPassword: data.newPassword,
        token: data.token,
      });

      if (res.error) throw new Error(res.error.message ?? 'Password reset failed.');

      return res.data;
    },
  });

  const forgotPasswordMutation = useMutation({
    mutationFn: async (data: { email: string }) => {
      const res = await authClient.requestPasswordReset({
        email: data.email,
        redirectTo: RouteUrls.auth.resetPassword,
      });
      if (res.error) throw new Error(res.error.message ?? 'Failed to send reset email.');
      return res.data;
    },
  });

  const activateAccountMutation = useMutation({
    mutationFn: async (data: ActivateAccountRequest) => {
      const res = await httpClient.post(APIUrl.account.activate(), data);
      return res.data as { ok: true };
    },
  });

  const resendEmailVerificationMutation = useMutation({
    mutationFn: async () => {
      const res = await httpClient.post(APIUrl.account.resendEmailVerification());
      return res.data as { ok: true };
    },
  });

  return {
    signinMutation,
    signupMutation,
    signoutMutation,
    resetPasswordMutation,
    forgotPasswordMutation,
    activateAccountMutation,
    resendEmailVerificationMutation,
  };
}
