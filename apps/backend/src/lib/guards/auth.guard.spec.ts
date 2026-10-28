import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';

import { AmrEnum } from 'src/shared/enums/auth.enum';

import { lean } from 'src/testing/db-mocks';

const joseMocks = { jwtVerify: jest.fn(), createRemoteJWKSet: jest.fn(() => 'jwks') };
jest.mock('jose', () => ({
  jwtVerify: (...a: unknown[]) => joseMocks.jwtVerify(...a),
  createRemoteJWKSet: () => joseMocks.createRemoteJWKSet(),
}));

import { AuthGuard } from './auth.guard';

const basePayload = {
  sub: 'user-1',
  email: 'u@example.com',
  role: { id: 'r', permissions: [] },
  sid: 'sess-1',
  iat: Math.floor(Date.now() / 1000),
};

function build(opts: { isPublic?: boolean } = {}) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(opts.isPublic ?? false),
  } as unknown as Reflector;
  const config = {
    get: (k: string) => (k === 'BACKEND_URL' ? 'http://localhost:5000' : undefined),
  } as unknown as ConfigService;
  const invalidatedTokenModel = { findOne: jest.fn().mockReturnValue(lean(null)) };
  const guard = new AuthGuard(reflector, config, invalidatedTokenModel as never);
  return { guard, invalidatedTokenModel };
}

function ctx(headers: Record<string, string> = {}): {
  context: ExecutionContext;
  request: { user?: unknown };
} {
  const request: { headers: Record<string, string>; user?: unknown } = { headers };
  return {
    request,
    context: {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
}

beforeEach(() => {
  joseMocks.jwtVerify.mockReset();
  joseMocks.jwtVerify.mockResolvedValue({ payload: basePayload });
});

describe('AuthGuard', () => {
  it('allows public routes without a token', async () => {
    const { guard } = build({ isPublic: true });
    await expect(guard.canActivate(ctx().context)).resolves.toBe(true);
  });

  it('401 when no Bearer token is present', async () => {
    const { guard } = build();
    await expect(guard.canActivate(ctx().context)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      guard.canActivate(ctx({ authorization: 'Basic xyz' }).context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401 when jwtVerify throws (bad signature / wrong iss-aud)', async () => {
    const { guard } = build();
    joseMocks.jwtVerify.mockRejectedValue(new Error('bad'));
    await expect(
      guard.canActivate(ctx({ authorization: 'Bearer tok' }).context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401 when a matching invalidation row exists (post sign-out token)', async () => {
    const { guard, invalidatedTokenModel } = build();
    invalidatedTokenModel.findOne.mockReturnValue(
      lean({ userId: 'user-1', invalidatedAt: new Date() }),
    );
    await expect(
      guard.canActivate(ctx({ authorization: 'Bearer tok' }).context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the mapped user on success', async () => {
    const { guard } = build();
    const c = ctx({ authorization: 'Bearer tok' });
    await expect(guard.canActivate(c.context)).resolves.toBe(true);
    expect(c.request.user).toMatchObject({ id: 'user-1', sid: 'sess-1' });
  });

  it('defaults aal=1 and amr=[PWD] for legacy tokens without MFA claims', async () => {
    const { guard } = build();
    joseMocks.jwtVerify.mockResolvedValue({
      payload: { ...basePayload, aal: undefined, amr: undefined },
    });
    const c = ctx({ authorization: 'Bearer tok' });
    await guard.canActivate(c.context);
    expect(c.request.user).toMatchObject({ aal: 1, amr: [AmrEnum.PWD] });
  });
});
