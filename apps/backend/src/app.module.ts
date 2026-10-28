import { MailerModule } from '@nestjs-modules/mailer';
import { EjsAdapter } from '@nestjs-modules/mailer/adapters/ejs.adapter';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { AllExceptionsFilter } from './lib/exception-filter/exception-filter';
import { AuthGuard } from './lib/guards/auth.guard';
import { IpRateLimitGuard } from './lib/guards/ip-rate-limit.guard';
import { PermissionsGuard } from './lib/guards/permission.guard';
import { StepUpGuard } from './lib/guards/step-up.guard';
import { LoggingInterceptor } from './lib/interceptors/logging.interceptor';
import { LoggerModule } from './lib/logger/logger.module';
import { BetterAuthModule } from './lib/providers/better-auth.provider';
import { RedisModule } from './lib/providers/redis.provider';
import { WorkerLifecycleService } from './lib/worker/worker-lifecycle.service';
import { MfaModule } from './modules/auth/mfa/mfa.module';
import { ProvisioningModule } from './modules/auth/provisioning/provisioning.module';
import { RbacModule } from './modules/auth/rbac/rbac.module';
import { TokenModule } from './modules/auth/token/token.module';
import { UserManagementModule } from './modules/auth/user-management/user-management.module';
import { UserModule } from './modules/auth/user/user.module';
import { BackgroundJobsModule } from './modules/background-jobs/background-jobs.module';
import { FaqModule } from './modules/faq/faq.module';
import { FileModule } from './modules/file/file.module';
import { HealthModule } from './modules/health/health.module';
import { MailModule } from './modules/mail/mail.module';
import { NotificationModule } from './modules/notification/notification.module';
import { SupportModule } from './modules/support/support.module';
import { SystemSettingsModule } from './modules/system-settings/system-settings.module';
import { TrafficModule } from './modules/traffic/traffic.module';
import { SchemaModule } from './schemas/schema.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.development', '.env.production', '.env.local'],
      load: [configuration],
    }),
    MongooseModule.forRoot(configuration().DATABASE_URL),
    // No module-level secret/expiry: every TokenService call passes its own
    // secret (RESET_TOKEN_SECRET for invite tokens), so a default would be dead.
    JwtModule.register({}),
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        transport: {
          host: configService.get<string>('MAIL_HOST'),
          port: configService.get<number>('MAIL_PORT'),
          secure: false,
          auth: {
            user: configService.get<string>('MAIL_USER'),
            pass: configService.get<string>('MAIL_PASS'),
          },
        },
        preview: false,
        defaults: {
          from: configService.get<string>('MAIL_FROM'),
        },
        template: {
          adapter: new EjsAdapter(),
          options: {
            strict: false,
          },
        },
      }),
    }),
    SchemaModule,
    TokenModule,
    RbacModule,
    UserModule,
    UserManagementModule,
    FileModule,
    MailModule,
    BackgroundJobsModule,
    LoggerModule,
    RedisModule,
    BetterAuthModule,
    MfaModule,
    ProvisioningModule,
    SupportModule,
    NotificationModule,
    FaqModule,
    HealthModule,
    SystemSettingsModule,
    TrafficModule,
    // @Cron timers run in-process — the scheduler registry is always loaded.
    ScheduleModule.forRoot(),
    // BullMQ jobs are processed in-process; DiscoveryService lets
    // WorkerLifecycleService find every WorkerHost to drain on shutdown.
    DiscoveryModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    LoggingInterceptor,
    // Graceful BullMQ drain on SIGTERM.
    WorkerLifecycleService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    // Registered first so an unauthenticated flood is rejected before AuthGuard
    // does any token verification or DB work. No-op on routes without
    // @RateLimit().
    {
      provide: APP_GUARD,
      useClass: IpRateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },

    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    // StepUpGuard runs after AuthGuard + PermissionsGuard. Routes without
    // @RequiresStepUp() return early (canActivate→true), so this guard is
    // a pure no-op for the vast majority of endpoints.
    {
      provide: APP_GUARD,
      useClass: StepUpGuard,
    },
  ],
})
export class AppModule {}
