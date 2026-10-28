import DailyRotateFile from 'winston-daily-rotate-file';
import * as winston from 'winston';

import { consoleLogFormat, fileLogFormat } from './winston-format.config';

import { ConfigService } from '@nestjs/config';

export const createWinstonLogger = (configService: ConfigService) => {
  const logLevel = configService.get('NODE_ENV') === 'production' ? 'info' : 'debug';
  const logDir = configService.get<string>('logger.logDir') || 'logs';
  const disableConsoleLog = configService.get<boolean>('logger.disableConsoleLogs');
  const saveFileLogs = configService.get<boolean>('logger.saveFileLogs');
  const logRotateMaxSize = configService.get<string>('logger.logRotateMaxSize');
  const logRotateMaxFiles = configService.get<string>('logger.logRotateMaxFiles');

  const ROTATE_CONFIG = {
    dirname: logDir,
    datePattern: 'YYYY-MM-DD',
    utc: true,
    zippedArchive: false,
    maxSize: logRotateMaxSize,
    maxFiles: logRotateMaxFiles,
    format: fileLogFormat,
  };

  const transports: winston.transport[] = [];

  if (saveFileLogs) {
    const dailyRotateFileTransport = new DailyRotateFile({
      filename: 'application-%DATE%.log',
      ...ROTATE_CONFIG,
      level: 'info',
    });

    const errorFileTransport = new DailyRotateFile({
      filename: 'error-%DATE%.log',
      level: 'error',
      ...ROTATE_CONFIG,
    });

    transports.push(dailyRotateFileTransport, errorFileTransport);
  }

  // Always add console transport (can be silenced via DISABLE_CONSOLE_LOGS)
  const consoleTransport = new winston.transports.Console({
    format: consoleLogFormat,
    silent: disableConsoleLog,
  });

  transports.push(consoleTransport);

  return winston.createLogger({
    level: logLevel,
    transports,
    exitOnError: false,
  });
};
