import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, PaginateModel, Schema as MongooseSchema, Types } from 'mongoose';
import paginate from 'mongoose-paginate-v2';

import { registerSearchFields } from 'src/utils/search-registry';
import { BaseSchema } from '../base.schema';

/**
 * Vehicle registry: registration number -> owner (the BRTA record, kept locally). Tickets go to the owner's email;
 * a signed-in user sees the cases of vehicles registered to their email.
 */
@Schema({ collection: 'vehicles', timestamps: true, versionKey: false })
export class Vehicle extends BaseSchema {
  /** As written on the plate, BRTA order: "Dhaka Metro-Ga 12-3456". */
  @Prop({ type: String, required: true, trim: true })
  registration!: string;

  /** Letters and digits only, upper case: the lookup key. */
  @Prop({ type: String, required: true, unique: true })
  regKey!: string;

  /** The 6 digits of line 2 ("123456"): matches plate reads that missed the area or letter. */
  @Prop({ type: String, index: true })
  numberKey!: string;

  @Prop({ type: String, default: '' })
  vehicleClass!: string;

  @Prop({ type: String, default: '' })
  makeModel!: string;

  @Prop({ type: String, default: '' })
  colour!: string;

  @Prop({ type: String, required: true, trim: true })
  ownerName!: string;

  @Prop({ type: String, lowercase: true, trim: true, index: true })
  ownerEmail?: string;

  @Prop({ type: String, default: '' })
  ownerPhone!: string;

  @Prop({ type: String, default: '' })
  ownerAddress!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', index: true })
  ownerUserId?: Types.ObjectId;
}

export const VehicleSchema = SchemaFactory.createForClass(Vehicle);
VehicleSchema.plugin(paginate);
registerSearchFields(Vehicle, ['registration', 'regKey', 'ownerName', 'ownerEmail', 'ownerPhone']);

export interface VehicleModel extends Model<Vehicle>, PaginateModel<Vehicle> {}
