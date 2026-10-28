import { SetMetadata } from '@nestjs/common';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';

export const PERMISSION_KEY = 'permission';

export interface PermissionMetadata {
  permissions: PermissionsEnum[];
  requiredAll?: boolean;
}

/**
 * Decorator to specify required permissions for a route handler or controller.
 * Attaches metadata for permission checks at runtime.
 *
 * @param permissions - List of permissions to check. The user must have these permissions as dictated by `requiredAll`.
 * @param requiredAll - Optional. If `true`, the user must have **all** listed permissions (logical AND).
 *                      If `false` (default), the user must have at least **one** of the listed permissions (logical OR).
 *
 * @example
 * // User needs at least one of the listed permissions:
 * @Permissions({ permissions: [PermissionsEnum.VIEW_USERS, PermissionsEnum.MANAGE_USERS] })
 *
 * @example
 * // User must have every listed permission:
 * @Permissions({ permissions: [PermissionsEnum.VIEW_USERS, PermissionsEnum.MANAGE_USERS], requiredAll: true })
 */
export const Permissions = ({ permissions, requiredAll = false }: PermissionMetadata) => {
  return SetMetadata(PERMISSION_KEY, { permissions, requiredAll });
};
