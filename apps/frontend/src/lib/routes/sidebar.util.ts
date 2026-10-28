import type { PermissionsEnum } from '@/lib/enums/permission.enum';
import type { SidebarGroup } from '@/lib/routes/index.routes';

/**
 * Plain any-of overlap — the same rule `useHasPermission` and every
 * `PermissionLayout` apply. An absent or empty requirement is open to everyone.
 */
export function hasAnyPermission(
  required: PermissionsEnum[] | undefined,
  held: readonly PermissionsEnum[],
): boolean {
  if (!required || required.length === 0) return true;
  return required.some((permission) => held.includes(permission));
}

/**
 * Narrows the sidebar to exactly the pages the holder can actually open.
 *
 * Both levels — group and item — use {@link hasAnyPermission}. The previous
 * implementation had an audience-marker special case at the group level: a
 * holder of `ADMIN` or `USER` saw a group only if the group's own `permissions`
 * array named that marker. That made granular permissions unusable in the
 * sidebar — a group gated on a granular permission was hidden from an admin
 * (the group lacked `ADMIN`) and from everyone else (the marker rule).
 *
 * A group with no `permissions` of its own lives or dies by its items: it
 * renders exactly when at least one item survives.
 */
export function filterSidebarGroups(
  groups: readonly SidebarGroup[],
  held: readonly PermissionsEnum[],
): SidebarGroup[] {
  return groups
    .filter((group) => hasAnyPermission(group.permissions, held))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => hasAnyPermission(item.permissions, held)),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * React key for a rendered sidebar group.
 *
 * `header` is optional (a landing group is a link, not a category), so keying on
 * it alone collides as soon as two groups omit it. Header first where there is
 * one: that identity survives permission filtering changing which item sorts
 * first, so the group is not remounted.
 */
export function sidebarGroupKey(group: SidebarGroup): string {
  return group.header ?? group.items[0]?.link ?? '';
}
