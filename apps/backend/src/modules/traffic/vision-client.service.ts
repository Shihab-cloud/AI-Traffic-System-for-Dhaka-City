import {
  BadGatewayException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

/** The plate box ("plates", every vehicle's plate) was merged into the speed box on 2026-10-28: the boxes read the
 * plates of violators only. Its old runs keep slot "plates". */
export type SurveillanceSlot = 'speed' | 'violations';
export const SLOTS: SurveillanceSlot[] = ['speed', 'violations'];

/**
 * Talks to the Python vision service (vision/server.py). Control calls carry the shared VISION_KEY; browsers get
 * short-lived signed tokens for the two things they fetch from it directly (live view, video upload).
 */
@Injectable()
export class VisionClientService {
  private readonly base: string;
  readonly publicBase: string;
  private readonly key: string;

  constructor(config: ConfigService) {
    this.base = (config.get<string>('VISION_URL') ?? 'http://127.0.0.1:8601').replace(/\/$/, '');
    this.publicBase = (config.get<string>('VISION_PUBLIC_URL') || this.base).replace(/\/$/, '');
    this.key = config.get<string>('VISION_KEY') ?? '';
  }

  /** Constant-time check of the x-vision-key header the vision service sends with events. */
  checkKey(given: string | undefined): boolean {
    if (!given || !this.key) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(this.key);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** b64url(JSON claims) + "." + b64url(HMAC-SHA256(VISION_KEY, first part)) - checked by vision/server.py. */
  token(claims: { p: 'stream' | 'upload'; slot?: string }, ttlSeconds = 3600): string {
    const body = Buffer.from(JSON.stringify({ ...claims, exp: Date.now() / 1000 + ttlSeconds })).toString(
      'base64url',
    );
    const sig = createHmac('sha256', this.key).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  streamUrl(slot: SurveillanceSlot) {
    const t = this.token({ p: 'stream', slot });
    return {
      stream: `${this.publicBase}/slots/${slot}/stream?token=${t}`,
      snapshot: `${this.publicBase}/slots/${slot}/snapshot?token=${t}`,
    };
  }

  uploadUrl() {
    return `${this.publicBase}/uploads?token=${this.token({ p: 'upload' }, 6 * 3600)}`;
  }

  async request<T>(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', 'x-vision-key': this.key, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException(
        'The vision service is not running. Start it with: python server.py (in the vision folder)',
      );
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: string };
      const message = body.detail ?? `Vision service error ${res.status}`;
      throw res.status >= 500 ? new BadGatewayException(message) : new HttpException(message, res.status);
    }
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer())) as T;
  }

  async frame(source: { kind: string; value: string }, atSec = 0) {
    const res = await fetch(`${this.base}/frame`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vision-key': this.key },
      body: JSON.stringify({ source, atSec }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {
      throw new ServiceUnavailableException('The vision service is not running');
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: string };
      throw new HttpException(body.detail ?? 'Could not read a frame', res.status);
    }
    return {
      jpeg: Buffer.from(await res.arrayBuffer()),
      width: Number(res.headers.get('x-frame-width')),
      height: Number(res.headers.get('x-frame-height')),
      /** time of the frame returned (a time past a video's end wraps around) */
      atSec: Number(res.headers.get('x-frame-at') ?? atSec),
      /** video length, null for live sources */
      durationSec: Number(res.headers.get('x-video-duration')) || null,
    };
  }
}
