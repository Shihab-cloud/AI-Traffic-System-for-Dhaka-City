import * as winston from 'winston';

import { LogInfo } from 'src/lib/types/winston.types';

export const fileLogFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS',
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, context, trace, ...meta }) => {
    const isoTimestamp = new Date(timestamp as string)
      .toISOString()
      .replace('T', ' ')
      .replace('Z', '');
    return JSON.stringify({
      timestamp: isoTimestamp,
      level,
      context: context || 'Application',
      message,
      trace,
      ...meta,
    });
  }),
);

// Console format - Human readable, concise output
export const consoleLogFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS',
  }),
  winston.format.printf((info: LogInfo) => {
    const { timestamp, level, message, context, trace, logType, ...meta } = info;
    const isoTime = new Date(timestamp as string).toISOString().replace('T', ' ').replace('Z', '');

    // Check if this is an HTTP request log for special styling
    const isHttpRequest = logType === 'http_request';

    const metaStr = Object.keys(meta).length ? `\n\x1b[90m${JSON.stringify(meta)}\x1b[0m` : '';
    const traceStr =
      trace instanceof Error ? `\n${trace.stack}` : trace ? `\n${JSON.stringify(trace)}` : '';

    const styledMessage = isHttpRequest
      ? `\x1b[36m${typeof message === 'string' ? message : JSON.stringify(message)}\x1b[0m`
      : typeof message === 'string'
        ? message
        : JSON.stringify(message);

    return `${isoTime} [${
      typeof context === 'string' ? context : 'Application'
    }] ${level}: ${styledMessage}${metaStr}${traceStr}`;
  }),
);
