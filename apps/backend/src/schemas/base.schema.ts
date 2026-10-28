import { Transform } from 'class-transformer';
import { Document, Types } from 'mongoose';

export class BaseSchema extends Document {
  // class-transformer types `obj` as `any`; annotate the fields this transform
  // reads (`_id` may already be a string on lean/plain objects).
  @Transform(
    ({ obj }: { obj: { _id?: Types.ObjectId | string; id?: string } }) =>
      obj._id?.toString() || obj.id,
  )
  // @ts-expect-error - _id is ObjectId in Document but transformed to string during serialization
  declare _id: string;

  // Mongoose's `id` virtual (string form of `_id`). Mongoose 9's `Document`
  // type no longer declares it, so surface it here — it still exists at
  // runtime (schema option `id` defaults to true).
  declare id: string;

  createdAt!: Date;

  updatedAt!: Date;
}
