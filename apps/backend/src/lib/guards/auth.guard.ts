import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Request } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { IS_PUBLIC_KEY } from 'src/lib/decorators/auth.decorator';
import { InvalidatedToken, InvalidatedTokenModel } from 'src/schemas/auth/token.schema';
import { AmrEnum } from 'src/shared/enums/auth.enum';
import type { JwtPayload } from '../types/token.type';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly backendUrl: string;

  constructor(
    private reflector: Reflector,
    private configService: ConfigService,
    @Inject(getModelToken(InvalidatedToken.name))
    private invalidatedTokenModel: InvalidatedTokenModel,
  ) {
    this.backendUrl =
      this.configService.get<string>('BACKEND_URL') ||
      `http://localhost:${this.configService.get<number>('PORT') || 5000}`;
    this.jwks = createRemoteJWKSet(new URL(`${this.backendUrl}/api/auth/jwks`));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);
    if (!token) throw new UnauthorizedException('No token provided');

    let payload: JwtPayload;
    try {
      // iss/aud are pinned to BACKEND_URL in better-auth's jwt plugin config —
      // reject tokens minted by any other issuer or for any other audience.
      const result = await jwtVerify(token, this.jwks, {
        issuer: this.backendUrl,
        audience: this.backendUrl,
      });
      payload = result.payload as unknown as JwtPayload;
    } catch (e) {
      // A bad token and an unreachable JWKS endpoint both land here, and to
      // the client they look identical — 401. Logging the difference is what
      // separates "one user typed something wrong" from "every request in the
      // API is failing because /api/auth/jwks is down".
      this.logger.debug(`JWT verification failed: ${e instanceof Error ? e.message : String(e)}`);
      throw new UnauthorizedException();
    }

    // Reject tokens issued before the user's last sign-out / forced invalidation
    // (mirrors backend-drizzle's Redis blocklist, backed here by the
    // InvalidatedToken collection).
    const invalidation = await this.invalidatedTokenModel
      .findOne({
        userId: payload.sub,
        invalidatedAt: { $gt: new Date(payload.iat * 1000) },
      })
      .lean();
    if (invalidation) {
      throw new UnauthorizedException();
    }

    request.user = {
      id: payload.sub,
      email: payload.email ?? null,
      role: payload.role,
      sid: payload.sid,
      // Default to AAL1 for tokens issued before the MFA module shipped — they
      // simply don't carry `aal`/`amr`/`mfa_at` claims. Step-up gate decides
      // whether AAL1 is sufficient on a per-route basis.
      aal: payload.aal ?? 1,
      amr: payload.amr ?? [AmrEnum.PWD],
      mfa_at: payload.mfa_at,
      enrollment_required: payload.enrollment_required,
      activation_required: payload.activation_required,
    };
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
