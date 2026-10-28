import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CurrentUser } from 'src/lib/decorators/user.decorator';
import { Role, RoleModel } from 'src/schemas/public/role.schema';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { PaginationQueryDto } from 'src/shared/dtos/query.dto';
import { PermissionsConfig } from 'src/shared/enum-config/permissions-config';
import {
  ALL_PERMISSIONS,
  OFFICER_PERMISSIONS,
  PermissionsEnum,
  USER_PERMISSIONS,
} from 'src/shared/enums/permission.enum';
import { RoleNameEnum } from 'src/shared/enums/role-name.enum';
import { escapeRegex, MongoQueryBuilder } from 'src/utils/mongo-query-builder';
import { RoleCreationRequest } from '../../../lib/dto/request/role.req';
import { TokenService } from '../token/token.service';
import { RoleHierarchyPolicy, samePermissionSet } from './role-hierarchy.policy';

@Injectable()
export class RbacService implements OnModuleInit {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    @InjectModel(Role.name) private roleModel: RoleModel,
    @InjectModel(User.name) private userModel: UserModel,
    private readonly tokenService: TokenService,
    private readonly hierarchy: RoleHierarchyPolicy,
  ) {}

  async onModuleInit() {
    await this.ensureAdminPermissions();
    await this.ensureUserPermissions();
    await this.ensureOfficerPermissions();
  }

  /** Traffic personnel: between ADMIN (0) and USER (20, vehicle owners). */
  async findOrCreateOfficerRole() {
    const existingRole = await this.roleModel.findOne({ name: RoleNameEnum.TRAFFIC_OFFICER });

    if (existingRole) return existingRole;

    return this.roleModel.create({
      name: RoleNameEnum.TRAFFIC_OFFICER,
      description: 'Traffic personnel: violations, tickets, surveillance and tracking',
      permissions: OFFICER_PERMISSIONS,
      rank: 10,
    });
  }

  private async ensureOfficerPermissions() {
    const officerRole = await this.findOrCreateOfficerRole();

    const missingPermissions = OFFICER_PERMISSIONS.filter(
      (permission) => !officerRole.permissions.includes(permission),
    );
    if (missingPermissions.length > 0) {
      this.logger.log(
        `Adding ${missingPermissions.length} missing permissions to "${officerRole.name}" role: ${missingPermissions.join(', ')}`,
      );
      officerRole.permissions = [...new Set([...officerRole.permissions, ...missingPermissions])];
      await officerRole.save();
    }
  }

  /** USER is the default role assigned to newly-created / self-signup users. */
  async findOrCreateUserRole() {
    const existingRole = await this.roleModel.findOne({
      name: RoleNameEnum.USER,
    });

    if (existingRole) return existingRole;

    return this.roleModel.create({
      name: RoleNameEnum.USER,
      description: 'Regular user',
      permissions: USER_PERMISSIONS,
      isDefault: true,
      rank: 20,
    });
  }

  private async ensureAdminPermissions() {
    const adminRole = await this.findOrCreateAdminRole();

    const missingPermissions = ALL_PERMISSIONS.filter(
      (permission) => !adminRole.permissions.includes(permission),
    );
    if (missingPermissions.length > 0) {
      this.logger.log(`Adding missing permissions to admin role: ${missingPermissions.join(', ')}`);
      adminRole.permissions = [...new Set([...adminRole.permissions, ...missingPermissions])];
      await adminRole.save();
    }
  }

  private async ensureUserPermissions() {
    const userRole = await this.findOrCreateUserRole();

    const missingPermissions = USER_PERMISSIONS.filter(
      (permission) => !userRole.permissions.includes(permission),
    );
    if (missingPermissions.length > 0) {
      this.logger.log(
        `Adding ${missingPermissions.length} missing permissions to "${userRole.name}" role: ${missingPermissions.join(', ')}`,
      );
      userRole.permissions = [...new Set([...userRole.permissions, ...missingPermissions])];
      await userRole.save();
    }
  }

  async createRole(roleCreationRequest: RoleCreationRequest, caller?: CurrentUser) {
    // Case-insensitive, matching `updateRole` and the reserved-name checks —
    // otherwise `"Admin"` can be created alongside `"admin"` and slips past
    // the reserved-name guards.
    const existingRole = await this.roleModel.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(roleCreationRequest.name)}$`, 'i') },
    });

    if (existingRole)
      throw new ConflictException(`Role with name ${roleCreationRequest.name} already exists`);

    if (caller) {
      this.hierarchy.assertMayGrant(caller, roleCreationRequest.permissions);
      await this.hierarchy.assertMayAssignRank(caller, roleCreationRequest.rank);
    }

    return this.roleModel.create({
      name: roleCreationRequest.name,
      description: roleCreationRequest.description,
      permissions: roleCreationRequest.permissions,
      rank: roleCreationRequest.rank,
    });
  }

  async findOrCreateAdminRole() {
    const existingRole = await this.roleModel.findOne({
      name: RoleNameEnum.ADMIN,
    });

    if (existingRole) return existingRole;

    return this.roleModel.create({
      name: RoleNameEnum.ADMIN,
      description: 'Administrator with full access',
      permissions: Object.values(PermissionsEnum),
      rank: 0,
    });
  }

  getAllPermissions() {
    return PermissionsConfig;
  }

  async getAllRoles(query: PaginationQueryDto) {
    return this.roleModel.paginate(
      { ...query.filter, ...MongoQueryBuilder.buildSearch(query.search, Role) },
      {
        limit: query.limit,
        page: query.page,
        sort: query.sortBy,
      },
    );
  }

  async getRoleById(roleId: string) {
    const role = await this.roleModel.findById(roleId);

    if (!role) throw new NotFoundException(`Role with ID ${roleId} not found`);

    return role;
  }

  async updateRole(roleId: string, updateRoleDto: RoleCreationRequest, caller?: CurrentUser) {
    const existingRole = await this.roleModel.findById(roleId);

    if (!existingRole) throw new NotFoundException(`Role with ID ${roleId} not found`);

    if ((existingRole.name as RoleNameEnum) === RoleNameEnum.ADMIN)
      throw new ConflictException('Cannot update admin role');

    if (updateRoleDto.name.toLowerCase() !== existingRole.name.toLowerCase()) {
      const roleWithSameName = await this.roleModel.findOne({
        name: { $regex: new RegExp(`^${escapeRegex(updateRoleDto.name)}$`, 'i') },
      });

      if (roleWithSameName)
        throw new ConflictException(`Role with name ${updateRoleDto.name} already exists`);
    }

    if (caller) {
      const isOwnRole = caller.role?.id === roleId;

      if (isOwnRole && updateRoleDto.rank > existingRole.rank) {
        throw new ForbiddenException('Cannot demote your own role');
      }

      // Editing a role the caller does not outrank lets a `UPDATE:ROLE` holder
      // rewrite or neuter a superior role — including moving it below
      // themselves and revoking every holder's session on the way.
      if (!isOwnRole) {
        await this.hierarchy.assertMayAssignRank(caller, existingRole.rank);
      }

      this.hierarchy.assertMayGrant(caller, updateRoleDto.permissions);

      // Only when the rank actually moves: an edit that leaves it alone must
      // stay possible for the role the caller holds.
      if (updateRoleDto.rank !== existingRole.rank) {
        await this.hierarchy.assertMayAssignRank(caller, updateRoleDto.rank);
      }
    }

    const previousRank = existingRole.rank;
    const previousPermissions = existingRole.permissions ?? [];

    const updatedRole = await this.roleModel.findByIdAndUpdate(
      roleId,
      {
        name: updateRoleDto.name,
        description: updateRoleDto.description,
        permissions: updateRoleDto.permissions,
        rank: updateRoleDto.rank,
      },
      { returnDocument: 'after' },
    );

    // Force every holder to re-auth when rank *or* permissions change.
    // `PermissionsGuard` reads permissions from the JWT, baked at mint time, so
    // a revocation that does not invalidate sessions has no effect until the
    // holder's token expires.
    if (
      updatedRole &&
      (previousRank !== updatedRole.rank ||
        !samePermissionSet(previousPermissions, updatedRole.permissions ?? []))
    ) {
      await this.invalidateTokensForRole(roleId);
    }

    return updatedRole;
  }

  /**
   * Revoke every session held by users with this role.
   *
   * Cursored and concurrency-bounded rather than `Promise.all` over the whole
   * holder list: the default role is held by every self-signup user, so an
   * unbounded fan-out would exhaust the connection pool.
   *
   * Runs synchronously with the request, so the caller's "sessions revoked"
   * response means they are. Moving it to the BullMQ queue would scale better
   * for very large roles at the cost of that guarantee.
   */
  private async invalidateTokensForRole(roleId: string): Promise<void> {
    const BATCH_SIZE = 100;
    let processed = 0;
    let batch: string[] = [];

    const drain = async () => {
      if (batch.length === 0) return;
      const ids = batch;
      batch = [];
      await this.tokenService.invalidateAllUserSessionsBulk(ids);
      processed += ids.length;
    };

    // Streamed, not materialised: the default role is held by every signed-up
    // user, and `.cursor()` keeps one batch in memory rather than all of them.
    for await (const holder of this.userModel
      .find({ roleId })
      .select('_id')
      .lean()
      .batchSize(BATCH_SIZE)
      .cursor()) {
      batch.push(String(holder._id));
      if (batch.length >= BATCH_SIZE) await drain();
    }
    await drain();

    if (processed === 0) return;

    this.logger.log(`Invalidated tokens for ${processed} user(s) holding role ${roleId}`);
  }

  async deleteRole(roleId: string, caller?: CurrentUser) {
    const role = await this.roleModel.findById(roleId);

    if (!role) throw new NotFoundException(`Role with ID ${roleId} not found`);

    if ((role.name as RoleNameEnum) === RoleNameEnum.ADMIN)
      throw new ConflictException('Cannot delete admin role');

    if (caller) await this.hierarchy.assertMayAssignRank(caller, role.rank);

    if (role.isDefault) throw new ConflictException('Cannot delete the default role');

    const usersWithRole = await this.userModel.countDocuments({ roleId });

    if (usersWithRole > 0) {
      throw new ConflictException('Cannot delete role: It is still assigned to users');
    }

    return this.roleModel.findByIdAndDelete(roleId);
  }
}
