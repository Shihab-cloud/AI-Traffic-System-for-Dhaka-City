import { ForbiddenException } from '@nestjs/common';

import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { RbacService } from './rbac.service';
import { RoleHierarchyPolicy } from './role-hierarchy.policy';

/**
 * Privilege-escalation guards on role create, update and delete.
 *
 * `CREATE:ROLE` or `UPDATE:ROLE` must not be a path to `ADMIN:ROOT`, by any of
 * the three levers a role edit exposes: the permission list, the rank, and
 * which role is being edited at all.
 */

const RANK_ADMIN = 0;
const RANK_MANAGER = 10;
const RANK_MEMBER = 20;

function build(
  opts: { roles?: Record<string, { rank: number; name?: string }>; holders?: string[] } = {},
) {
  const roles: Record<string, { rank: number; name?: string; _id: string }> = {};
  for (const [id, r] of Object.entries(opts.roles ?? {})) {
    roles[id] = { _id: id, rank: r.rank, name: r.name ?? id };
  }

  // `findById` is awaited directly in some methods and chained through
  // `.select().lean()` in others, so the stub answers to both.
  const findById = (id: string) => {
    const role = roles[id] ?? null;
    return {
      ...(role ?? {}),
      select: () => ({ lean: async () => role }),
      lean: async () => role,
      then: (resolve: (value: unknown) => unknown) => resolve(role),
    };
  };

  const roleModel = {
    findById,
    // `createRole` awaits this directly, with no `.lean()` — returning a
    // chainable object here would be a truthy "role already exists".
    findOne: jest.fn(async () => null),
    create: jest.fn(async (doc: unknown) => doc),
    findByIdAndUpdate: jest.fn(async (id: string, patch: Record<string, unknown>) => ({
      ...roles[id],
      ...patch,
      _id: id,
    })),
    findByIdAndDelete: jest.fn(async (id: string) => roles[id] ?? null),
  };

  const holders = opts.holders ?? [];
  const userModel = {
    find: () => ({
      select: () => ({
        lean: () => ({ batchSize: () => ({ cursor: () => holders.map((_id) => ({ _id })) }) }),
      }),
    }),
    countDocuments: jest.fn(async () => 0),
  };
  const tokenService = { invalidateAllUserSessionsBulk: jest.fn(async () => undefined) };

  // The real policy, not a stub. It is the thing under test in every case
  // below — a stubbed one would let the rules be deleted with nothing failing.
  const hierarchy = new RoleHierarchyPolicy(roleModel as never, userModel as never);

  const svc = new RbacService(
    roleModel as never,
    userModel as never,
    tokenService as never,
    hierarchy,
  );

  return { svc, hierarchy, roleModel, tokenService };
}

const caller = (permissions: PermissionsEnum[], rank: number, roleId = 'r-caller'): CurrentUser =>
  ({ id: 'u-1', role: { id: roleId, name: 'caller', permissions, rank } }) as CurrentUser;

const request = (permissions: PermissionsEnum[], rank: number) => ({
  name: 'new-role',
  description: '',
  permissions,
  rank,
});

describe('createRole — permission escalation', () => {
  it('refuses to grant a permission the caller does not hold', async () => {
    const { svc } = build();

    await expect(
      svc.createRole(
        request([PermissionsEnum.ADMIN], RANK_MEMBER),
        caller([PermissionsEnum.CREATE_ROLE], RANK_MANAGER),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows granting a subset of what the caller holds', async () => {
    const { svc, roleModel } = build();

    await svc.createRole(
      request([PermissionsEnum.READ_USER], RANK_MEMBER),
      caller([PermissionsEnum.CREATE_ROLE, PermissionsEnum.READ_USER], RANK_MANAGER),
    );

    expect(roleModel.create).toHaveBeenCalled();
  });

  it('lets an admin grant anything', async () => {
    const { svc, roleModel } = build();

    await svc.createRole(
      request([PermissionsEnum.ADMIN], RANK_ADMIN),
      caller([PermissionsEnum.ADMIN], RANK_ADMIN),
    );

    expect(roleModel.create).toHaveBeenCalled();
  });
});

describe('createRole — rank escalation', () => {
  it('refuses a rank stronger than the caller', async () => {
    const { svc } = build();

    await expect(
      svc.createRole(request([], RANK_ADMIN), caller([PermissionsEnum.CREATE_ROLE], RANK_MANAGER)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a rank equal to the caller — a peer can act on them', async () => {
    const { svc } = build();

    await expect(
      svc.createRole(
        request([], RANK_MANAGER),
        caller([PermissionsEnum.CREATE_ROLE], RANK_MANAGER),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a strictly weaker rank', async () => {
    const { svc, roleModel } = build();

    await svc.createRole(
      request([], RANK_MEMBER),
      caller([PermissionsEnum.CREATE_ROLE], RANK_MANAGER),
    );

    expect(roleModel.create).toHaveBeenCalled();
  });
});

describe('RoleHierarchyPolicy.assertOutranksRole', () => {
  it('refuses assigning a role at or above the caller', async () => {
    const { hierarchy } = build({ roles: { 'r-admin': { rank: RANK_ADMIN } } });

    await expect(
      hierarchy.assertOutranksRole(caller([PermissionsEnum.CREATE_USER], RANK_MANAGER), 'r-admin'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows assigning a weaker role', async () => {
    const { hierarchy } = build({ roles: { 'r-member': { rank: RANK_MEMBER } } });

    await expect(
      hierarchy.assertOutranksRole(caller([PermissionsEnum.CREATE_USER], RANK_MANAGER), 'r-member'),
    ).resolves.toBeUndefined();
  });

  it('lets an admin past regardless of rank', async () => {
    const { hierarchy } = build({ roles: { 'r-admin': { rank: RANK_ADMIN } } });

    await expect(
      hierarchy.assertOutranksRole(caller([PermissionsEnum.ADMIN], RANK_ADMIN), 'r-admin'),
    ).resolves.toBeUndefined();
  });

  it('fails closed when the caller carries no rank and none can be looked up', async () => {
    // Previously this path returned null and was checked separately in two
    // places with different handling; now there is one answer.
    const { hierarchy } = build({ roles: { 'r-member': { rank: RANK_MEMBER } } });
    const rankless = { id: 'u-1', role: null } as unknown as CurrentUser;

    await expect(hierarchy.assertOutranksRole(rankless, 'r-member')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('updateRole — the role being edited', () => {
  const MANAGER = caller([PermissionsEnum.UPDATE_ROLE], RANK_MANAGER, 'r-manager');

  it('refuses to edit a role the caller does not outrank', async () => {
    const { svc } = build({ roles: { 'r-admin': { rank: RANK_ADMIN, name: 'superuser' } } });

    await expect(
      svc.updateRole('r-admin', request([], RANK_ADMIN), MANAGER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to move a superior role below the caller', async () => {
    const { svc } = build({ roles: { 'r-admin': { rank: RANK_ADMIN, name: 'superuser' } } });

    await expect(
      svc.updateRole('r-admin', request([], RANK_MEMBER), MANAGER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to grant a permission the caller does not hold', async () => {
    const { svc } = build({ roles: { 'r-member': { rank: RANK_MEMBER, name: 'member' } } });

    await expect(
      svc.updateRole('r-member', request([PermissionsEnum.ADMIN], RANK_MEMBER), MANAGER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to promote the callers own role', async () => {
    const { svc } = build({ roles: { 'r-manager': { rank: RANK_MANAGER, name: 'manager' } } });

    await expect(
      svc.updateRole('r-manager', request([PermissionsEnum.UPDATE_ROLE], RANK_ADMIN), MANAGER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows editing the callers own role without moving its rank', async () => {
    const { svc, roleModel } = build({
      roles: { 'r-manager': { rank: RANK_MANAGER, name: 'manager' } },
    });

    await svc.updateRole(
      'r-manager',
      { ...request([PermissionsEnum.UPDATE_ROLE], RANK_MANAGER), name: 'manager' },
      MANAGER,
    );

    expect(roleModel.findByIdAndUpdate).toHaveBeenCalled();
  });

  it('allows editing a weaker role', async () => {
    const { svc, roleModel } = build({
      roles: { 'r-member': { rank: RANK_MEMBER, name: 'member' } },
    });

    await svc.updateRole('r-member', request([], RANK_MEMBER), MANAGER);

    expect(roleModel.findByIdAndUpdate).toHaveBeenCalled();
  });

  it('revokes holders when the permission set changes, not only the rank', async () => {
    // Permissions are baked into the JWT at mint time, so a revocation that
    // does not invalidate tokens leaves every holder exercising it until their
    // token expires.
    const { svc, tokenService } = build({
      roles: { 'r-member': { rank: RANK_MEMBER, name: 'member' } },
      holders: ['u-a', 'u-b'],
    });

    await svc.updateRole('r-member', request([PermissionsEnum.UPDATE_ROLE], RANK_MEMBER), MANAGER);

    expect(tokenService.invalidateAllUserSessionsBulk).toHaveBeenCalledWith(['u-a', 'u-b']);
  });

  it('leaves holders signed in when nothing meaningful changed', async () => {
    const { svc, tokenService } = build({
      roles: { 'r-member': { rank: RANK_MEMBER, name: 'member' } },
      holders: ['u-a'],
    });

    await svc.updateRole(
      'r-member',
      { ...request([], RANK_MEMBER), name: 'member', description: 'renamed' },
      MANAGER,
    );

    expect(tokenService.invalidateAllUserSessionsBulk).not.toHaveBeenCalled();
  });
});

describe('deleteRole', () => {
  it('refuses to delete a role the caller does not outrank', async () => {
    const { svc } = build({ roles: { 'r-admin': { rank: RANK_ADMIN, name: 'superuser' } } });

    await expect(
      svc.deleteRole('r-admin', caller([PermissionsEnum.DELETE_ROLE], RANK_MANAGER)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows deleting a weaker, unheld role', async () => {
    const { svc, roleModel } = build({
      roles: { 'r-member': { rank: RANK_MEMBER, name: 'member' } },
    });

    await svc.deleteRole('r-member', caller([PermissionsEnum.DELETE_ROLE], RANK_MANAGER));

    expect(roleModel.findByIdAndDelete).toHaveBeenCalledWith('r-member');
  });
});
