import { describe, expect, it } from 'vitest';

import { PermissionsEnum } from '@/lib/enums/permission.enum';

import {
  filterPermissionGroups,
  groupPermissionsByResource,
  permissionActionLabel,
  permissionDescription,
  permissionResource,
  type PermissionGroup,
} from './permission.util';

describe('permission.util', () => {
  it('permissionResource extracts the resource segment', () => {
    expect(permissionResource(PermissionsEnum.CREATE_USER)).toBe('USER');
  });

  it('permissionActionLabel title-cases the action segment', () => {
    expect(permissionActionLabel(PermissionsEnum.CREATE_USER)).toBe('Create');
  });

  it('groupPermissionsByResource groups and preserves first-seen order', () => {
    const groups = groupPermissionsByResource([
      PermissionsEnum.CREATE_USER,
      PermissionsEnum.READ_ROLE,
      PermissionsEnum.DELETE_USER,
    ]);
    expect(groups.map((g) => g.resource)).toEqual(['USER', 'ROLE']);
    expect(groups[0].permissions).toEqual([
      PermissionsEnum.CREATE_USER,
      PermissionsEnum.DELETE_USER,
    ]);
  });
});

describe('permissionDescription', () => {
  it('returns the configured description for a known permission', () => {
    expect(permissionDescription(PermissionsEnum.READ_USER)).toContain('View user accounts');
  });

  it('returns an empty string for an unknown permission rather than throwing', () => {
    // Roles are free-form rows; a stale permission string can outlive its config entry.
    expect(permissionDescription('READ:NOT_A_RESOURCE')).toBe('');
  });
});

describe('filterPermissionGroups', () => {
  const groups = groupPermissionsByResource([
    PermissionsEnum.CREATE_USER,
    PermissionsEnum.READ_USER,
    PermissionsEnum.CREATE_ROLE,
  ]);

  it('returns the groups untouched for a blank query', () => {
    expect(filterPermissionGroups(groups, '')).toBe(groups);
    expect(filterPermissionGroups(groups, '   ')).toBe(groups);
  });

  it('matches across the label, the action and the description together', () => {
    // Substring matching is deliberate and spans all three fields, so `role` hits
    // the ROLE group's label *and* the USER rows whose descriptions mention roles.
    const result = filterPermissionGroups(groups, 'role');
    expect(result.map((g) => g.resource)).toEqual(['USER', 'ROLE']);
    expect(result[1].permissions).toEqual([PermissionsEnum.CREATE_ROLE]);
  });

  it('can match on the group label alone', () => {
    // Synthetic groups: these permission strings are not in `PermissionsConfig`,
    // so `permissionDescription` returns '' for them and only the label or the
    // action label can match — which is what makes this assertion exact.
    const synthetic: PermissionGroup[] = [
      { resource: 'ALPHA', label: 'Alpha', permissions: ['READ:ALPHA'] as unknown as never },
      { resource: 'BETA', label: 'Beta', permissions: ['READ:BETA'] as unknown as never },
    ];
    expect(filterPermissionGroups(synthetic, 'alpha').map((g) => g.resource)).toEqual(['ALPHA']);
    expect(filterPermissionGroups(synthetic, 'read').map((g) => g.resource)).toEqual([
      'ALPHA',
      'BETA',
    ]);
  });

  it('matches on the action label, case-insensitively', () => {
    const result = filterPermissionGroups(groups, 'CREATE');
    expect(result.map((g) => g.resource)).toEqual(['USER', 'ROLE']);
    expect(result[0].permissions).toEqual([PermissionsEnum.CREATE_USER]);
  });

  it('matches on the description', () => {
    const result = filterPermissionGroups(groups, 'initial role');
    expect(result).toHaveLength(1);
    expect(result[0].permissions).toEqual([PermissionsEnum.CREATE_USER]);
  });

  it('drops groups whose permissions all fail the query', () => {
    expect(filterPermissionGroups(groups, 'zzzz-no-match')).toEqual([]);
  });

  it('does not mutate the input groups', () => {
    const before = groups.map((g) => g.permissions.length);
    filterPermissionGroups(groups, 'create');
    expect(groups.map((g) => g.permissions.length)).toEqual(before);
  });
});
