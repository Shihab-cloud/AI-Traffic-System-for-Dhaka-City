import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Shared ioredis client (DI token: REDIS_CLIENT).
 *
 * Configured against the SAME Redis env (REDIS_HOST / REDIS_PORT, plus optional
 * REDIS_AUTH_TOKEN for ElastiCache AUTH+TLS) that BullMQ uses in
 * BackgroundJobsModule, so the health `/ready` Redis probe checks the exact
 * dependency the queues rely on. Mirrors backend-drizzle's redis.provider.ts.
 */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

const RedisProvider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const logger = new Logger('Redis');

    const authToken = configService.get<string>('REDIS_AUTH_TOKEN');
    const redis = new Redis({
      host: configService.get<string>('REDIS_HOST') || 'localhost',
      port: Number(configService.get<string>('REDIS_PORT')) || 6379,
      // ElastiCache requires AUTH + TLS when at-rest/in-transit encryption is on.
      // Local dev usually has neither; gate both on REDIS_AUTH_TOKEN presence.
      ...(authToken ? { password: authToken, tls: {} } : {}),
      maxRetriesPerRequest: 3,
      // Fail commands immediately while disconnected instead of buffering them.
      // The rate limiter and the better-auth store both fail open on a Redis
      // error, and that only works if the error arrives — with the queue on, a
      // long outage instead accumulates every command in memory.
      enableOfflineQueue: false,
      // Reconnect indefinitely with a capped backoff. `IpRateLimitGuard` and
      // `createRedisRateLimitStorage` both fail *open* on Redis errors, which
      // only holds if the process is still alive to serve the request.
      retryStrategy: (times) => {
        const delay = Math.min(2 ** Math.min(times, 8) * 100, 30_000);
        // Noisy for the first handful, then quiet — a long outage should not
        // also be a log flood.
        if (times <= 5 || times % 20 === 0) {
          logger.warn(`Redis unreachable — reconnecting in ${delay}ms (attempt ${times})`);
        }
        return delay;
      },
    });

    redis.on('connect', () => logger.log('Connected'));
    redis.on('error', (err) => logger.error(err.message));

    return redis;
  },
};

@Global()
@Module({
  providers: [RedisProvider],
  exports: [RedisProvider],
})
export class RedisModule {}
