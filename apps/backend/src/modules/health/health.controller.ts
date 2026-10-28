import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import type Redis from 'ioredis';
import { Public } from '../../lib/decorators/auth.decorator';
import { REDIS_CLIENT } from '../../lib/providers/redis.provider';

/**
 * Liveness + readiness probes for ALB / ECS container health checks.
 *
 *   /health — process answered → 200. No external checks. Used by ALB target
 *             group health checks and ECS container health command. A 200
 *             here just means "the Node event loop is alive".
 *
 *   /ready  — MongoDB + Redis must respond → 200. Returns 503 if either
 *             dependency is unreachable. Redis is checked because BullMQ uses
 *             it for all background jobs. Optional secondary probe; not used by
 *             ALB.
 */
@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    @InjectConnection() private readonly connection: Connection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Public()
  @Get('health')
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  async readiness(): Promise<HealthCheckResult> {
    return this.health.check([() => this.checkDatabase(), () => this.checkRedis()]);
  }

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    const indicator = this.indicator.check('database');
    try {
      // readyState 1 === connected. Issue a lightweight ping to confirm the
      // server actually answers, not just that the driver thinks it is up.
      if (Number(this.connection.readyState) !== 1 || !this.connection.db) {
        return indicator.down({
          message: `connection not ready (state ${this.connection.readyState})`,
        });
      }
      await this.connection.db.admin().ping();
      return indicator.up();
    } catch (err) {
      return indicator.down({ message: (err as Error).message });
    }
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    const indicator = this.indicator.check('redis');
    try {
      const reply = await this.redis.ping();
      if (reply !== 'PONG') {
        return indicator.down({ message: `unexpected reply: ${String(reply)}` });
      }
      return indicator.up();
    } catch (err) {
      return indicator.down({ message: (err as Error).message });
    }
  }
}
