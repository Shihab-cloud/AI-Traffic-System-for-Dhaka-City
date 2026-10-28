import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Role, RoleSchema } from 'src/schemas/public/role.schema';
import { User, UserSchema } from 'src/schemas/public/user.schema';
import { RoleHierarchyPolicy } from './role-hierarchy.policy';

/**
 * The rank/permission rules on their own.
 *
 * Separate from `RbacModule` so that user-management and provisioning can
 * enforce them without importing role CRUD, the boot-time seeder and the
 * session-invalidation orchestrator that `RbacService` also carries.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Role.name, schema: RoleSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [RoleHierarchyPolicy],
  exports: [RoleHierarchyPolicy],
})
export class RbacPolicyModule {}
