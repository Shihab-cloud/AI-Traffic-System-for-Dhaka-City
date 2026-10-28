import { Model } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { BaseSchema } from '../base.schema';
import { AmrEnum } from 'src/shared/enums/auth.enum';

/**
 * Mongo TTL replacement for backend-drizzle's Redis-backed MFA session state.
 *
 * backend-mongoose has no Redis (per the Tier 2a decision). Instead, the two
 * Redis keyspaces (`mfa:session_pending:{userId}` and
 * `mfa:session_state:{sessionId}`) are folded into a single collection,
 * discriminated by `kind`:
 *   - kind='PENDING'  → key = userId   (bridges session.create.before→after)
 *   - kind='SESSION'  → key = sessionId (AAL/AMR snapshot for the session)
 *
 * `expiresAt` carries a TTL index (`expireAfterSeconds: 0`) so Mongo evicts
 * rows at their expiry, matching Redis EX semantics.
 */
export enum MfaSessionStateKind {
  PENDING = 'PENDING',
  SESSION = 'SESSION',
}

@Schema({ collection: 'mfa_session_state', timestamps: true, versionKey: false })
export class MfaSessionState extends BaseSchema {
  @Prop({ type: String, required: true })
  kind!: MfaSessionStateKind;

  /** userId for PENDING rows, sessionId for SESSION rows. */
  @Prop({ type: String, required: true })
  key!: string;

  @Prop({ type: Number, required: true })
  aal!: 1 | 2;

  @Prop({ type: [String], required: true, default: [] })
  amr!: AmrEnum[];

  @Prop({ type: Number })
  mfa_at?: number;

  @Prop({ type: Boolean })
  enrollment_required?: boolean;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export const MfaSessionStateSchema = SchemaFactory.createForClass(MfaSessionState);

// One live row per (kind, key). Re-issuing replaces the previous row (upsert).
MfaSessionStateSchema.index({ kind: 1, key: 1 }, { unique: true });
// TTL — Mongo evicts when `expiresAt` passes (matches Redis EX).
MfaSessionStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

MfaSessionStateSchema.loadClass(MfaSessionState);

export type MfaSessionStateModel = Model<MfaSessionState>;
