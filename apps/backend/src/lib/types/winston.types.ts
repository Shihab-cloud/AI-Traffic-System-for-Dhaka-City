import * as winston from 'winston';

export interface LogInfo extends winston.Logform.TransformableInfo {
  context?: string;
  trace?: string | Error | object;
}
