'use client';

import { Box } from '@mui/material';

import NotificationInboxList from '@/components/common/notification/NotificationInboxList';
import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import { Icons } from '@/lib/icons';

export default function NotificationsPage() {
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="All your recent notifications in one place"
        icon={Icons.notifications}
        width="8xl"
      />
      <PageBody width="8xl">
        <NotificationInboxList />
      </PageBody>
    </>
  );
}
