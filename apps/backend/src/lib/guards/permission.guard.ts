import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PERMISSION_KEY, PermissionMetadata } from '../decorators/permissions.decorator';
import type { CurrentUser } from '../decorators/user.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = this.reflector.getAllAndOverride<PermissionMetadata>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return true;

    const { user } = context.switchToHttp().getRequest<Request & { user?: CurrentUser }>();
    const userPermissions: string[] = user?.role?.permissions ?? [];

    const hasPermission = meta.requiredAll
      ? meta.permissions.every((p) => userPermissions.includes(p))
      : meta.permissions.some((p) => userPermissions.includes(p));

    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
