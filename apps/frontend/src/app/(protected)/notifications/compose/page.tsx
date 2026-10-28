'use client';

import { Box } from '@mui/material';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import AnnouncementComposer from '@/components/common/notification/AnnouncementComposer';
import { Icons } from '@/lib/icons';

export default function NotificationsComposePage() {
  return (
    <>
      <PageHeader
        title="Send Announcement"
        subtitle="Send a platform-wide notification"
        icon={Icons.notificationComposer}
        width="8xl"
      />
      <PageBody width="8xl">
        <AnnouncementComposer />
      </PageBody>
    </>
  );
}
