import { WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';

/**
 * Closes every BullMQ WorkerHost on SIGTERM so in-flight jobs finish (or become
 * visible-to-retry) before the container exits. Loaded by AppModule — so a
 * blue-green deploy drains in-flight jobs instead of killing them.
 */
@Injectable()
export class WorkerLifecycleService implements OnApplicationShutdown {
  private readonly logger = new Logger(WorkerLifecycleService.name);

  constructor(private readonly discovery: DiscoveryService) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Draining BullMQ workers (signal=${signal ?? 'unknown'})`);

    const workers = this.discovery
      .getProviders()
      .map((wrapper): unknown => wrapper.instance)
      .filter((instance): instance is WorkerHost => instance instanceof WorkerHost);

    if (workers.length === 0) {
      this.logger.log('No BullMQ workers found to drain');
      return;
    }

    await Promise.all(
      workers.map(async (host) => {
        try {
          await host.worker.close();
        } catch (err) {
          this.logger.error(`Failed to close worker ${host.constructor.name}`, err as Error);
        }
      }),
    );
    this.logger.log(`Closed ${workers.length} BullMQ worker(s)`);
  }
}
