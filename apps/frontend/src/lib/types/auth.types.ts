import { PermissionsEnum } from '@/lib/enums/permission.enum';
import { UseSessionType } from '../auth-client';
import { RoleNameEnum } from '../enums/role-name.enum';

export interface SessionRole {
  id: string;
  // Although DB has name:text, but we're using RoleNameEnum to handle enums in BE, not in DB.
  name: RoleNameEnum;
  description: string | null;
  permissions: PermissionsEnum[];
  isDefault: boolean;
  rank: number;
  createdAt: string;
  updatedAt: string;
}

// Session data shape with `user.role` narrowed from Record<string, any> (json)
// to SessionRole. Reused by proxy.ts via its own client (same plugins → same
// inferred data shape).
type ClientSession = NonNullable<ReturnType<UseSessionType>['data']>;
export type TypedSessionData = Omit<ClientSession, 'user'> & {
  user: Omit<ClientSession['user'], 'role'> & { role: SessionRole | null };
};

export type WrappedSession = Omit<ReturnType<UseSessionType>, 'data'> & {
  data: TypedSessionData | null;
};
