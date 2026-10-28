import {
  BadRequestException,
  ClassSerializerInterceptor,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import express from 'express';
import { AppModule } from './app.module';
import { validateEnv } from './config/env.schema';
import { mergeBetterAuthOpenAPI } from './lib/auth/better-auth-openapi';
import { LoggingInterceptor } from './lib/interceptors/logging.interceptor';
import { BETTER_AUTH, BetterAuthInstance } from './lib/providers/better-auth.provider';
import { logStartupInfo } from './utils/log-startup-info.util';
import { flattenValidationErrors } from './utils/validation.util';

/** JSON/urlencoded body ceiling. Uploads never reach this parser. */
const BODY_LIMIT = '1mb';

async function bootstrap() {
  validateEnv();

  // Uncomment to run migrations before starting the app
  // await MigrationClient.run();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false, // Required — better-auth needs raw request access
  });

  const configService = app.get<ConfigService>(ConfigService);
  const port = configService.get<number>('PORT') || 5001;

  // SSLCommerz sends the payer's browser back from its own page with a form POST, which carries its Origin. That is
  // a page navigation, not a cross-origin XHR, and these routes trust nothing in the post (the payment is confirmed
  // with SSLCommerz's validation API), so the CORS origin check below does not apply to them. Registered first.
  app.use('/api/payments/sslcommerz', (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    delete req.headers.origin;
    next();
  });

  // CORS — the data API (/api/*) is called cross-origin with a Bearer JWT
  // Requests with no Origin (curl, server-to-server, the frontend's
  // auth proxy) pass through. Auth (/api/auth/*) is same-origin via that proxy.
  app.enableCors({
    origin: (origin, callback) => {
      if (
        !origin ||
        [
          configService.get<string>('FRONTEND_URL'),
          configService.get<string>('BACKEND_URL'),
        ].includes(origin)
      )
        return callback(null, true);
      // The rejected origin is attacker-controlled, so it is not echoed into
      // the response body or the request log.
      callback(new ForbiddenException('Origin not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
  });

  // Mount better-auth BEFORE global prefix
  const { auth, handler } = app.get<BetterAuthInstance>(BETTER_AUTH);

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.all('/api/auth/*splat', handler);

  // 1MB, not 50MB. The body is parsed before any guard runs, so the limit is
  // the only thing standing between an unauthenticated caller and 50MB of heap
  // per connection. File uploads do not pass through here — they are multipart
  // (FileInterceptor, with its own size validator) or go straight to S3 on a
  // presigned URL.
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

  app.useGlobalPipes(
    new ValidationPipe({
      enableDebugMessages: true,
      transform: true,
      // Strip body properties the DTO does not declare. Without it, any handler
      // that spreads its DTO into an update writes whatever the caller sent
      // (`roleId`, `status`, `emailVerified`). Stripping rather than
      // `forbidNonWhitelisted` so a harmless extra field is not a 400.
      whitelist: true,
      exceptionFactory: (errors) => new BadRequestException(flattenValidationErrors(errors)),
    }),
  );

  const loggingInterceptor = app.get(LoggingInterceptor);
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector), {
      excludeExtraneousValues: true,
      enableImplicitConversion: true,
    }),
    loggingInterceptor,
  );

  // Swagger
  const options = new DocumentBuilder()
    .addServer('/api')
    .setTitle('API Doc')
    .setDescription('The API description')
    .addBearerAuth()
    .addSecurityRequirements('bearer')
    .setVersion('1.0')
    .build();

  // Off in production unless asked for. The document names every route, its
  // DTO shape and its required permission — a free map of the API's attack
  // surface, served unauthenticated.
  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_API_DOCS === 'true') {
    const document = SwaggerModule.createDocument(app, options);
    await mergeBetterAuthOpenAPI(auth, document);

    SwaggerModule.setup('swagger', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    app.use('/reference', apiReference({ content: document }));
  }

  // Global prefix — but expose /health and /ready unprefixed for ALB / ECS
  // health check probes that aren't aware of the API namespace.
  app.setGlobalPrefix('api', {
    exclude: ['health', 'ready'],
  });

  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');
  await logStartupInfo(app);
}

bootstrap().catch((err) => {
  console.error('Error during bootstrap:', err);
  process.exit(1);
});
