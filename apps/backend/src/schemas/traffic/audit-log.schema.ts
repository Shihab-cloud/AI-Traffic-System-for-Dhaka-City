import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, PaginateModel, Schema as MongooseSchema, Types } from 'mongoose';
import paginate from 'mongoose-paginate-v2';

import { registerSearchFields } from 'src/utils/search-registry';
import { BaseSchema } from '../base.schema';

/** Who did what to which record (tickets, dismissals, plate corrections, reviews, cameras, fines, payments). */
@Schema({ collection: 'audit_logs', timestamps: true, versionKey: false })
export class AuditLog extends BaseSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  actorId?: Types.ObjectId;

  @Prop({ type: String, default: '' })
  actorEmail!: string;

  @Prop({ type: String, default: '' })
  actorRole!: string;

  /** e.g. violation.ticket, violation.dismiss, review.decide, camera.update, payment.succeeded */
  @Prop({ type: String, required: true, index: true })
  action!: string;

  @Prop({ type: String, required: true })
  entity!: string;

  @Prop({ type: String, default: '' })
  entityId!: string;

  @Prop({ type: String, default: '' })
  summary!: string;

  @Prop({ type: Object, default: {} })
  details!: Record<string, unknown>;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.plugin(paginate);
registerSearchFields(AuditLog, ['action', 'entity', 'entityId', 'actorEmail', 'summary']);

export interface AuditLogModel extends Model<AuditLog>, PaginateModel<AuditLog> {}
