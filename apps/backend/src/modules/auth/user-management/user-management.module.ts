import { Module } from '@nestjs/common';
import { MailModule } from '../../mail/mail.module';
import { NotificationModule } from '../../notification/notification.module';
import { MfaModule } from '../mfa/mfa.module';
import { RbacPolicyModule } from '../rbac/rbac-policy.module';
import { RbacModule } from '../rbac/rbac.module';
import { TokenModule } from '../token/token.module';
import { UserManagementController } from './user-management.controller';
import { UserManagementService } from './user-management.service';

@Module({
  // MfaModule for the admin MFA-reset route — the recovery path for a user
  // whose only factor was on a lost device.
  imports: [TokenModule, MailModule, RbacModule, RbacPolicyModule, NotificationModule, MfaModule],
  controllers: [UserManagementController],
  providers: [UserManagementService],
  exports: [UserManagementService],
})
export class UserManagementModule {}
