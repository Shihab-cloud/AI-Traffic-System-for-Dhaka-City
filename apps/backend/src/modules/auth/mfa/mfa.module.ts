import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TokenModule } from 'src/modules/auth/token/token.module';
import { MailModule } from 'src/modules/mail/mail.module';
import { NotificationModule } from 'src/modules/notification/notification.module';
import { SystemSettingsModule } from 'src/modules/system-settings/system-settings.module';
import { EnvKekAdapter } from './crypto/env-kek.adapter';
import { EnvelopeCrypto } from './crypto/envelope';
import type { KmsAdapter } from './crypto/kms.adapter';
import { StepUpTokenSigner, TrustedDeviceTokenSigner } from './crypto/token-signer';
import { EmailOtpAdapter } from './factors/email-otp.adapter';
import { TotpAdapter } from './factors/totp.adapter';
import { MfaController } from './mfa.controller';
import { MFA_FACTOR_ADAPTERS, MFA_KMS_ADAPTER } from './mfa.tokens';
import { LoginAttemptStore } from './services/login-attempt.store';
import { MfaSessionStateStore } from './services/mfa-session-state.store';
import { MfaService } from './services/mfa.service';
import { PolicyService } from './services/policy.service';
import { RecoveryService } from './services/recovery.service';
import { StepUpService } from './services/step-up.service';
import { TrustedDeviceService } from './services/trusted-device.service';
import { MFA_PASSWORD_CHANGE_LISTENER } from './mfa.password-change.token';

/**
 * MFA module — bundles all factor adapters, services, crypto helpers and the
 * `/api/mfa/*` controller. `MfaService` is the only public surface; consumers
 * (`BetterAuthProvider`, `StepUpGuard`) inject it directly. Step-up flows go
 * through `StepUpService`, kept exported so the guard's atomic token consume
 * stays a one-method dependency.
 *
 * Internal collaborators (`PolicyService`, `RecoveryService`,
 * `TrustedDeviceService`, `LoginAttemptStore`, `MfaSessionStateStore`) stay
 * private — `MfaService` re-exposes whatever is needed externally so callers
 * never reach in past the orchestrator.
 *
 * Persistence: Mongoose (backend-mongoose). The Redis-backed session-state and
 * login-attempt stores from backend-drizzle become Mongo TTL collections
 * (`mfa_session_state`, `mfa_login_attempts`) — backend-mongoose has no Redis.
 */
// Models come from the global SchemaModule — no forFeature here.
@Module({
  imports: [MailModule, NotificationModule, TokenModule, SystemSettingsModule],
  controllers: [MfaController],
  providers: [
    // Lets TokenService revoke device trust on a password change without
    // depending on MfaService, which would close the module cycle.
    { provide: MFA_PASSWORD_CHANGE_LISTENER, useExisting: MfaService },
    // ── KMS / crypto wiring ──────────────────────────────────────────────
    {
      provide: MFA_KMS_ADAPTER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): KmsAdapter => {
        const kek = config.get<string>('MFA_KEK_B64');
        if (!kek) {
          throw new Error(
            'MFA_KEK_B64 is required (32-byte base64). Generate with `openssl rand -base64 32`.',
          );
        }
        return new EnvKekAdapter(kek);
      },
    },
    EnvelopeCrypto,
    StepUpTokenSigner,
    TrustedDeviceTokenSigner,

    // ── Factor adapters ──────────────────────────────────────────────────
    TotpAdapter,
    EmailOtpAdapter,
    {
      provide: MFA_FACTOR_ADAPTERS,
      inject: [TotpAdapter, EmailOtpAdapter],
      useFactory: (totp: TotpAdapter, email: EmailOtpAdapter) => [totp, email],
    },

    // ── Services ─────────────────────────────────────────────────────────
    PolicyService,
    RecoveryService,
    TrustedDeviceService,
    LoginAttemptStore,
    MfaSessionStateStore,
    MfaService,
    StepUpService,
  ],
  exports: [MfaService, StepUpService, MFA_PASSWORD_CHANGE_LISTENER],
})
export class MfaModule {}
