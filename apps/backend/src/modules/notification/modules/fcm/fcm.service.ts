import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import { DeviceTokenService } from './device-token.service';

const STALE_ERROR_CODES = new Set([
  'messaging/invalid-argument',
  'messaging/registration-token-not-registered',
]);

export interface FcmMulticastResult {
  status: 'SENT' | 'FAILED' | 'NO_TOKENS';
}

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private app: App | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly deviceTokenService: DeviceTokenService,
  ) {}

  onModuleInit(): void {
    this.initializeFirebaseAdmin();
  }

  /**
   * Initializes the Firebase Admin SDK.
   *
   * If the required environment variables are absent the service logs a warning
   * and disables itself gracefully — FCM deliver calls will return FCM_FAILED
   * without throwing, allowing the rest of the notification pipeline to proceed.
   *
   * Reuses an already-initialized app when one exists (e.g., NestJS hot reload
   * or multi-module scenarios) to prevent "app already exists" errors from the
   * Firebase SDK.
   */
  private initializeFirebaseAdmin(): void {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn('Firebase credentials not configured — FCM disabled');
      return;
    }

    const apps = getApps();
    if (apps.length === 0) {
      this.app = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, '\n'),
        }),
      });
    } else {
      this.app = apps[0] ?? null;
    }

    this.logger.log('Firebase Admin initialized');
  }

  /**
   * Sends a push notification to multiple FCM tokens in a single multicast request.
   *
   * Visible notifications display an alert UI and play the default sound on iOS;
   * Android renders a system notification with high or normal priority based on
   * `isHighPriority`. Silent notifications set `content-available: 1` on iOS so
   * the app wakes in the background, omit the `notification` block entirely
   * (presence of which suppresses background delivery on iOS), and use Android
   * `priority: 'high'` to bypass app-standby buckets — the data payload is the
   * whole point of a silent send.
   *
   * Stale token cleanup runs in parallel after the send — tokens that return
   * INVALID_ARGUMENT or REGISTRATION_TOKEN_NOT_REGISTERED are deleted via
   * DeviceTokenService to keep the token collection clean without blocking the response.
   *
   * Returns SENT if at least one token was delivered successfully.
   * Returns FAILED if the app is not initialized or every individual send failed.
   * Returns NO_TOKENS when the token list is empty — caller should not log this.
   */
  async sendMulticast(
    tokens: string[],
    payload: { title: string; body: string; data?: Record<string, string> },
    options: { isHighPriority?: boolean; isSilent?: boolean } = {},
  ): Promise<FcmMulticastResult> {
    if (!this.app) {
      return { status: 'FAILED' };
    }
    if (tokens.length === 0) {
      return { status: 'NO_TOKENS' };
    }

    const { isHighPriority = false, isSilent = false } = options;

    // MulticastMessage (token-based) is deprecated in firebase-admin 14 in favor of
    // FidMulticastMessage (Firebase Installation IDs). Staying on tokens deliberately:
    // DeviceTokenService stores client registration tokens, and switching requires the
    // client apps to register FIDs first. Revisit before firebase-admin 15 drops tokens.
    const message: MulticastMessage = isSilent
      ? {
          tokens,
          data: payload.data,
          android: { priority: 'high' },
          apns: {
            headers: { 'apns-push-type': 'background', 'apns-priority': '5' },
            payload: { aps: { contentAvailable: true } },
          },
        }
      : {
          tokens,
          notification: { title: payload.title, body: payload.body },
          data: payload.data,
          android: { priority: isHighPriority ? 'high' : 'normal' },
          apns: {
            payload: { aps: { sound: 'default' } },
          },
        };

    try {
      const response = await getMessaging(this.app).sendEachForMulticast(message);
      const staleTokenJobs: Promise<void>[] = [];

      response.responses.forEach((res, idx) => {
        if (!res.success && res.error) {
          const code = res.error.code;
          if (STALE_ERROR_CODES.has(code)) {
            staleTokenJobs.push(this.deviceTokenService.deleteStaleToken(tokens[idx]));
          }
          this.logger.warn(`FCM send failed for token ${tokens[idx]?.slice(0, 20)}: ${code}`);
        }
      });

      await Promise.allSettled(staleTokenJobs);

      const anySuccess = response.successCount > 0;
      return { status: anySuccess ? 'SENT' : 'FAILED' };
    } catch (err) {
      this.logger.error(`FCM multicast error: ${err}`);
      return { status: 'FAILED' };
    }
  }
}
