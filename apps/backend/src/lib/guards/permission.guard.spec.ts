import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { PermissionsEnum } from 'src/shared/enums/permission.enum';

import { PermissionsGuard } from './permission.guard';

function ctxFor(user: unknown): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardWithMeta(meta: unknown) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(meta) } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

const userWith = (perms: PermissionsEnum[]) => ({ role: { permissions: perms } });

describe('PermissionsGuard', () => {
  it('allows any route with no @Permissions metadata', () => {
    expect(guardWithMeta(undefined).canActivate(ctxFor(userWith([])))).toBe(true);
  });

  it('403 when the user lacks the required permission', () => {
    const guard = guardWithMeta({ permissions: [PermissionsEnum.CREATE_USER] });
    expect(() => guard.canActivate(ctxFor(userWith([])))).toThrow(ForbiddenException);
  });

  it('allows when the user has at least one permission (default OR)', () => {
    const guard = guardWithMeta({
      permissions: [PermissionsEnum.CREATE_USER, PermissionsEnum.DELETE_USER],
    });
    expect(guard.canActivate(ctxFor(userWith([PermissionsEnum.CREATE_USER])))).toBe(true);
  });

  it('requiredAll denies when only some permissions are held', () => {
    const guard = guardWithMeta({
      permissions: [PermissionsEnum.CREATE_USER, PermissionsEnum.DELETE_USER],
      requiredAll: true,
    });
    expect(() => guard.canActivate(ctxFor(userWith([PermissionsEnum.CREATE_USER])))).toThrow(
      ForbiddenException,
    );
  });

  it('requiredAll allows when every permission is held', () => {
    const guard = guardWithMeta({
      permissions: [PermissionsEnum.CREATE_USER, PermissionsEnum.DELETE_USER],
      requiredAll: true,
    });
    expect(
      guard.canActivate(
        ctxFor(userWith([PermissionsEnum.CREATE_USER, PermissionsEnum.DELETE_USER])),
      ),
    ).toBe(true);
  });

  it('403 when the user has no role at all', () => {
    const guard = guardWithMeta({ permissions: [PermissionsEnum.CREATE_USER] });
    expect(() => guard.canActivate(ctxFor({}))).toThrow(ForbiddenException);
  });
});
