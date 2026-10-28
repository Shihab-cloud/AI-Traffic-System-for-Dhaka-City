import { PermissionsConfig } from '@/lib/enum-config/permissions-config';
import { PermissionsEnum } from '@/lib/enums/permission.enum';

export interface PermissionGroup {
  resource: string;
  label: string;
  permissions: PermissionsEnum[];
}

export function permissionResource(permission: string): string {
  return permission.split(':')[1] ?? permission;
}

export function permissionActionLabel(permission: string): string {
  const action = permission.split(':')[0] ?? permission;
  return action.charAt(0) + action.slice(1).toLowerCase();
}

function resourceLabel(resource: string): string {
  return resource
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function groupPermissionsByResource(
  permissions: readonly PermissionsEnum[],
): PermissionGroup[] {
  const groups = new Map<string, PermissionGroup>();
  for (const permission of permissions) {
    const resource = permissionResource(permission);
    let group = groups.get(resource);
    if (!group) {
      group = { resource, label: resourceLabel(resource), permissions: [] };
      groups.set(resource, group);
    }
    group.permissions.push(permission);
  }
  return [...groups.values()];
}

/**
 * The human-readable "what this permission lets you do" line from
 * `PermissionsConfig`.
 *
 * Falls back to an empty string rather than throwing: roles are free-form rows
 * editable at runtime, so a role can still hold a permission string whose config
 * entry was removed. Callers render the description as secondary text, and no
 * secondary text is a better outcome than a crashed picker.
 */
export function permissionDescription(permission: string): string {
  return PermissionsConfig[permission as PermissionsEnum]?.description ?? '';
}

/**
 * Narrows grouped permissions to those matching a free-text query, searching the
 * group label, the action label and the description together.
 *
 * Lives here rather than inside the picker component so the search behaviour is
 * unit-testable without a React renderer. A blank query returns the *same array
 * reference*, so a picker can pass it straight into `useMemo` without allocating
 * on every keystroke that clears the box.
 */
export function filterPermissionGroups(
  groups: readonly PermissionGroup[],
  query: string,
): PermissionGroup[] {
  const term = query.trim().toLowerCase();
  if (!term) return groups as PermissionGroup[];

  return groups
    .map((group) => ({
      ...group,
      permissions: group.permissions.filter((permission) =>
        [group.label, permissionActionLabel(permission), permissionDescription(permission)]
          .join(' ')
          .toLowerCase()
          .includes(term),
      ),
    }))
    .filter((group) => group.permissions.length > 0);
}
