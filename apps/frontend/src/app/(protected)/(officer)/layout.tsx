import PermissionLayout from '@/components/common/layout/PermissionLayout';
import { ROUTE_AUDIENCE_PERMISSION } from '@/lib/constants/route-audience.config';
import { RoleNameEnum } from '@/lib/enums/role-name.enum';

export default function OfficerGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <PermissionLayout allowedPermissions={[ROUTE_AUDIENCE_PERMISSION[RoleNameEnum.TRAFFIC_OFFICER]]}>
      {children}
    </PermissionLayout>
  );
}
