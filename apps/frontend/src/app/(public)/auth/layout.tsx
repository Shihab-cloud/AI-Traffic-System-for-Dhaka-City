'use client';

import { RouteUrls, defaultRedirectForPermissions } from '@/lib/routes/route.config';
import { useSession } from '@/lib/auth-client';
import { Suspense, useLayoutEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { safeCallbackUrl } from '@/lib/utils/url.util';

type AuthLayoutProps = {
  children: React.ReactNode;
};

// Auth pages that authenticated users may legitimately visit:
//   /auth/mfa-setup     — destination of the enrollment_required redirect
//   /auth/mfa-challenge — bridges credential verification and AAL2 session creation
//   /auth/activate      — destination of the activation_required redirect (the
//                         server-side proxy sends magic-link / temp-password
//                         users here; this guard must NOT bounce them away)
const AUTH_PATHS_FOR_AUTHENTICATED_USERS = [
  RouteUrls.auth.mfaSetup,
  RouteUrls.auth.mfaChallenge,
  RouteUrls.auth.activate,
  RouteUrls.auth.emailVerified,
  RouteUrls.auth.accountTerminated,
];

function AuthRedirectGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { data: session } = useSession();

  useLayoutEffect(() => {
    if (!session) return;
    if (session.user?.status === 'PASSWORD_MISSING') return;
    if (AUTH_PATHS_FOR_AUTHENTICATED_USERS.some((p) => pathname?.startsWith(p))) return;

    const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'));
    const permissions = session.user.role?.permissions;
    router.replace(callbackUrl || defaultRedirectForPermissions(permissions));
  }, [router, searchParams, session, pathname]);

  return children;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <Suspense>
      <AuthRedirectGuard>{children}</AuthRedirectGuard>
    </Suspense>
  );
}
