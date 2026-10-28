import { PermissionsEnum } from '@/lib/enums/permission.enum';
import { RoleNameEnum } from '@/lib/enums/role-name.enum';

export const ROUTE_AUDIENCE_PERMISSION: Record<RoleNameEnum, PermissionsEnum> = {
  [RoleNameEnum.USER]: PermissionsEnum.USER,
  [RoleNameEnum.ADMIN]: PermissionsEnum.ADMIN,
  [RoleNameEnum.TRAFFIC_OFFICER]: PermissionsEnum.TRAFFIC_OFFICER,
};
