import { INestApplication, Logger } from '@nestjs/common';

export async function logStartupInfo(app: INestApplication) {
  const logger = new Logger('StartupInfo');

  try {
    const appUrl = await app.getUrl();

    logger.verbose(`📍 Application started on: ${appUrl}/api`);
    logger.verbose(`📚 Swagger Documentation: ${appUrl}/swagger`);
    logger.verbose(`📖 API Reference: ${appUrl}/reference`);

    // Worker-status logging omitted here — processors register in the same
    // process and drain via WorkerLifecycleService on shutdown.
  } catch (error) {
    logger.error('❌ Error during startup logging:', error);
  }
}
