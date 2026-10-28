import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { AllExceptionsFilter } from './exception-filter';

/**
 * Covers the structured-body contract both frontends depend on: they branch on
 * `data?.error === 'step_up_required'`, so the filter must not flatten an
 * object response to `exception.message` — which Nest populates only for
 * *string* responses, and otherwise reports as `"Http Exception"`.
 */
function setup() {
  const replies: { body: unknown; status: number }[] = [];
  const httpAdapterHost = {
    httpAdapter: {
      getRequestUrl: () => '/api/rbac/roles/abc',
      reply: (_res: unknown, body: unknown, status: number) => replies.push({ body, status }),
    },
  } as unknown as HttpAdapterHost;

  const host = {
    switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
  } as unknown as ArgumentsHost;

  return { filter: new AllExceptionsFilter(httpAdapterHost), host, replies };
}

function bodyOf(exception: unknown): Record<string, unknown> {
  const { filter, host, replies } = setup();
  filter.catch(exception, host);
  return replies[0].body as Record<string, unknown>;
}

describe('AllExceptionsFilter', () => {
  it('preserves a structured payload so the step-up flow can read it', () => {
    const body = bodyOf(
      new HttpException({ error: 'step_up_required', scope: 'ROLE:UPDATE' }, 401),
    );

    expect(body).toMatchObject({
      statusCode: 401,
      error: 'step_up_required',
      scope: 'ROLE:UPDATE',
    });
    // The flattened form the frontends cannot read.
    expect(body.message).not.toBe('Http Exception');
  });

  it('preserves retryAfter on a rate-limit rejection', () => {
    const body = bodyOf(
      new HttpException(
        { error: 'rate_limited', message: 'Too many requests.', retryAfter: 60 },
        429,
      ),
    );

    expect(body).toMatchObject({ statusCode: 429, error: 'rate_limited', retryAfter: 60 });
  });

  it('still handles a plain string exception', () => {
    const body = bodyOf(new HttpException('Invalid admin setup token', HttpStatus.FORBIDDEN));

    expect(body).toMatchObject({ statusCode: 403, message: 'Invalid admin setup token' });
  });

  it('keeps the validation-pipe message array intact', () => {
    const body = bodyOf(new BadRequestException({ message: ['email must be an email'] }));

    expect(body.statusCode).toBe(400);
    expect(body.message).toEqual(['email must be an email']);
  });

  it('always stamps timestamp and path', () => {
    const body = bodyOf(new HttpException({ error: 'x' }, 400));

    expect(typeof body.timestamp).toBe('string');
    expect(body.path).toBe('/api/rbac/roles/abc');
  });

  it('does not let a thrown payload forge the status code or path', () => {
    // A payload is attacker-influenced wherever a message echoes user input, so
    // the fields the filter owns must win.
    const body = bodyOf(
      new HttpException({ statusCode: 200, path: '/somewhere-else', error: 'nope' }, 403),
    );

    expect(body.statusCode).toBe(403);
    expect(body.path).toBe('/api/rbac/roles/abc');
    expect(body.error).toBe('nope');
  });

  it('never leaks an internal error to the client', () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const body = bodyOf(new Error('connect ECONNREFUSED 10.0.0.5:27017'));

    expect(body).toMatchObject({ statusCode: 500, message: 'Internal Server Error' });
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    // It is still logged server-side.
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('replaces a 5xx HttpException payload rather than spreading it', () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const body = bodyOf(
      new HttpException({ message: 'pool exhausted at mongo://10.0.0.5' }, HttpStatus.BAD_GATEWAY),
    );

    expect(body).toMatchObject({ statusCode: 502, message: 'Internal Server Error' });
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
    logged.mockRestore();
  });
});
