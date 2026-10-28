import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { BACKGROUND_JOB_QUEUE_NAMES } from 'src/shared/enums/background-queue.enum';
import { RbacPolicyModule } from '../rbac/rbac-policy.module';
import { TokenModule } from '../token/token.module';
import { ActivationController } from './activation.controller';
import { CredentialsController } from './credentials.controller';
import { MagicLinkProcessor } from './processors/magic-link.processor';
import { ProvisioningService } from './provisioning.service';

/**
 * Admin-provisioning surface — one orchestrator for all the doorways an
 * admin-created user passes through:
 *   - activation (emailless user sets new password / optionally adds email)
 *   - credentials list + regenerate (emailless temp-password distribution)
 *   - magic-link invite worker (email-bearing admin-provisioned users)
 *
 * The queue is owned here (§9.2) — its root Bull config is propagated by
 * BackgroundJobsModule re-exporting BullModule.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: BACKGROUND_JOB_QUEUE_NAMES.PROVISIONING_MAGIC_LINK }),
    // Rank comparison for the credential-distribution routes: both expose a
    // plaintext temp password, so both must be scoped to targets the caller
    // outranks. The policy alone — this module has no business with role CRUD.
    RbacPolicyModule,
    // Activation rotates a credential, so it owes the same teardown every
    // other credential change does.
    TokenModule,
  ],
  controllers: [ActivationController, CredentialsController],
  providers: [ProvisioningService, MagicLinkProcessor],
  exports: [ProvisioningService],
})
export class ProvisioningModule {}
