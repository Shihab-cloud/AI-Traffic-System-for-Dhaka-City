import paginate from 'mongoose-paginate-v2';

import { Model, PaginateModel } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { registerSearchFields } from 'src/utils/search-registry';

export class FileInfo {
  @Prop({ required: true, unique: true })
  key!: string;

  @Prop()
  fileName!: string;

  @Prop()
  mimeType!: string;

  @Prop()
  size!: number;

  @Prop({ default: true })
  isPublic!: boolean;

  // `url` is null for private files (see FileService.uploadFile) — explicit
  // `type: String` keeps the mongoose runtime type while the TS union admits null.
  @Prop({ type: String })
  url!: string | null;
}

@Schema({ versionKey: false, timestamps: true })
export class GlobalFile extends FileInfo {}

export const GlobalFileSchema = SchemaFactory.createForClass(GlobalFile);

GlobalFileSchema.plugin(paginate);
GlobalFileSchema.loadClass(GlobalFile);

// `?search=` matches the human-facing file name only — not `key`/`url`
// (storage internals) or `mimeType`. Mirrors backend-drizzle.
registerSearchFields(GlobalFile, ['fileName']);

export interface GlobalFileModel extends Model<GlobalFile>, PaginateModel<GlobalFile> {}
