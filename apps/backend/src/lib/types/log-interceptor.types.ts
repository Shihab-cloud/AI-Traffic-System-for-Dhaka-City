export interface RequestData {
  requestId: string;
  method: string;
  url: string;
  ip: string;
  userAgent: string;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}

export interface ResponseData {
  statusCode: number;
  duration: number;
  responseBody?: unknown;
  error?: {
    message: string;
    stack?: string;
    response?: unknown;
  };
}

export interface HttpRequestLogData {
  requestId: string;
  method: string;
  url: string;
  duration: number;
  request: {
    ip: string;
    userAgent: string;
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
    headers?: Record<string, unknown>;
  };
  response: {
    statusCode: number;
    body?: unknown;
    error?: Record<string, any>;
  };
  timestamp: string;
  type: 'http_request';
}

export interface HttpError extends Error {
  status?: number;
  response?: unknown;
}
