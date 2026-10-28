import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { TrackedVehicle, TrackedVehicleModel } from 'src/schemas/traffic/tracked-vehicle.schema';
import { AppearanceIndex } from './appearance-index';
import { toFloats } from './vehicle-matching';

/**
 * The HNSW index of every vehicle's mean appearance vector, kept in memory: built from `tracked_vehicles` at start-up
 * (O(n log n)), updated by VehicleIdentityService as vehicles are seen, joined or rebuilt. One per backend process
 * (one process here; several would each keep their own, or share a vector store such as Faiss / Milvus).
 */
@Injectable()
export class AppearanceIndexService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AppearanceIndexService.name);
  private index: AppearanceIndex | null = null;

  constructor(@InjectModel(TrackedVehicle.name) private readonly vehicles: TrackedVehicleModel) {}

  async onApplicationBootstrap() {
    const t0 = Date.now();
    try {
      for await (const v of this.vehicles.find({ embedding: { $exists: true } }).select('vid embedding').lean().cursor()) {
        const e = toFloats(v.embedding);
        if (e) this.upsert(v.vid, e);
      }
      this.logger.log(`Appearance index: ${this.size} vehicles in ${Date.now() - t0} ms`);
    } catch (err) {
      this.logger.warn(`Appearance index not built: ${(err as Error).message}`);
    }
  }

  get size(): number {
    return this.index?.size ?? 0;
  }

  upsert(vid: string, embedding: Float32Array) {
    // the first vector sets the size (DINOv2-small: 768); another REID_MODEL's vectors cannot be compared with it
    this.index ??= new AppearanceIndex(embedding.length);
    this.index.upsert(vid, embedding);
  }

  remove(vid: string) {
    this.index?.remove(vid);
  }

  clear() {
    this.index = null;
  }

  /** The k vehicles that look most like `embedding` (cosine on the appearance vectors, most similar first). */
  nearest(embedding: Float32Array, k: number) {
    return this.index?.search(embedding, k, Math.max(2 * k, 64)) ?? [];
  }
}
