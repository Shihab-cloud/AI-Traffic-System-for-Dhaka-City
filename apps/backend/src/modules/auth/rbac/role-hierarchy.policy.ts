import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import { CurrentUser } from 'src/lib/decorators/user.decorator';
import { Role, RoleModel } from 'src/schemas/public/role.schema';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';

/**
 * Who may act on whom, and who may hand out what.
 *
 * Rank ascends as authority descends: rank 0 is the strongest role, and a
 * caller may only act on something with a strictly larger rank. Equal rank
 * counts as escalation — it produces a peer who can then act back on the
 * caller.
 *
 * These rules are the only thing standing between `CREATE:ROLE` / `UPDATE:ROLE`
 * / `UPDATE:USER` and full admin, and they are enforced from three different
 * services. They live here, apart from role CRUD and user CRUD, so that there
 * is one answer to "may this caller do this" rather than one per consumer.
 */
@Injectable()
export class RoleHierarchyPolicy {
  constructor(
    @InjectModel(Role.name) private readonly roleModel: RoleModel,
    @InjectModel(User.name) private readonly userModel: UserModel,
  ) {}

  /**
   * A caller may only grant permissions they already hold.
   *
   * `ADMIN` is a legal `PermissionsEnum` value, so without this a role-editing
   * permission alone is a complete path to full admin.
   */
  assertMayGrant(caller: CurrentUser, requested: PermissionsEnum[]): void {
    const held = new Set(caller.role?.permissions ?? []);
    if (held.has(PermissionsEnum.ADMIN)) return;

    const escalating = requested.filter((permission) => !held.has(permission));
    if (escalating.length > 0) {
      throw new ForbiddenException(
        `Cannot grant permissions you do not hold: ${escalating.join(', ')}`,
      );
    }
  }

  /** A caller may only create or move a role to a rank strictly weaker than their own. */
  async assertMayAssignRank(caller: CurrentUser, rank: number): Promise<void> {
    if (this.isAdmin(caller)) return;

    const callerRank = await this.rankOf(caller);
    if (rank <= callerRank) {
      throw new ForbiddenException(
        `Cannot assign rank ${rank}, which is at or above your own (${callerRank})`,
      );
    }
  }

  /**
   * Refuses the caller acting on a role at or above their own.
   *
   * Guards both directions of a role edit: the role being changed, and the role
   * being handed to someone.
   */
  async assertOutranksRole(caller: CurrentUser, roleId: string): Promise<void> {
    if (this.isAdmin(caller)) return;

    const role = await this.roleModel.findById(roleId).select('rank').lean();
    if (!role) throw new NotFoundException(`Role with ID ${roleId} not found`);

    await this.assertMayAssignRank(caller, role.rank);
  }

  /**
   * Refuses the caller acting on a user whose role is at or above their own.
   *
   * Self-targeting is refused uniformly: self-service lives on its own
   * endpoints, not on the admin surface.
   */
  async assertOutranksUser(caller: CurrentUser, targetUserId: string): Promise<void> {
    if (this.isAdmin(caller)) return;

    if (targetUserId === caller.id) {
      throw new ForbiddenException('Cannot perform this action on your own account');
    }

    const [callerRank, target] = await Promise.all([
      this.rankOf(caller),
      this.userModel.findById(targetUserId).populate<{ role: Role }>('role').lean(),
    ]);

    if (!target) throw new NotFoundException(`User with ID ${targetUserId} not found`);

    const targetRank = target.role?.rank;
    if (targetRank === undefined || targetRank === null) {
      throw new ForbiddenException('Target role not found');
    }

    if (targetRank <= callerRank) {
      throw new ForbiddenException('Cannot perform this action on a user of equal or higher rank');
    }
  }

  private isAdmin(caller: CurrentUser): boolean {
    return (caller.role?.permissions ?? []).includes(PermissionsEnum.ADMIN);
  }

  /**
   * The caller's rank, preferring the JWT claim and falling back to the
   * database for tokens minted before the claim existed.
   *
   * Throws rather than returning null: a caller whose rank cannot be
   * established has no place in a rank comparison, and every caller of this is
   * about to make one.
   */
  private async rankOf(caller: CurrentUser): Promise<number> {
    if (typeof caller.role?.rank === 'number') return caller.role.rank;

    const roleId = caller.role?.id;
    if (!roleId) throw new ForbiddenException('Caller has no role assigned');

    const role = await this.roleModel.findById(roleId).select('rank').lean();
    if (!role || typeof role.rank !== 'number') {
      throw new ForbiddenException('Cannot determine your role rank');
    }
    return role.rank;
  }
}

/**
 * Set equality for permission lists — order and duplicates are not meaningful,
 * so a reorder must not be mistaken for a change (it would revoke every
 * holder's session for nothing) and a genuine revocation must not be missed.
 */
export function samePermissionSet(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const permission of right) {
    if (!left.has(permission)) return false;
  }
  return true;
}
