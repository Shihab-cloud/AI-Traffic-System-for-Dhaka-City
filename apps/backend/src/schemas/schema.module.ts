import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Account, AccountSchema } from 'src/schemas/auth/account.schema';
import { InvalidatedToken, InvalidatedTokenSchema } from 'src/schemas/auth/token.schema';
import { MfaBackupCode, MfaBackupCodeSchema } from 'src/schemas/mfa/backup-code.schema';
import { MfaChallenge, MfaChallengeSchema } from 'src/schemas/mfa/challenge.schema';
import { MfaFactorSecret, MfaFactorSecretSchema } from 'src/schemas/mfa/factor-secret.schema';
import { MfaFactor, MfaFactorSchema } from 'src/schemas/mfa/factor.schema';
import { LoginAttempt, LoginAttemptSchema } from 'src/schemas/mfa/login-attempt.schema';
import { MfaAudit, MfaAuditSchema } from 'src/schemas/mfa/mfa-audit.schema';
import { MfaSessionState, MfaSessionStateSchema } from 'src/schemas/mfa/mfa-session-state.schema';
import { MfaStepUpToken, MfaStepUpTokenSchema } from 'src/schemas/mfa/step-up-token.schema';
import { MfaTrustedDevice, MfaTrustedDeviceSchema } from 'src/schemas/mfa/trusted-device.schema';
import { DeviceToken, DeviceTokenSchema } from 'src/schemas/notification/device-token.schema';
import { Notification, NotificationSchema } from 'src/schemas/notification/notification.schema';
import {
  UserNotificationSettings,
  UserNotificationSettingsSchema,
} from 'src/schemas/notification/user-notification-settings.schema';
import { Faq, FaqSchema } from 'src/schemas/public/faq.schema';
import { GlobalFile, GlobalFileSchema } from 'src/schemas/public/global-file.schema';
import { Role, RoleSchema } from 'src/schemas/public/role.schema';
import { SupportMessage, SupportMessageSchema } from 'src/schemas/public/support-message.schema';
import {
  SupportTicketLog,
  SupportTicketLogSchema,
} from 'src/schemas/public/support-ticket-log.schema';
import { SupportTicket, SupportTicketSchema } from 'src/schemas/public/support-ticket.schema';
import { SystemSettings, SystemSettingsSchema } from 'src/schemas/public/system-settings.schema';
import { User, UserSchema } from 'src/schemas/public/user.schema';
import { AuditLog, AuditLogSchema } from 'src/schemas/traffic/audit-log.schema';
import { Camera, CameraSchema } from 'src/schemas/traffic/camera.schema';
import { Fine, FineSchema } from 'src/schemas/traffic/fine.schema';
import { Payment, PaymentSchema } from 'src/schemas/traffic/payment.schema';
import { PlateSighting, PlateSightingSchema } from 'src/schemas/traffic/plate-sighting.schema';
import { Review, ReviewSchema } from 'src/schemas/traffic/review.schema';
import {
  SurveillanceRun,
  SurveillanceRunSchema,
} from 'src/schemas/traffic/surveillance-run.schema';
import { TrackedVehicle, TrackedVehicleSchema } from 'src/schemas/traffic/tracked-vehicle.schema';
import { TrafficCase, TrafficCaseSchema } from 'src/schemas/traffic/traffic-case.schema';
import { Vehicle, VehicleSchema } from 'src/schemas/traffic/vehicle.schema';
import { Violation, ViolationSchema } from 'src/schemas/traffic/violation.schema';

/**
 * Single registration point for EVERY mongoose model — feature modules do NOT
 * call `MongooseModule.forFeature` themselves. Mirrors drizzle's `db.ts`,
 * which exposes all tables from one place. `@Global` + the MongooseModule
 * export make every model token injectable anywhere; module-boundary
 * discipline (coding-standards §9) is enforced by review, not by DI scoping.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      // ── public ──────────────────────────────────────────────────────────
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      { name: GlobalFile.name, schema: GlobalFileSchema },
      { name: Faq.name, schema: FaqSchema },
      { name: SupportTicket.name, schema: SupportTicketSchema },
      { name: SupportMessage.name, schema: SupportMessageSchema },
      { name: SupportTicketLog.name, schema: SupportTicketLogSchema },
      { name: SystemSettings.name, schema: SystemSettingsSchema },
      // ── auth ────────────────────────────────────────────────────────────
      { name: InvalidatedToken.name, schema: InvalidatedTokenSchema },
      { name: Account.name, schema: AccountSchema },
      // ── mfa ─────────────────────────────────────────────────────────────
      { name: MfaFactor.name, schema: MfaFactorSchema },
      { name: MfaFactorSecret.name, schema: MfaFactorSecretSchema },
      { name: MfaChallenge.name, schema: MfaChallengeSchema },
      { name: MfaBackupCode.name, schema: MfaBackupCodeSchema },
      { name: MfaTrustedDevice.name, schema: MfaTrustedDeviceSchema },
      { name: MfaStepUpToken.name, schema: MfaStepUpTokenSchema },
      { name: MfaAudit.name, schema: MfaAuditSchema },
      { name: MfaSessionState.name, schema: MfaSessionStateSchema },
      { name: LoginAttempt.name, schema: LoginAttemptSchema },
      // ── notification ────────────────────────────────────────────────────
      { name: Notification.name, schema: NotificationSchema },
      { name: DeviceToken.name, schema: DeviceTokenSchema },
      { name: UserNotificationSettings.name, schema: UserNotificationSettingsSchema },
      // ── traffic enforcement ─────────────────────────────────────────────
      { name: Camera.name, schema: CameraSchema },
      { name: Violation.name, schema: ViolationSchema },
      { name: Vehicle.name, schema: VehicleSchema },
      { name: Fine.name, schema: FineSchema },
      { name: TrafficCase.name, schema: TrafficCaseSchema },
      { name: Review.name, schema: ReviewSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: PlateSighting.name, schema: PlateSightingSchema },
      { name: SurveillanceRun.name, schema: SurveillanceRunSchema },
      { name: TrackedVehicle.name, schema: TrackedVehicleSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class SchemaModule {}
