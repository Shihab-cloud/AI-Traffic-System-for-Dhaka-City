import paginate from 'mongoose-paginate-v2';

import { Model, PaginateModel } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { BaseSchema } from '../base.schema';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { registerSearchFields } from 'src/utils/search-registry';

@Schema({ timestamps: true })
export class Role extends BaseSchema {
  @Prop({ required: true, unique: true, type: String })
  name!: string;

  @Prop({ type: String })
  description?: string;

  @Prop({
    type: [String],
    default: [],
  })
  permissions!: PermissionsEnum[];

  @Prop({ type: Boolean, required: true, default: false })
  isDefault!: boolean;

  // lower = higher rank; admin = 0
  @Prop({ type: Number, required: true })
  rank!: number;
}

export const RoleSchema = SchemaFactory.createForClass(Role);

RoleSchema.plugin(paginate);

RoleSchema.loadClass(Role);

// `?search=` matches name/description (mirrors backend-drizzle).
registerSearchFields(Role, ['name', 'description']);

export interface RoleModel extends Model<Role>, PaginateModel<Role> {}
