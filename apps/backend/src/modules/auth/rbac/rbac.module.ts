import { Module } from '@nestjs/common';
import { TokenModule } from '../token/token.module';
import { RbacPolicyModule } from './rbac-policy.module';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';

@Module({
  imports: [TokenModule, RbacPolicyModule],
  controllers: [RbacController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
