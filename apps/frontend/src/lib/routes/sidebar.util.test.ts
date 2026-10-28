import { describe, expect, it } from 'vitest';

import { PermissionsEnum } from '@/lib/enums/permission.enum';
import type { SidebarGroup } from '@/lib/routes/index.routes';

import { filterSidebarGroups, hasAnyPermission, sidebarGroupKey } from './sidebar.util';

// `icon` is only rendered, never read by the filter, so a stub keeps this suite
// free of `react-icons` (and of a DOM) in the node environment.
const icon = (() => null) as unknown as SidebarGroup['items'][number]['icon'];

const groups: SidebarGroup[] = [
  {
    header: 'Admin',
    permissions: [PermissionsEnum.ADMIN],
    items: [{ link: '/admin/faq', text: 'FAQ', icon }],
  },
  {
    header: 'Support',
    items: [
      {
        link: '/admin/support',
        text: 'Support Tickets',
        icon,
        permissions: [PermissionsEnum.READ_SUPPORT_TICKET],
      },
      { link: '/profile', text: 'Profile', icon },
    ],
  },
  {
    header: 'Granular',
    permissions: [PermissionsEnum.BROADCAST_NOTIFICATION],
    items: [{ link: '/notifications/compose', text: 'Composer', icon }],
  },
];

describe('hasAnyPermission', () => {
  it('treats an absent or empty requirement as open to everyone', () => {
    expect(hasAnyPermission(undefined, [])).toBe(true);
    expect(hasAnyPermission([], [])).toBe(true);
  });

  it('is a plain any-of overlap', () => {
    expect(hasAnyPermission([PermissionsEnum.ADMIN], [PermissionsEnum.ADMIN])).toBe(true);
    expect(
      hasAnyPermission(
        [PermissionsEnum.ADMIN, PermissionsEnum.MANAGE_FAQ],
        [PermissionsEnum.MANAGE_FAQ],
      ),
    ).toBe(true);
    expect(hasAnyPermission([PermissionsEnum.ADMIN], [PermissionsEnum.USER])).toBe(false);
  });
});

describe('filterSidebarGroups', () => {
  it('shows an admin every ADMIN-gated group', () => {
    const result = filterSidebarGroups(groups, [PermissionsEnum.ADMIN]);
    expect(result.map((g) => g.header)).toEqual(['Admin', 'Support']);
    // The ungated Profile item survives; the ticket item does not.
    expect(result[1].items.map((i) => i.link)).toEqual(['/profile']);
  });

  it('shows a granular-permission group to a holder who has no audience marker', () => {
    // The old marker rule hid this from an admin (group lacks ADMIN) and from
    // everyone else (marker rule) — i.e. from everybody.
    const result = filterSidebarGroups(groups, [PermissionsEnum.BROADCAST_NOTIFICATION]);
    expect(result.map((g) => g.header)).toEqual(['Support', 'Granular']);
  });

  it('shows a granular-permission group to an admin who also holds it', () => {
    const result = filterSidebarGroups(groups, [
      PermissionsEnum.ADMIN,
      PermissionsEnum.BROADCAST_NOTIFICATION,
    ]);
    expect(result.map((g) => g.header)).toEqual(['Admin', 'Support', 'Granular']);
  });

  it('drops a group whose every item was filtered out', () => {
    const result = filterSidebarGroups(
      [
        {
          header: 'Empty',
          items: [{ link: '/x', text: 'X', icon, permissions: [PermissionsEnum.ADMIN] }],
        },
      ],
      [PermissionsEnum.USER],
    );
    expect(result).toEqual([]);
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(groups.map((g) => g.items.length));
    filterSidebarGroups(groups, [PermissionsEnum.USER]);
    expect(JSON.stringify(groups.map((g) => g.items.length))).toBe(before);
  });
});

describe('sidebarGroupKey', () => {
  it('prefers the header', () => {
    expect(sidebarGroupKey({ header: 'Admin', items: [{ link: '/a', text: 'A', icon }] })).toBe(
      'Admin',
    );
  });

  it('falls back to the first item link for a headerless group', () => {
    expect(sidebarGroupKey({ items: [{ link: '/dashboard', text: 'D', icon }] })).toBe(
      '/dashboard',
    );
  });

  it('never returns undefined for an empty headerless group', () => {
    expect(sidebarGroupKey({ items: [] })).toBe('');
  });
});
