import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import {
  DEFAULT_SYSTEM_SETTINGS,
  type SystemSettingsData,
  type SystemSettingsRecord,
} from 'src/lib/types/system-settings.types';
import { SystemSettings, SystemSettingsModel } from 'src/schemas/public/system-settings.schema';

/**
 * Orchestrator for the instance-wide system settings singleton.
 *
 * - {@link getData} returns the typed flags merged over defaults (read on
 *   low-frequency auth paths and the public endpoint).
 * - {@link get} returns the full record (flags + audit) for admins.
 * - {@link update} upserts the single document.
 *
 * The store is generic: new settings are added by extending
 * {@link SystemSettingsData} and its defaults — no schema or service change.
 *
 * Parity note vs backend-drizzle: that backend wraps {@link getData} in a
 * short-lived Redis cache (`system:settings`, TTL 300s, invalidated on write).
 * backend-mongoose has no Redis (same Tier 2a decision as the MFA stores), so
 * reads hit the single-document collection directly — there is no cache layer
 * to maintain or invalidate.
 */
@Injectable()
export class SystemSettingsService {
  constructor(
    @InjectModel(SystemSettings.name) private readonly systemSettingsModel: SystemSettingsModel,
  ) {}

  /** Typed flags merged over defaults. */
  async getData(): Promise<SystemSettingsData> {
    const row = await this.loadRow();
    return this.mergeDefaults(row?.data);
  }

  /** Full record (flags + audit metadata). Admin-only, infrequent. */
  async get(): Promise<SystemSettingsRecord> {
    const row = await this.loadRow();
    return {
      ...this.mergeDefaults(row?.data),
      updatedById: row?.updatedById ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async isMfaEnabled(): Promise<boolean> {
    return (await this.getData()).mfaEnabled;
  }

  async isEmailVerificationEnabled(): Promise<boolean> {
    return (await this.getData()).emailVerificationEnabled;
  }

  async isSignupEnabled(): Promise<boolean> {
    return (await this.getData()).signupEnabled;
  }

  /** Apply a partial update to the singleton and return the full record. */
  async update(
    patch: Partial<SystemSettingsData>,
    updatedById: string,
  ): Promise<SystemSettingsRecord> {
    const cleanPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Partial<SystemSettingsData>;

    const row = await this.loadRow();
    const nextData = { ...this.mergeDefaults(row?.data), ...cleanPatch };

    const saved = row
      ? await this.systemSettingsModel
          .findByIdAndUpdate(row._id, { data: nextData, updatedById }, { returnDocument: 'after' })
          .lean()
      : await this.systemSettingsModel
          .create({ data: nextData, updatedById })
          .then((doc) => doc.toObject());

    return {
      ...this.mergeDefaults(saved?.data),
      updatedById: saved?.updatedById ?? null,
      updatedAt: saved?.updatedAt ?? null,
    };
  }

  private async loadRow() {
    return this.systemSettingsModel.findOne().lean();
  }

  private mergeDefaults(data: SystemSettingsData | null | undefined): SystemSettingsData {
    return { ...DEFAULT_SYSTEM_SETTINGS, ...(data ?? {}) };
  }
}
