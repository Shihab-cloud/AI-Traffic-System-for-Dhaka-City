import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';

import { BETTER_AUTH, type BetterAuthInstance } from 'src/lib/providers/better-auth.provider';
import { BACKGROUND_JOB_QUEUE_NAMES } from 'src/shared/enums/background-queue.enum';
import type { MagicLinkInvitePayload } from '../provisioning.service';

/**
 * BullMQ worker for the magic-link invite stage. Listens on
 * `BACKGROUND_JOB_QUEUE_NAMES.PROVISIONING_MAGIC_LINK`.
 *
 * Why a queue: SMTP latency must not block ingestion. The worker calls
 * Better Auth's `auth.api.signInMagicLink`, which generates a token and
 * fires the `sendMagicLink` plugin callback configured in `better-auth.ts`
 * — that callback delegates to `MailService.sendMagicLink`.
 *
 * Concurrency is bounded (4) so a 500-row import doesn't open 500 SMTP
 * connections at once.
 */
@Processor(BACKGROUND_JOB_QUEUE_NAMES.PROVISIONING_MAGIC_LINK, { concurrency: 4 })
export class MagicLinkProcessor extends WorkerHost {
  private readonly logger = new Logger(MagicLinkProcessor.name);

  constructor(
    @Inject(BETTER_AUTH) private readonly betterAuth: BetterAuthInstance,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async process(job: Job<MagicLinkInvitePayload>): Promise<void> {
    const { email, userId } = job.data;
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';

    // callbackURL lands the verified session on the dashboard; the FE proxy
    // then forwards to /auth/activate because `mustResetPassword` is set,
    // which surfaces as `activation_required: true` in the session payload.
    try {
      await this.betterAuth.auth.api.signInMagicLink({
        body: { email, callbackURL: frontendUrl },
        headers: new Headers(),
      });
      this.logger.log(`[magic-link] Sent invite to userId=${userId} email=${email}`);
    } catch (err) {
      // BA throws APIError with a `body` field — surface both so we can tell
      // "user not found", "disableSignUp rejected", "smtp send failed", etc.
      const apiErr = err as { status?: number; statusCode?: number; body?: unknown };
      const status = apiErr.status ?? apiErr.statusCode;
      const body = apiErr.body ?? (err as Error).message;
      this.logger.error(
        `[magic-link] Failed for userId=${userId} email=${email} status=${status ?? '-'} body=${JSON.stringify(body)}`,
        err instanceof Error ? err.stack : undefined,
      );
      // Re-throw so BullMQ records the failure (retry / dead-letter visibility).
      throw err;
    }
  }
}
