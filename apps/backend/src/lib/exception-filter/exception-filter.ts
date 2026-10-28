import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import { HttpAdapterHost } from '@nestjs/core';

/** Fields this filter owns; a thrown payload must not be able to forge them. */
const RESERVED_KEYS = ['statusCode', 'timestamp', 'path'] as const;

// `HttpException.getStatus()` returns a plain `number`, so compare against the
// enum's numeric value to keep both operands number-typed (no-unsafe-enum-comparison).
const SERVER_ERROR_THRESHOLD: number = HttpStatus.INTERNAL_SERVER_ERROR;
const CLIENT_ERROR_THRESHOLD: number = HttpStatus.BAD_REQUEST;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // In certain situations `httpAdapter` might not be available in the
    // constructor method, thus we should resolve it here.
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();

    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const path = String(httpAdapter.getRequestUrl(ctx.getRequest()));
    const payload = this.payloadOf(exception, statusCode);

    const responseBody = {
      statusCode,
      ...payload,
      timestamp: new Date().toISOString(),
      path,
    };

    if (statusCode >= SERVER_ERROR_THRESHOLD) {
      this.logger.error(
        `Unhandled ${statusCode} on ${path}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (statusCode >= CLIENT_ERROR_THRESHOLD) {
      // Surface 4xx detail in backend logs so reasons are visible without
      // attaching a debugger. Trims noise: only logs path + status + the
      // structured fields, never `message` (already implied by the status).
      const extras = Object.fromEntries(
        Object.entries(payload).filter(([key]) => key !== 'message'),
      );
      const detail = Object.keys(extras).length > 0 ? ` ${JSON.stringify(extras)}` : '';
      this.logger.warn(`${statusCode} ${path}${detail}`);
    }

    httpAdapter.reply(ctx.getResponse(), responseBody, statusCode);
  }

  /**
   * The part of the response that comes from the thrown exception.
   *
   * Object payloads pass through as-is, because the app's protocols live in
   * them: `{ error: 'step_up_required', scope }` drives the frontend's
   * challenge dialog, `retryAfter` drives its back-off. Nest only populates
   * `HttpException.message` from a *string* response — given an object it is
   * the literal `"Http Exception"` — so carrying that through says nothing.
   *
   * `RESERVED_KEYS` are stripped first: a thrown body must not overwrite the
   * real status code or forge the request path. Anything 5xx is replaced
   * wholesale, whether or not it arrived as an `HttpException`, since a server
   * fault's detail is for the log and not for the client.
   */
  private payloadOf(exception: unknown, statusCode: number): Record<string, unknown> {
    if (statusCode >= SERVER_ERROR_THRESHOLD || !(exception instanceof HttpException)) {
      return { message: 'Internal Server Error' };
    }

    const response = exception.getResponse();

    if (typeof response === 'string') return { message: response };

    if (response && typeof response === 'object') {
      const payload = { ...(response as Record<string, unknown>) };
      for (const key of RESERVED_KEYS) delete payload[key];
      return payload;
    }

    return { message: exception.message };
  }
}
