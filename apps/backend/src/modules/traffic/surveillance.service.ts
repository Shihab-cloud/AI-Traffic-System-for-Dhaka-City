import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { Camera, CameraModel } from 'src/schemas/traffic/camera.schema';
import {
  SurveillanceRun,
  SurveillanceRunModel,
} from 'src/schemas/traffic/surveillance-run.schema';
import { AuditService } from './audit.service';
import type { ListQuery, StartSurveillanceRequest } from './dto/traffic.req';
import { toPlain } from './traffic.util';
import { SLOTS, SurveillanceSlot, VisionClientService } from './vision-client.service';

type VisionSlots = { slots: Array<Record<string, unknown> & { slot: string }>; delivery: Record<string, unknown> };
type VisionRun = { runId: string; startedAt: number; state: string };

/** The three surveillance boxes: what each runs, its live view, start/stop. */
@Injectable()
export class SurveillanceService {
  constructor(
    @InjectModel(Camera.name) private readonly cameras: CameraModel,
    @InjectModel(SurveillanceRun.name) private readonly runs: SurveillanceRunModel,
    private readonly vision: VisionClientService,
    private readonly audit: AuditService,
  ) {}

  /** `admin` false (traffic officers): without the scripts' logs and the boxes' run history (admins only). */
  async status(admin: boolean) {
    let data: VisionSlots;
    try {
      data = await this.vision.request<VisionSlots>('/slots', {}, 5000);
    } catch {
      return { online: false, slots: [], delivery: null };
    }
    return {
      online: true,
      delivery: data.delivery,
      slots: data.slots.map((s) => ({
        ...s,
        ...(admin ? {} : { log: [], history: [] }),
        urls: this.vision.streamUrl(s.slot as SurveillanceSlot),
      })),
    };
  }

  async start(slot: string, dto: StartSurveillanceRequest, user: CurrentUser) {
    if (!SLOTS.includes(slot as SurveillanceSlot)) throw new NotFoundException(`No box "${slot}"`);
    const camera = dto.cameraId ? await this.cameras.findById(dto.cameraId).lean() : null;
    if (dto.cameraId && !camera) throw new NotFoundException('Camera not found');
    const source = dto.source?.value ? dto.source : camera?.defaultSource;
    if (!source?.value) throw new BadRequestException('Choose a source: IP camera, video file or upload');
    if (!camera) {
      throw new BadRequestException('Speed and violation detection need a camera (its road zones and limits)');
    }
    const run = await this.vision.request<VisionRun>(`/slots/${slot}/start`, {
      method: 'POST',
      body: JSON.stringify({
        source,
        camera: camera ? { id: String(camera._id), name: camera.name, code: camera.code } : {},
        zones: camera?.zones ?? null,
        speedLimitKph: camera?.speedLimitKph ?? 60,
        options: dto.options ?? {},
      }),
    });
    await this.runs.updateOne(
      { runId: run.runId },
      {
        $set: {
          slot,
          cameraId: camera?._id,
          cameraName: camera?.name ?? '',
          startedById: new Types.ObjectId(user.id),
          startedByName: user.email ?? '',
          startedAt: new Date(run.startedAt * 1000),
        },
        $setOnInsert: { state: run.state, source: { kind: source.kind, value: source.kind === 'ip' ? 'IP camera' : source.value } },
      },
      { upsert: true },
    );
    await this.audit.record(user, 'surveillance.start', 'run', run.runId,
      `Started ${slot} on ${camera?.name ?? 'a video'} (${source.kind})`);
    return run;
  }

  async stop(slot: string, user: CurrentUser) {
    if (!SLOTS.includes(slot as SurveillanceSlot)) throw new NotFoundException(`No box "${slot}"`);
    const res = await this.vision.request(`/slots/${slot}/stop`, { method: 'POST' });
    await this.audit.record(user, 'surveillance.stop', 'slot', slot, `Stopped ${slot}`);
    return res;
  }

  videos() {
    return this.vision.request('/videos');
  }

  uploadUrl() {
    return { url: this.vision.uploadUrl() };
  }

  /**
   * Automatic zones (CSE499B autozone): the vision service watches a few minutes of the camera's traffic and proposes
   * its zones. Nothing is saved here: the zone editor loads the proposal as a draft that a person checks and saves.
   */
  async startAutoZones(cameraId: string, source: { kind: string; value: string } | undefined, user: CurrentUser) {
    const camera = await this.cameras.findById(cameraId).lean();
    if (!camera) throw new NotFoundException('Camera not found');
    const src = source?.value ? source : camera.defaultSource;
    if (!src?.value) throw new BadRequestException('Choose a video or camera stream to learn the zones from');
    const res = await this.vision.request('/autozone', {
      method: 'POST',
      body: JSON.stringify({ source: src, cameraId }),
    });
    await this.audit.record(user, 'camera.autozones', 'camera', cameraId,
      `Learning the zones of ${camera.code} automatically (${src.kind})`);
    return res;
  }

  /** The current learning job, if it is for this camera (else idle). */
  async autoZones(cameraId: string) {
    const st = await this.vision.request<{ state: string; cameraId?: string }>('/autozone');
    return st.cameraId === cameraId ? st : { state: 'idle' };
  }

  async cancelAutoZones(cameraId: string) {
    const st = await this.vision.request<{ state: string; cameraId?: string }>('/autozone');
    if (st.cameraId !== cameraId) return { state: 'idle' };
    return this.vision.request('/autozone', { method: 'DELETE' });
  }

  async frame(source: { kind: string; value: string }, atSec = 0) {
    const f = await this.vision.frame(source, atSec);
    return {
      image: `data:image/jpeg;base64,${f.jpeg.toString('base64')}`,
      width: f.width,
      height: f.height,
      atSec: f.atSec,
      durationSec: f.durationSec,
    };
  }

  async history(q: ListQuery) {
    const page = await this.runs.paginate(q.status ? { slot: q.status } : {}, {
      page: q.page ?? 1,
      limit: q.limit ?? 20,
      sort: { startedAt: -1 },
      lean: true,
    });
    return { ...page, docs: page.docs.map((d) => toPlain(d)) };
  }
}
