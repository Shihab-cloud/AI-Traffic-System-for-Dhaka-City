import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Violation, ViolationModel, VlmExplanation } from 'src/schemas/traffic/violation.schema';
import { EvidenceService } from './evidence.service';
import { dhakaTime } from './traffic.util';
import { VisionClientService } from './vision-client.service';

/** Order in which evidence images are shown to the model (at most 4). */
const IMAGE_ORDER = ['scene', 'closeup', 'plate', 'stopped'];
const MAX_IMAGES = 4;
/** A pending explanation older than this is assumed lost (e.g. backend restarted) and may be requested again. */
const STALE_MS = 5 * 60 * 1000;
/** The local model answers one request at a time (10-25 s each, ~15 s more to load it first). */
const LOCAL_TIMEOUT_MS = 4 * 60 * 1000;

const EXPLANATION_SCHEMA = {
  type: 'object',
  properties: {
    explanation: { type: 'string' },
    supports_violation: { type: 'string', enum: ['yes', 'no', 'unclear'] },
    vehicle_description: { type: 'string' },
    concerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['explanation', 'supports_violation', 'vehicle_description', 'concerns'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You help traffic officers in Dhaka, Bangladesh review violations that an automatic camera system detected. You get the evidence images (in the scene image, the vehicle the system flagged is boxed in red and its recent path drawn in yellow) and the measurements the system recorded. The officer reads your answer before deciding whether to send a ticket to the vehicle owner.

Fill in:
- explanation: 2 to 4 plain sentences on what the images show and how that relates to the recorded violation. Speeds come from a calibrated road zone and cannot be judged from a still image: use the recorded numbers as given, and say what the images can and cannot confirm.
- supports_violation: "yes" if the images are consistent with the recorded violation, "no" if they contradict it (for example the red box is not on a vehicle, or the vehicle is clearly of another type), "unclear" if they cannot tell.
- vehicle_description: type, colour and visible markings of the flagged vehicle.
- concerns: what the officer should check before ticketing (blur, occlusion, box on the wrong vehicle, plate not legible, vehicle type mismatch). An empty list if nothing.

Do not read out plate characters that are not clearly legible in the images; the plate reader's own result and its confidence are given with the data.`;

export type VlmProvider = 'local' | 'anthropic' | 'rules';

/**
 * Explains a violation from its evidence images and recorded data, for the officer's "Check" dialog.
 * Provider "local" (default: a vision-language model run by the vision service on this computer, vision/service/vlm.py),
 * "anthropic" (Claude, needs ANTHROPIC_API_KEY) or "rules" (a summary built from the recorded data only, labelled as
 * such in the UI). Runs in the background; the result is stored on the violation (`vlm`).
 */
@Injectable()
export class VlmService {
  private readonly logger = new Logger(VlmService.name);
  readonly provider: VlmProvider;
  readonly model: string;
  private readonly client: Anthropic | null;

  constructor(
    config: ConfigService,
    @InjectModel(Violation.name) private readonly violations: ViolationModel,
    private readonly evidence: EvidenceService,
    private readonly vision: VisionClientService,
  ) {
    this.provider = (config.get<string>('VLM_PROVIDER') as VlmProvider) || 'local';
    this.model = this.provider === 'anthropic' ? config.get<string>('VLM_MODEL') || 'claude-opus-5-5' : '';
    this.client =
      this.provider === 'anthropic' ? new Anthropic({ apiKey: config.get<string>('ANTHROPIC_API_KEY') || undefined }) : null;
    const label = { local: 'local model in the vision service', anthropic: `Claude (${this.model})`, rules: 'rule-based summary' };
    this.logger.log(`Violation explanations: ${label[this.provider]}`);
  }

  /** Starts an explanation unless one is done or running; returns the stored state. */
  async request(id: string, force = false): Promise<VlmExplanation | undefined> {
    const v = await this.violations.findById(id).lean();
    if (!v) throw new NotFoundException('Violation not found');
    const cur = v.vlm;
    const running = cur?.status === 'pending' && Date.now() - new Date(cur.requestedAt ?? 0).getTime() < STALE_MS;
    if (running || (cur?.status === 'done' && !force)) return cur;

    const pending: VlmExplanation = { status: 'pending', provider: this.provider, requestedAt: new Date() };
    // Conditional update: two officers opening the same violation start one request, not two.
    const claimed = await this.violations.updateOne(
      { _id: id, 'vlm.requestedAt': cur?.requestedAt ?? { $exists: false } },
      { $set: { vlm: pending } },
    );
    if (claimed.modifiedCount === 1) {
      void this.run(id).catch((err: Error) => this.logger.error(`Explanation ${id} failed: ${err.message}`));
    }
    return pending;
  }

  private async run(id: string) {
    const v = await this.violations.findById(id).lean();
    if (!v) return;
    let result: VlmExplanation;
    try {
      result =
        this.provider === 'local'
          ? await this.askLocal(v as Violation)
          : this.provider === 'anthropic'
            ? await this.ask(v as Violation)
            : this.rules(v as Violation);
    } catch (err) {
      result = {
        status: 'failed',
        provider: this.provider,
        model: this.model,
        error: this.describeError(err),
        requestedAt: v.vlm?.requestedAt,
        completedAt: new Date(),
      };
    }
    await this.violations.updateOne({ _id: id }, { $set: { vlm: result } });
  }

  /** `speed` false: no speeds (the local model argues with them when the violation is not about speed). */
  private facts(v: Violation, speed = true): string {
    const lines = [
      `Recorded violation: ${v.code} ${v.title}`,
      `Vehicle class (detector, majority vote over the track): ${v.vehicleClass}` +
        (v.classConfidence != null ? ` (${Math.round(v.classConfidence * 100)}% of frames)` : ''),
      `Camera: ${v.cameraName || 'unknown'}; road zone: ${v.zone || 'none'}${v.areas?.length ? `; areas: ${v.areas.join(', ')}` : ''}`,
      `Time: ${dhakaTime(v.occurredAt)} (Dhaka)`,
    ];
    if (v.kph != null && speed) {
      lines.push(
        `Measured speed: ${v.kph} km/h${v.avgKph != null ? `, average through the zone ${v.avgKph} km/h` : ''}` +
          (v.limitKph != null ? `; limit ${v.limitKph} km/h` : ''),
      );
    }
    const details = Object.entries(v.details ?? {}).filter(
      ([k, val]) => val !== null && typeof val !== 'object' && (speed || !/kph|speed/i.test(k)),
    );
    if (details.length) lines.push(`Other recorded data: ${details.map(([k, val]) => `${k}=${String(val)}`).join(', ')}`);
    const p = v.plate;
    lines.push(
      p
        ? `Plate reader: "${p.registration || '(nothing read)'}", status ${p.status}, confidence ${p.confidence}, plate width ${p.plateWidthPx} px`
        : 'Plate reader: no result yet',
    );
    return lines.join('\n');
  }

  /** The local model: scene and close-up (the plate crop is too small for it to read anything) and, once it is made,
   * frames of the violation clip, which the vision service takes from S3 itself. */
  private async askLocal(v: Violation): Promise<VlmExplanation> {
    const clip = v.clip?.status === 'done' && v.clip.key ? { key: v.clip.key, atS: v.clip.atS, fromS: v.clip.fromS } : undefined;
    const images: { kind: string; caption: string; data: string }[] = [];
    for (const kind of ['scene', 'closeup']) {
      const img = v.images?.find((i) => i.kind === kind);
      if (img) {
        images.push({ kind, caption: img.caption ?? '', data: (await this.evidence.read(img.key)).toString('base64') });
      }
    }
    const answer = await this.vision.request<{
      explanation: string;
      supports_violation: string;
      vehicle_description: string;
      concerns: string[];
      model: string;
    }>(
      '/explain',
      {
        method: 'POST',
        body: JSON.stringify({
          code: v.code,
          title: v.title,
          vehicleClass: v.vehicleClass,
          trackId: v.trackId,
          kph: v.kph,
          bbox: v.bbox,
          frameSize: v.frameSize,
          facts: this.facts(v, v.code === 'V2'),
          images,
          clip,
        }),
      },
      LOCAL_TIMEOUT_MS,
    );
    return {
      status: 'done',
      provider: 'local',
      model: answer.model,
      explanation: answer.explanation,
      supportsViolation: answer.supports_violation,
      vehicleDescription: answer.vehicle_description,
      concerns: answer.concerns,
      requestedAt: v.vlm?.requestedAt,
      completedAt: new Date(),
      usedClip: !!clip,
    };
  }

  private async ask(v: Violation): Promise<VlmExplanation> {
    const rank = (kind: string) => {
      const i = IMAGE_ORDER.indexOf(kind);
      return i < 0 ? IMAGE_ORDER.length : i;
    };
    const images = [...(v.images ?? [])].sort((a, b) => rank(a.kind) - rank(b.kind)).slice(0, MAX_IMAGES);
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const [i, img] of images.entries()) {
      const data = (await this.evidence.read(img.key)).toString('base64');
      content.push({ type: 'text', text: `Image ${i + 1}: ${img.caption || img.kind}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
    }
    content.push({ type: 'text', text: this.facts(v) });

    // Claude Haiku has no server-side refusal fallback; every other current model gets the default one.
    const fallback = this.model.startsWith('claude-haiku')
      ? {}
      : { betas: ['server-side-fallback-2026-07-01'] as Anthropic.Beta.AnthropicBeta[], fallbacks: 'default' as const };
    const response = await this.client!.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: EXPLANATION_SCHEMA } },
      messages: [{ role: 'user', content }],
      ...fallback,
    });
    if (response.stop_reason === 'refusal') {
      throw new Error(`The model declined (${response.stop_details?.category ?? 'no category'})`);
    }
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw new Error(`No answer (stop reason ${response.stop_reason})`);
    const parsed = JSON.parse(text.text) as {
      explanation: string;
      supports_violation: string;
      vehicle_description: string;
      concerns: string[];
    };
    return {
      status: 'done',
      provider: 'anthropic',
      model: response.model,
      explanation: parsed.explanation,
      supportsViolation: parsed.supports_violation,
      vehicleDescription: parsed.vehicle_description,
      concerns: parsed.concerns,
      requestedAt: v.vlm?.requestedAt,
      completedAt: new Date(),
    };
  }

  /** No model: a plain summary of the recorded data (the UI labels it "automatic summary"). */
  private rules(v: Violation): VlmExplanation {
    const who = `${v.vehicleClass} #${v.trackId}`;
    let explanation: string;
    if (v.code === 'V2' && v.kph != null && v.limitKph != null) {
      explanation =
        `${who} was measured at ${v.kph} km/h` +
        (v.avgKph != null ? ` (average ${v.avgKph} km/h through zone "${v.zone}")` : '') +
        `, ${Math.round((v.avgKph ?? v.kph) - v.limitKph)} km/h over the ${v.limitKph} km/h limit. ` +
        `The speed comes from the vehicle's road-contact point moving across a road zone of measured size, ` +
        `over about one second, and was over the limit for at least a second.`;
    } else {
      const details = Object.entries(v.details ?? {})
        .filter(([, val]) => val !== null && typeof val !== 'object')
        .map(([k, val]) => `${k.replace(/_/g, ' ')}: ${String(val)}`);
      explanation = `${v.title}: ${who} in zone "${v.zone || '-'}"${v.areas?.length ? ` (${v.areas.join(', ')})` : ''}.` +
        (details.length ? ` Recorded: ${details.join('; ')}.` : '');
    }
    const concerns: string[] = [];
    const p = v.plate;
    if (!p) concerns.push('Plate not read yet.');
    else if (p.status !== 'confirmed')
      concerns.push(`Plate read is "${p.status}"${p.registration ? ` (${p.registration})` : ''}: check the plate image before ticketing.`);
    if (v.classConfidence != null && v.classConfidence < 0.6)
      concerns.push(`Vehicle class is uncertain (${Math.round(v.classConfidence * 100)}% of frames).`);
    return {
      status: 'done',
      provider: 'rules',
      explanation,
      supportsViolation: 'unclear',
      vehicleDescription: v.vehicleClass,
      concerns,
      requestedAt: v.vlm?.requestedAt,
      completedAt: new Date(),
    };
  }

  private describeError(err: unknown): string {
    if (err instanceof Anthropic.AuthenticationError) return 'Claude API key rejected (check ANTHROPIC_API_KEY)';
    if (err instanceof Anthropic.RateLimitError) return 'Claude rate limit reached: try again in a minute';
    if (err instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${err.message}`;
    if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API (network)';
    if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
    return (err as Error)?.message ?? String(err);
  }
}
