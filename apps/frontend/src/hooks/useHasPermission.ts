'use client';

import { PermissionsEnum } from '@/lib/enums/permission.enum';
import { useSession } from '@/lib/auth-client';

/**
 * Checks whether the current user has the given permission(s).
 *
 * @param allowedPermissions - The permission(s) to check against the user's role.
 * @param requiredAll - When `true` the user must hold **every** listed permission.
 *   When `false` (default) holding **any one** of them is enough.
 * @returns `hasPermission` – boolean result, and `isPending` – true while the session is loading.
 */
export default function useHasPermission(
  allowedPermissions: PermissionsEnum[],
  requiredAll = false,
) {
  const { data: session, isPending } = useSession();
  const userPermissions = session?.user?.role?.permissions ?? [];

  const hasPermission = requiredAll
    ? allowedPermissions.every((p) => userPermissions.includes(p))
    : allowedPermissions.some((p) => userPermissions.includes(p));

  return { hasPermission, isPending };
}
