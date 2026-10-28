'use client';

import EmailVerificationBanner from '@/components/dashboard/EmailVerificationBanner';
import MfaEnrollmentBanner from '@/components/dashboard/MfaEnrollmentBanner';
import { useSession } from '@/lib/auth-client';
import { UserStatusEnum } from '@/lib/enums/status.enum';
import { SIDEBAR_GROUPS } from '@/lib/routes/index.routes';
import { RouteUrls } from '@/lib/routes/route.config';
import { useRouter } from 'next/navigation';
import { useLayoutEffect } from 'react';
import MainLayout from './MainLayout';

function DashBoardLayout({ children, drawerOpen = null }: { children: React.ReactNode; drawerOpen?: boolean | null }) {
  const { data } = useSession();
  const router = useRouter();

  const enrollmentRequired = (data?.session as unknown as { enrollment_required?: boolean })
    ?.enrollment_required;

  useLayoutEffect(() => {
    if (data?.user?.status === UserStatusEnum.PASSWORD_MISSING) {
      router.replace(RouteUrls.auth.changePassword);
      return;
    }
    // Client-side fallback for SPA navigations that bypass middleware.
    if (enrollmentRequired) {
      router.replace(RouteUrls.auth.mfaSetup);
    }
  }, [data?.user?.status, enrollmentRequired, router]);

  if (data?.user?.status === UserStatusEnum.PASSWORD_MISSING || enrollmentRequired) {
    return null;
  }

  return (
    <MainLayout sidebarItems={SIDEBAR_GROUPS} drawerOpen={drawerOpen}>
      <div className="flex flex-col gap-2 p-2.5">
        <MfaEnrollmentBanner />
        <EmailVerificationBanner />
      </div>
      {children}
    </MainLayout>
  );
}

export default DashBoardLayout;
