import { PermissionsEnum } from '@/lib/enums/permission.enum';

export type RoleResponse = BaseResponse & {
  name: string;
  description?: string;
  permissions: PermissionsEnum[];
  isDefault: boolean;
  rank: number;
};
