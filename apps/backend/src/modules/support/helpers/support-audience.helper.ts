import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';

@Injectable()
export class SupportAudienceHelper {
  constructor(@InjectModel(User.name) private readonly userModel: UserModel) {}

  /**
   * Resolves the ids of users who should be notified about a ticket: every
   * platform ADMIN. Excludes the actor. Mirrors drizzle's users-JOIN-roles
   * permission filter via a `$lookup` on the populated role's permissions array.
   */
  async resolveAdminIds(excludeUserId: string): Promise<string[]> {
    const rows = await this.userModel.aggregate<{ _id: unknown }>([
      { $match: { _id: { $ne: new Types.ObjectId(excludeUserId) } } },
      {
        $lookup: {
          from: 'roles',
          localField: 'roleId',
          foreignField: '_id',
          as: 'role',
        },
      },
      { $unwind: { path: '$role', preserveNullAndEmptyArrays: true } },
      {
        $match: { 'role.permissions': PermissionsEnum.ADMIN },
      },
      { $project: { _id: 1 } },
    ]);

    return rows.map((u) => String(u._id));
  }
}
