'use client';

import { Box } from '@mui/material';

import NotificationPreferencesPage from '@/components/common/notification/NotificationPreferencesPage';
import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import { CHANNELS_BY_ROLE } from '@/lib/enum-config/notification-channels-config';
import { RoleNameEnum } from '@/lib/enums/role-name.enum';
import { useSession } from '@/lib/auth-client';
import { Icons } from '@/lib/icons';

export default function NotificationsSettingsPage() {
  const { data: session } = useSession();
  const rawRole = session?.user?.role?.name as RoleNameEnum | undefined;
  const role: RoleNameEnum = rawRole && rawRole in CHANNELS_BY_ROLE ? rawRole : RoleNameEnum.USER;

  return (
    <>
      <PageHeader
        title="Notification Settings"
        subtitle="Choose how you receive alerts and updates"
        icon={Icons.notificationPreferences}
      />
      <PageBody>
        <NotificationPreferencesPage role={role} />
      </PageBody>
    </>
  );
}
