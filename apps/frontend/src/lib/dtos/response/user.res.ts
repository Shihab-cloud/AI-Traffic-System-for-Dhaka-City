import { RoleResponse } from './role.res';
import { UserStatusEnum } from '@/lib/enums/status.enum';

export interface UserResponse extends BaseResponse {
  fullName: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  username?: string | null;
  displayUsername?: string | null;
  image?: string;
  phone?: string;
  status: UserStatusEnum;
  role: RoleResponse;
  mfaEnabled?: boolean;
}

export interface TempPasswordResponse {
  tempPassword: string;
}
