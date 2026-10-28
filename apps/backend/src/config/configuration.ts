export default () => ({
  APP_NAME: process.env.APP_NAME || 'NestJS APP',
  APP_VERSION: process.env.APP_VERSION || 'local',

  NODE_ENV: process.env.NODE_ENV || 'development',

  PORT: process.env.PORT || 5000,

  DATABASE_URL: process.env.DATABASE_URL || 'mongodb://localhost/nestjs',

  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',

  BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:5000',

  // Header token for the bootstrap admin-create endpoint. Override in every
  // real environment — the fallback is a placeholder for local dev only.
  ADMIN_SETUP_TOKEN: process.env.ADMIN_SETUP_TOKEN || 'replace-with-admin-setup-token',

  // better-auth — required by the BetterAuth provider (throws if unset).
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  // JWT lifetime (seconds) for better-auth's jwt plugin + the sign-out blocklist TTL semantics.
  JWT_EXPIRY_SECONDS: process.env.JWT_EXPIRY_SECONDS || 900,

  // Google OAuth (better-auth social provider). Optional — Google login is
  // enabled only when both are present.
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,

  // MFA — 32-byte base64 KEK. The EnvKekAdapter THROWS at startup if unset, so
  // there is intentionally no default here.
  MFA_KEK_B64: process.env.MFA_KEK_B64,

  // Firebase (FCM web push notifications). Optional — push is enabled only when
  // all three are present.
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,

  // Notification fan-out chunk size (mirrors drizzle's default of 100).
  NOTIFICATION_BROADCAST_CHUNK_SIZE: process.env.NOTIFICATION_BROADCAST_CHUNK_SIZE
    ? Number(process.env.NOTIFICATION_BROADCAST_CHUNK_SIZE)
    : 100,

  FRONTEND_RESET_PASSWORD_URL:
    process.env.FRONTEND_RESET_PASSWORD_URL || 'http://localhost:3000/auth/reset-password/',

  RESET_TOKEN_SECRET: process.env.RESET_TOKEN_SECRET || 'RESET_TOKEN',
  RESET_TOKEN_EXPIRATION_TIME: process.env.RESET_TOKEN_EXPIRATION_TIME || 86400000,

  MAIL_HOST: process.env.MAIL_HOST || 'smtp.mailtrap.io',
  MAIL_PORT: process.env.MAIL_PORT || 2525,
  MAIL_USER: process.env.MAIL_USER || 'user',
  MAIL_PASS: process.env.MAIL_PASS || 'pass',
  MAIL_FROM: process.env.MAIL_FROM || 'No Reply',

  AWS_S3_BUCKET_NAME: process.env.AWS_S3_BUCKET_NAME || 'bucket-name',
  AWS_S3_BUCKET_REGION: process.env.AWS_S3_BUCKET_REGION || 'us-east-1',
  // Without static keys the S3 client resolves credentials through the SDK's
  // default provider chain (task role in prod, SSO locally). The endpoint and
  // static keys are for S3-compatible stores (SeaweedFS locally).
  AWS_S3_ENDPOINT: process.env.AWS_S3_ENDPOINT || '',
  AWS_S3_ACCESS_KEY: process.env.AWS_S3_ACCESS_KEY || '',
  AWS_S3_SECRET_ACCESS_KEY: process.env.AWS_S3_SECRET_ACCESS_KEY || '',

  // Traffic enforcement
  VISION_URL: process.env.VISION_URL || 'http://127.0.0.1:8601',
  VISION_KEY: process.env.VISION_KEY,
  VISION_PUBLIC_URL: process.env.VISION_PUBLIC_URL || process.env.VISION_URL || 'http://127.0.0.1:8601',
  VLM_PROVIDER: process.env.VLM_PROVIDER || 'local',
  VLM_MODEL: process.env.VLM_MODEL || 'claude-opus-5-5',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER || 'sandbox',
  CURRENCY: process.env.CURRENCY || 'BDT',

  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: process.env.REDIS_PORT || 6379,

  logger: {
    enableLogs: process.env.ENABLE_LOGS === 'true',
    logDir: process.env.LOG_DIR,
    saveFileLogs: process.env.SAVE_LOG_FILES === 'true',
    disableConsoleLogs: process.env.DISABLE_CONSOLE_LOGS === 'true',
    logRotateMaxSize: process.env.LOG_ROTATE_MAX_SIZE,
    logRotateMaxFiles: process.env.LOG_ROTATE_MAX_FILES,
  },
});
