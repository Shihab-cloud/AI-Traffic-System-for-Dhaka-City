import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisModule } from '../../lib/providers/redis.provider';

@Module({
  // RedisModule provides the shared REDIS_CLIENT used by the /ready Redis probe.
  // It is @Global, so importing it here also makes the client available app-wide.
  imports: [TerminusModule, RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}
