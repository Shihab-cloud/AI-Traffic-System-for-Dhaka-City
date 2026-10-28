import dynamic from 'next/dynamic';
import { cookies } from 'next/headers';

import StepUpProvider from '@/components/auth/StepUpProvider';
import { drawerCookieName, parseDrawerCookie } from '@/lib/drawer-cookie';

const DashBoardLayout = dynamic(
  () => import('@/components/common/navigation/drawerLayout/DashBoardLayout'),
  {
    ssr: true,
  },
);

export default async function Layout({ children }: { children: React.ReactNode }) {
  // The sidebar's remembered open/closed state, so the server renders it as the browser will.
  const drawerOpen = parseDrawerCookie((await cookies()).get(drawerCookieName('main'))?.value);
  return (
    <StepUpProvider>
      <DashBoardLayout drawerOpen={drawerOpen}>{children}</DashBoardLayout>
    </StepUpProvider>
  );
}
