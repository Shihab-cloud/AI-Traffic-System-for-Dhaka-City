import * as winston from 'winston';

import { Injectable, LogLevel, LoggerService as NestLoggerService } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import { createWinstonLogger } from './config/winston.config';

@Injectable()
export class LoggerService implements NestLoggerService {
  private logger: winston.Logger;
  constructor(private configService: ConfigService) {
    this.logger = createWinstonLogger(this.configService);
  }

  log(message: string, context?: string, metadata?: Record<string, any>) {
    this.logger.info(message, { context, ...metadata });
  }

  error(message: string, trace?: string, context?: string, metadata?: Record<string, any>) {
    this.logger.error(message, { trace, context, ...metadata });
  }

  warn(message: string, context?: string, metadata?: Record<string, any>) {
    this.logger.warn(message, { context, ...metadata });
  }

  debug(message: string, context?: string, metadata?: Record<string, any>) {
    this.logger.debug(message, { context, ...metadata });
  }

  verbose(message: string, context?: string, metadata?: Record<string, any>) {
    this.logger.verbose(message, { context, ...metadata });
  }

  fatal(message: string, context?: string, metadata?: Record<string, any>) {
    this.logger.error(message, { context, ...metadata });
  }

  setLogLevels(levels: LogLevel[]) {
    this.logger.level = levels[0];
  }

  errorWithMetadata({
    message,
    metadata,
    trace,
    context,
  }: {
    message: string;
    metadata: Record<string, any>;
    trace?: string;
    context?: string;
  }) {
    this.error(message, trace, context, metadata);
  }

  // Method to log HTTP requests with distinct styling
  logHttpRequest({
    message,
    metadata,
    context,
  }: {
    message: string;
    metadata: Record<string, any>;
    context?: string;
  }) {
    // Use a special context marker for HTTP request logs
    const httpContext = `HTTP-${context || 'Request'}`;
    this.log(message, httpContext, {
      ...metadata,
      logType: 'http_request', // Special marker for styling
    });
  }
}
