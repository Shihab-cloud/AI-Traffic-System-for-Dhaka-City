import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import type { Connection } from 'mongoose';
import { MfaModule } from 'src/modules/auth/mfa/mfa.module';
import { MfaService } from 'src/modules/auth/mfa/services/mfa.service';
import { MailModule } from 'src/modules/mail/mail.module';
import { MailService } from 'src/modules/mail/mail.service';
import { SystemSettingsModule } from 'src/modules/system-settings/system-settings.module';
import { SystemSettingsService } from 'src/modules/system-settings/system-settings.service';
import { InvalidatedToken, InvalidatedTokenModel } from 'src/schemas/auth/token.schema';
import { Role, RoleModel } from 'src/schemas/public/role.schema';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { createBetterAuth } from '../auth/better-auth';
import { BETTER_AUTH, type BetterAuthInstance } from './better-auth.tokens';
import { REDIS_CLIENT } from './redis.provider';

export { BETTER_AUTH, type BetterAuthInstance };

const BetterAuthProvider = {
  provide: BETTER_AUTH,
  inject: [
    getConnectionToken(),
    REDIS_CLIENT,
    getModelToken(User.name),
    getModelToken(Role.name),
    getModelToken(InvalidatedToken.name),
    ConfigService,
    MailService,
    MfaService,
    SystemSettingsService,
  ],
  useFactory: (
    connection: Connection,
    redis: Redis,
    userModel: UserModel,
    roleModel: RoleModel,
    invalidatedTokenModel: InvalidatedTokenModel,
    configService: ConfigService,
    mailService: MailService,
    mfa: MfaService,
    systemSettings: SystemSettingsService,
  ): BetterAuthInstance => {
    const betterAuthSecret = configService.get<string>('BETTER_AUTH_SECRET');
    if (!betterAuthSecret) throw new Error('BETTER_AUTH_SECRET is required');

    // Native MongoDB driver Db handle backing the mongodbAdapter. `connection.db`
    // is populated once Mongoose has connected; the provider is resolved during
    // bootstrap after MongooseModule.forRoot establishes the connection.
    const db = connection.db;
    if (!db) throw new Error('Mongoose connection is not established (connection.db is undefined)');

    return createBetterAuth({
      db,
      // Rate-limit counters live in Redis so they are atomic and shared across
      // replicas. RedisModule is @Global and registered in AppModule.
      redis,
      userModel,
      roleModel,
      invalidatedTokenModel,
      frontendUrl: configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000',
      backendUrl: configService.get<string>('BACKEND_URL') ?? 'http://localhost:5001',
      betterAuthSecret,
      mailService,
      googleClientId: configService.get<string>('GOOGLE_CLIENT_ID'),
      googleClientSecret: configService.get<string>('GOOGLE_CLIENT_SECRET'),
      jwtExpirySeconds: Number(configService.get<string>('JWT_EXPIRY_SECONDS')) || undefined,
      // Reverse proxies in front of this service. Drives client-IP resolution
      // for the rate limiter; unset falls back to the Docker-bridge defaults.
      trustedProxyCidrs: configService.get<string>('TRUSTED_PROXY_CIDRS'),
      // Live MFA gate: MfaService implements all four MfaIntegrationHooks.
      // Method references must be bound — they read state via `this.attempts`/`this.sessions`.
      mfa: {
        onLoginSessionCreating: mfa.onLoginSessionCreating,
        onLoginSessionCreated: mfa.onLoginSessionCreated,
        enrichJwtPayload: mfa.enrichJwtPayload,
        onAccountCreated: mfa.onAccountCreated,
        onPasswordChanged: mfa.onPasswordChanged,
        enrichSession: ({ sessionId }) => mfa.getSessionState(sessionId),
      },
      // Runtime verification-email gate, read from system settings (default off).
      isEmailVerificationEnabled: () => systemSettings.isEmailVerificationEnabled(),
      // Runtime self-registration gate, read from system settings (default on).
      isSignUpEnabled: () => systemSettings.isSignupEnabled(),
    });
  },
};

@Global()
@Module({
  imports: [MailModule, MfaModule, SystemSettingsModule],
  providers: [BetterAuthProvider],
  exports: [BetterAuthProvider],
})
export class BetterAuthModule {}
