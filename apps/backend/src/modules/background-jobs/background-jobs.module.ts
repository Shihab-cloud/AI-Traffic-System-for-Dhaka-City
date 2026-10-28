import { ConfigModule, ConfigService } from '@nestjs/config';

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const authToken = configService.get<string>('REDIS_AUTH_TOKEN');
        return {
          connection: {
            host: configService.get('REDIS_HOST'),
            port: configService.get('REDIS_PORT'),
            // Mirror redis.provider.ts: ElastiCache needs AUTH + TLS together.
            ...(authToken ? { password: authToken, tls: {} } : {}),
          },
          // BullMQ defaults to `attempts: 1` and keeps every job forever.
          // Retries pair with the deterministic `jobId` on broadcast chunks,
          // without which a retry duplicates delivery.
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: { age: 3_600, count: 1_000 },
            removeOnFail: { age: 86_400 },
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  // Intentional root-level re-export: `BullModule.forRootAsync(...)` above is the
  // single Bull configuration for the entire app. Re-exporting it propagates the
  // root config to downstream feature modules that call `BullModule.registerQueue(...)`.
  exports: [BullModule],
})
export class BackgroundJobsModule {}
