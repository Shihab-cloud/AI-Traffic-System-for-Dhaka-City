import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  DEFAULT_SYSTEM_SETTINGS,
  type SystemSettingsData,
} from 'src/lib/types/system-settings.types';
import { BaseSchema } from '../base.schema';

/**
 * Single-row store for instance-wide settings (mirrors drizzle `system_settings`).
 * The whole flag set lives in the `data` sub-document so adding a new setting
 * needs no schema change — see {@link SystemSettingsData}. `updatedById` is an
 * audit pointer to the admin who last changed settings (a plain string, no ref
 * relation — the row is a standalone singleton and is never joined).
 */
@Schema({ collection: 'system_settings', timestamps: true, versionKey: false })
export class SystemSettings extends BaseSchema {
  @Prop({ type: Object, required: true, default: () => ({ ...DEFAULT_SYSTEM_SETTINGS }) })
  data!: SystemSettingsData;

  @Prop({ type: String, default: null })
  updatedById!: string | null;
}

export const SystemSettingsSchema = SchemaFactory.createForClass(SystemSettings);

SystemSettingsSchema.loadClass(SystemSettings);

export type SystemSettingsModel = Model<SystemSettings>;
