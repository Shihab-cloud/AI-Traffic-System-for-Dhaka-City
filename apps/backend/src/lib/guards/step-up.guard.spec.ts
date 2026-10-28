import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { MfaStepUpScope } from 'src/shared/enums/mfa.enum';

// Both services transitively import the ESM-only `better-auth`; the guard only
// needs injected stubs, so replace the modules wholesale.
jest.mock('src/modules/auth/mfa/services/mfa.service', () => ({ MfaService: class {} }));
jest.mock('src/modules/auth/mfa/services/step-up.service', () => ({ StepUpService: class {} }));

import { StepUpGuard } from './step-up.guard';

const SCOPE = MfaStepUpScope.ROLE_CREATE;

function build(scope: MfaStepUpScope | undefined, when?: (request: never) => boolean) {
  const requirement = scope === undefined ? undefined : { scope, when };
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requirement),
  } as unknown as Reflector;
  const stepUp = { consumeToken: jest.fn() };
  const mfa = { canAnswerStepUp: jest.fn() };
  const guard = new StepUpGuard(reflector, stepUp as never, mfa as never);
  return { guard, stepUp, mfa };
}

function ctx(user: unknown, headers: Record<string, unknown> = {}): ExecutionContext {
  const request = {
    user,
    headers,
    ip: '198.51.100.7',
    socket: { remoteAddress: '198.51.100.7' },
  };
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const user = { id: 'u-1', sid: 's-1' };

describe('StepUpGuard', () => {
  it('allows routes with no @RequiresStepUp scope', async () => {
    const { guard } = build(undefined);
    await expect(guard.canActivate(ctx(user))).resolves.toBe(true);
  });

  it('skips the gate when the requirement’s condition does not hold', async () => {
    // Routes that only sometimes carry a sensitive change (a profile save that
    // happens not to touch the email) must not demand a factor the user has
    // never enrolled.
    const { guard, stepUp, mfa } = build(SCOPE, () => false);

    await expect(guard.canActivate(ctx(user))).resolves.toBe(true);
    expect(stepUp.consumeToken).not.toHaveBeenCalled();
    expect(mfa.canAnswerStepUp).not.toHaveBeenCalled();
  });

  it('still enforces the gate when the condition holds', async () => {
    const { guard, mfa } = build(SCOPE, () => true);
    mfa.canAnswerStepUp.mockResolvedValue(true);

    await expect(guard.canActivate(ctx(user))).rejects.toMatchObject({ status: 401 });
  });

  it('401 no_session_id when the user has no sid', async () => {
    const { guard, stepUp } = build(SCOPE);

    await expect(guard.canActivate(ctx({ id: 'u-1' }))).rejects.toMatchObject({
      status: 401,
      response: { error: 'step_up_required', reason: 'no_session_id' },
    });
    expect(stepUp.consumeToken).not.toHaveBeenCalled();
  });

  it('fails closed when the user cannot answer a challenge, pointing at enrollment', async () => {
    const { guard, mfa, stepUp } = build(SCOPE);
    mfa.canAnswerStepUp.mockResolvedValue(false);

    await expect(guard.canActivate(ctx(user))).rejects.toMatchObject({
      response: { error: 'step_up_required', reason: 'enroll_required' },
    });
    expect(stepUp.consumeToken).not.toHaveBeenCalled();
  });

  it('401 step_up_required, with no enrollment hint, when a capable user sends no token', async () => {
    const { guard, mfa } = build(SCOPE);
    mfa.canAnswerStepUp.mockResolvedValue(true);

    const err = await guard.canActivate(ctx(user, {})).catch((e: HttpException) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(401);
    expect((err as HttpException).getResponse()).toEqual({
      error: 'step_up_required',
      scope: SCOPE,
    });
  });

  it('401 invalid_step_up_token when the token fails to consume', async () => {
    const { guard, mfa, stepUp } = build(SCOPE);
    mfa.canAnswerStepUp.mockResolvedValue(true);
    stepUp.consumeToken.mockResolvedValue(false);

    await expect(
      guard.canActivate(ctx(user, { 'authorization-step-up': 'tok' })),
    ).rejects.toMatchObject({ status: 401, response: { scope: SCOPE } });
  });

  it('does not spend a database round trip deciding the reason when a token is present', async () => {
    const { guard, mfa, stepUp } = build(SCOPE);
    stepUp.consumeToken.mockResolvedValue(true);

    await guard.canActivate(ctx(user, { 'authorization-step-up': 'tok' }));

    expect(mfa.canAnswerStepUp).not.toHaveBeenCalled();
  });

  it('allows when a valid step-up token is consumed with the right binding', async () => {
    const { guard, mfa, stepUp } = build(SCOPE);
    mfa.canAnswerStepUp.mockResolvedValue(true);
    stepUp.consumeToken.mockResolvedValue(true);
    await expect(guard.canActivate(ctx(user, { 'authorization-step-up': 'tok' }))).resolves.toBe(
      true,
    );
    expect(stepUp.consumeToken).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSub: 'u-1', expectedSid: 's-1', expectedScope: SCOPE }),
    );
  });
});
