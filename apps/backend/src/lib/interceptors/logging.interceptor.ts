import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { HttpError, RequestData, ResponseData } from '../types/log-interceptor.types';
import { Request, Response } from 'express';
import { catchError, tap } from 'rxjs/operators';
import {
  generateHttpRequestLogData,
  generateRequestData,
  sanitizeResponseBody,
} from '../../utils/logging-interceptor.utils';

import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger/logger.service';
import { Observable } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // `logger.enableLogs`, not the raw key: `ENABLE_LOGS` is not on the config
    // object, so `ConfigService` falls through to `process.env` and returns the
    // string `"false"` — truthy.
    const enableLogs = this.configService.get<boolean>('logger.enableLogs');
    if (!enableLogs) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const startTime = Date.now();

    const requestData = generateRequestData(request);

    return next.handle().pipe(
      tap((responseBody: unknown) => {
        const duration = Date.now() - startTime;
        const response = context.switchToHttp().getResponse<Response>();
        const statusCode = response.statusCode;

        // Log complete request/response in single entry
        this.logCompleteRequest(requestData, {
          statusCode,
          duration,
          responseBody: sanitizeResponseBody(responseBody),
        });
      }),
      catchError((error: HttpError) => {
        const duration = Date.now() - startTime;
        const statusCode = error.status || 500;

        this.logger.errorWithMetadata({
          message: `Request failed`,
          metadata: {
            statusCode,
            duration,
            errorMessage: error.message,
            errorStack: error.stack,
            timestamp: new Date().toISOString(),
            type: 'request_error',
          },
          trace: error.stack,
          context: 'LoggingInterceptor',
        });

        throw error;
      }),
    );
  }

  private logCompleteRequest(requestData: RequestData, responseData: ResponseData): void {
    const logData = generateHttpRequestLogData(requestData, responseData);

    this.logger.logHttpRequest({
      message: `${requestData.method} ${requestData.url} - ${responseData.statusCode} (${responseData.duration}ms)`,
      metadata: logData,
      context: 'LoggingInterceptor',
    });
  }
}
