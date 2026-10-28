'use client';

import PermissionLayout from '@/components/common/layout/PermissionLayout';
import { PermissionsEnum } from '@/lib/enums/permission.enum';

export default function NotificationsComposeLayout({ children }: { children: React.ReactNode }) {
  return (
    <PermissionLayout allowedPermissions={[PermissionsEnum.BROADCAST_NOTIFICATION]}>
      {children}
    </PermissionLayout>
  );
}
