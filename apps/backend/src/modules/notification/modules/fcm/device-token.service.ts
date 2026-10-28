import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DeviceToken, DeviceTokenModel } from 'src/schemas/notification/device-token.schema';
import type { RegisterDeviceTokenRequest } from '../../../../lib/dto/request/register-device-token.req';

/**
 * Unlike backend-drizzle, token lists are read straight from Mongo with no
 * Redis cache layer — intentional, not an oversight. The mongoose stack keeps
 * Redis out of the notification path, and a single indexed `find` per FCM send
 * is cheap at template scale. Add a cache here only if send volume demands it.
 */
@Injectable()
export class DeviceTokenService {
  private readonly logger = new Logger(DeviceTokenService.name);

  constructor(@InjectModel(DeviceToken.name) private readonly deviceTokenModel: DeviceTokenModel) {}

  /**
   * Registers or refreshes an FCM device token for a user.
   *
   * Uses an upsert on the unique token field so re-registering an existing
   * token (e.g., app reinstall on same device) updates the userId and platform
   * rather than creating a duplicate document.
   */
  async register(userId: string, dto: RegisterDeviceTokenRequest): Promise<void> {
    await this.deviceTokenModel.updateOne(
      { token: dto.token },
      { $set: { userId, platform: dto.platform } },
      { upsert: true },
    );
  }

  /**
   * Removes a specific FCM token for a user.
   *
   * The userId condition prevents a user from deleting another user's token
   * even if they know the token string.
   */
  async unregister(token: string, userId: string): Promise<void> {
    await this.deviceTokenModel.deleteOne({ token, userId });
  }

  /**
   * Deletes a stale token that was rejected by FCM.
   *
   * Called by FcmService when FCM returns INVALID_ARGUMENT or
   * REGISTRATION_TOKEN_NOT_REGISTERED for a specific token.
   */
  async deleteStaleToken(token: string): Promise<void> {
    await this.deviceTokenModel.deleteOne({ token });
    this.logger.warn(`Stale FCM token deleted: ${token.slice(0, 20)}...`);
  }

  /**
   * Returns all FCM device tokens for a user.
   */
  async findForUser(userId: string): Promise<DeviceToken[]> {
    return this.deviceTokenModel.find({ userId }).lean<DeviceToken[]>().exec();
  }
}
