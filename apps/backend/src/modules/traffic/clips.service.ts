import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { VideoClip, Violation, ViolationModel } from 'src/schemas/traffic/violation.schema';
import { EvidenceService } from './evidence.service';
import { VisionClientService } from './vision-client.service';

/** A clip still pending after this was lost (e.g. the vision service restarted): it is asked for again. */
const STALE_MS = 15 * 60 * 1000;
/** Sources whose past frames can be read again: recorded videos. A live camera's are gone. */
const RECORDED = ['file', 'upload'];

type StoredViolation = Violation & { _id: unknown };

/**
 * Violation clips: 15 s of the source video around the violation with the vehicle boxed, made by the vision service
 * (vision/service/clips.py). New violations ask for theirs when they are detected; older ones when a case view opens
 * (`ensure`). The result arrives as a `clip` event (VisionEventsService).
 */
@Injectable()
export class ClipsService {
  private readonly logger = new Logger(ClipsService.name);

  constructor(
    @InjectModel(Violation.name) private readonly violations: ViolationModel,
    private readonly evidence: EvidenceService,
    private readonly vision: VisionClientService,
  ) {}

  /** The violation's clip state, asking the vision service for the clip if it has none (or a lost one). */
  async ensure(v: StoredViolation): Promise<VideoClip | undefined> {
    const cur = v.clip;
    const lost = cur?.status === 'pending' && Date.now() - new Date(cur.requestedAt ?? 0).getTime() > STALE_MS;
    if ((cur && !lost) || !RECORDED.includes(v.source?.kind ?? '') || v.videoTimeS == null || !v.bbox?.length) {
      return cur;
    }
    const pending: VideoClip = { status: 'pending', requestedAt: new Date() };
    // Conditional: two people opening the same case ask for one clip.
    const claimed = await this.violations.updateOne(
      { _id: v._id, 'clip.requestedAt': cur?.requestedAt ?? { $exists: false } },
      { $set: { clip: pending } },
    );
    if (claimed.modifiedCount !== 1) return cur;
    const folder = v.images?.[0]?.key?.replace(/\/[^/]+$/, '') || `violations/clips/${v.eventId}`;
    try {
      await this.vision.request('/clips', {
        method: 'POST',
        body: JSON.stringify({
          eventId: v.eventId,
          source: v.source!.value,
          atS: v.videoTimeS,
          bbox: v.bbox,
          frameSize: v.frameSize,
          label: this.label(v),
          occurredAt: v.occurredAt,
          prefix: folder,
        }),
      });
      return pending;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        // vision service down: no clip state, so the next view asks again
        await this.violations.updateOne({ _id: v._id }, { $unset: { clip: 1 } });
        return undefined;
      }
      const failed: VideoClip = { status: 'failed', error: (err as Error).message, requestedAt: pending.requestedAt };
      await this.violations.updateOne({ _id: v._id }, { $set: { clip: failed } });
      this.logger.warn(`Clip of ${v.eventId}: ${failed.error}`);
      return failed;
    }
  }

  /** What the case views show: the clip's signed URL once it is made. */
  async video(clip: VideoClip | undefined) {
    if (clip?.status !== 'done' || !clip.key) return null;
    const [signed] = await this.evidence.sign([{ kind: 'clip', key: clip.key }]);
    return signed?.url ? { url: signed.url, marked: !!clip.marked, fromS: clip.fromS, toS: clip.toS, atS: clip.atS } : null;
  }

  /** The text above the vehicle in the clip, as on the scene image (vision hooks.violation_label). */
  private label(v: Violation) {
    return `${v.code} ${v.title}: ${v.vehicleClass} #${v.trackId}` + (v.code === 'V2' && v.kph != null ? ` ${Math.round(v.kph)} km/h` : '');
  }
}
