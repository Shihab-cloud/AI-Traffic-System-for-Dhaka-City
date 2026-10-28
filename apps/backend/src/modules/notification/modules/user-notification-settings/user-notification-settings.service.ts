import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import type { UpdateGlobalNotificationSettingsRequest } from 'src/lib/dto/request/update-notification-settings.req';
import { BACKGROUND_JOB_QUEUE_NAMES, JOB_TYPES } from 'src/shared/enums/background-queue.enum';
import {
  NotificationChannelEnum,
  PreferenceConfigType,
} from '../../../../shared/enums/notification-channel.enum';
import { ChannelRegistryService } from '../channel/core/channel-registry.service';
import type { CreateNotificationDto, ResolvedPrefs } from 'src/lib/types/notification.types';
import { NotificationPriorityEnum } from 'src/shared/enums/notification-priority.enum';
import {
  UserNotificationSettings,
  UserNotificationSettingsModel,
} from 'src/schemas/notification/user-notification-settings.schema';

type UserNotificationSettingsRow = UserNotificationSettings;

/**
 * Owns all per-user notification preference state and resolves whether a given
 * notification should be delivered now, deferred, or dropped.
 *
 * Storage model
 * -------------
 * Everything lives on a single `user_notification_settings` document:
 *   - `pushEnabled`              — global "kill switch" for push.
 *   - `emailFallbackEnabled`     — opts the user into email as a fallback when
 *                                  push is unavailable for a CRITICAL notification.
 *   - `criticalBypassQuietHours` — lets CRITICAL notifications break through
 *                                  quiet hours.
 *   - `quietHoursStart/End`,
 *     `timezone`                 — the user's quiet window, evaluated in their tz.
 *   - `preferences`              — sparse per-channel push override:
 *                                    absent  ⇒ channel is enabled (use defaults)
 *                                    `false` ⇒ user disabled this channel
 *                                    `true`  is never persisted — re-enabling
 *                                    deletes the key.
 *
 * In-app delivery is always on; it is intentionally not represented anywhere
 * in this service.
 *
 * Resolution flow (`resolve`)
 * ---------------------------
 *   1. If the user is in quiet hours AND priority is not CRITICAL (or critical
 *      bypass is off), the entire notification is *deferred* — caller must
 *      enqueue a delayed job and re-resolve at fire time.
 *   2. Otherwise, push is gated by:
 *        global `pushEnabled` AND `preferences[channel] !== false` AND
 *        channel default push AND (not in quiet hours OR critical bypass).
 *   3. Email is the channel default **OR** — when push is gated off above and
 *      the user has `emailFallbackEnabled` — forced on for CRITICAL
 *      notifications. This is the only way email is ever sent for a channel
 *      whose default has it off.
 */
@Injectable()
export class UserNotificationSettingsService {
  constructor(
    @InjectModel(UserNotificationSettings.name)
    private readonly settingsModel: UserNotificationSettingsModel,
    @InjectQueue(BACKGROUND_JOB_QUEUE_NAMES.NOTIFICATION_DELAYED)
    private readonly delayedQueue: Queue,
    private readonly channelRegistry: ChannelRegistryService,
  ) {}

  /**
   * Resolves whether a notification should be delivered now, deferred, or
   * silenced for the given user / channel. See class doc for the full rule set.
   *
   * Priority is derived from the channel meta rather than passed in, so callers
   * can't fall out of sync with the canonical config.
   *
   * Returns `deferUntil` only when `deferred === true`.
   */
  async resolve(
    userId: string,
    channelType: NotificationChannelEnum,
  ): Promise<ResolvedPrefs & { deferUntil?: Date }> {
    const settings = await this.getOrCreateSettings(userId);
    const channelDefaults = this.channelRegistry.meta(channelType);
    const priority = channelDefaults.priority;

    const inQuietHours = this.isInQuietHours(settings);
    const criticalBypass =
      priority === NotificationPriorityEnum.CRITICAL && settings.criticalBypassQuietHours;

    if (inQuietHours && !criticalBypass) {
      return {
        push: false,
        emailEnabled: false,
        emailFallback: settings.emailFallbackEnabled,
        deferred: true,
        deferUntil: this.getQuietHoursEnd(settings),
      };
    }

    const channelDisabled = settings.preferences?.[channelType] === false;
    const pushAllowed = settings.pushEnabled && !channelDisabled && channelDefaults.push;

    const emailForced =
      !pushAllowed &&
      settings.emailFallbackEnabled &&
      priority === NotificationPriorityEnum.CRITICAL;

    return {
      push: pushAllowed,
      emailEnabled: channelDefaults.email || emailForced,
      emailFallback: settings.emailFallbackEnabled,
      deferred: false,
    };
  }

  /**
   * Enqueues a BullMQ delayed job to retry delivery after quiet hours end.
   *
   * Delay is clamped to 0 if `deferUntil` is already in the past. The dequeue
   * worker is expected to call `resolve()` again at fire time so a user-extended
   * quiet window will re-defer rather than deliver early.
   */
  async enqueueDeferred(deferUntil: Date, notificationDto: CreateNotificationDto): Promise<void> {
    const delay = Math.max(0, deferUntil.getTime() - Date.now());
    await this.delayedQueue.add(
      JOB_TYPES[BACKGROUND_JOB_QUEUE_NAMES.NOTIFICATION_DELAYED].DELIVER,
      { notificationDto },
      { delay },
    );
  }

  /**
   * Fetches a user's notification settings, creating defaults on first access.
   *
   * Race-safe: uses an upsert with `$setOnInsert` so concurrent first-access
   * requests can't both insert and trip the userId unique index.
   */
  async getOrCreateSettings(userId: string): Promise<UserNotificationSettingsRow> {
    const row = await this.settingsModel
      .findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      )
      .exec();
    if (!row) {
      throw new Error(`Failed to create notification settings for user ${userId}`);
    }
    return row;
  }

  /**
   * Patches a user's notification settings.
   *
   * Plain fields (`pushEnabled`, quiet hours, timezone, …) are overwritten
   * when present on the DTO. The `preferences` patch is *merged* into the
   * existing map:
   *   - `false` ⇒ store as disabled
   *   - `true`  ⇒ delete the key (channel returns to enabled-by-default)
   * `true` is intentionally never persisted.
   */
  async updateSettings(
    userId: string,
    dto: UpdateGlobalNotificationSettingsRequest,
  ): Promise<void> {
    const { preferences: preferencesPatch, ...scalarFields } = dto;
    const updates: Partial<UserNotificationSettingsRow> = { ...scalarFields };

    const current = await this.getOrCreateSettings(userId);

    if (preferencesPatch) {
      updates.preferences = this.mergePreferencesPatch(current.preferences, preferencesPatch);
    }

    if (Object.keys(updates).length === 0) return;

    await this.settingsModel.updateOne({ userId }, { $set: updates }).exec();
  }

  /**
   * Returns the user's per-channel push overrides.
   *
   * Sparse by design: only channels the user has explicitly disabled appear in
   * the returned object. An empty object means "all channels at defaults".
   */
  async listChannelPreferences(userId: string): Promise<PreferenceConfigType> {
    const settings = await this.getOrCreateSettings(userId);
    return settings.preferences ?? {};
  }

  // -- internals ------------------------------------------------------------

  /**
   * Folds a client-supplied patch into the existing sparse preferences blob.
   *
   * Only `false` values are written; `true` deletes the key. Any other shape
   * (e.g. `null`) is ignored. The result is `null` when the merged map is
   * empty, so the column stays compact for default-state users.
   */
  private mergePreferencesPatch(
    existing: PreferenceConfigType | null | undefined,
    patch: Partial<Record<NotificationChannelEnum, boolean>>,
  ): PreferenceConfigType | null {
    const merged: PreferenceConfigType = { ...(existing ?? {}) };
    for (const [key, value] of Object.entries(patch) as [
      NotificationChannelEnum,
      boolean | undefined,
    ][]) {
      if (value === false) {
        merged[key] = false;
      } else if (value === true) {
        delete merged[key];
      }
    }
    return Object.keys(merged).length === 0 ? null : merged;
  }

  /**
   * Checks whether the current time falls within the user's configured quiet hours.
   *
   * Reads hour and minute parts directly in the user's timezone via
   * Intl.DateTimeFormat. Handles overnight windows (e.g., 22:00–06:00) by
   * detecting when start > end and inverting the comparison.
   */
  private isInQuietHours(settings: UserNotificationSettingsRow): boolean {
    if (!settings.quietHoursStart || !settings.quietHoursEnd) return false;

    const tz = settings.timezone ?? 'UTC';
    const { hour: hh, minute: mm } = getZonedParts(new Date(), tz);
    const current = hh * 60 + mm;

    const [startH, startM] = settings.quietHoursStart.split(':').map(Number);
    const [endH, endM] = settings.quietHoursEnd.split(':').map(Number);
    const start = startH * 60 + (startM ?? 0);
    const end = endH * 60 + (endM ?? 0);

    return start <= end ? current >= start && current < end : current >= start || current < end;
  }

  /**
   * Calculates the next occurrence of the quiet hours end time in the user's
   * timezone, returned as a real UTC instant.
   *
   * If today's end time has already passed in the target timezone, advances one
   * day. Uses `zonedWallClockToUtc` which iteratively resolves the timezone
   * offset (correct across DST transitions).
   */
  private getQuietHoursEnd(settings: UserNotificationSettingsRow): Date {
    const now = new Date();
    const tz = settings.timezone ?? 'UTC';
    const [endH, endM] = (settings.quietHoursEnd ?? '08:00').split(':').map(Number);

    const today = getZonedParts(now, tz);
    let target = zonedWallClockToUtc(today.year, today.month, today.day, endH, endM ?? 0, tz);
    if (target.getTime() <= now.getTime()) {
      const tomorrow = new Date(today.year, today.month - 1, today.day + 1);
      target = zonedWallClockToUtc(
        tomorrow.getFullYear(),
        tomorrow.getMonth() + 1,
        tomorrow.getDate(),
        endH,
        endM ?? 0,
        tz,
      );
    }
    return target;
  }
}

/** Extracts year/month/day/hour/minute of a UTC instant as observed in the given timezone. */
function getZonedParts(
  instant: Date,
  tz: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  // hour12=false can produce "24" for midnight in some runtimes — normalize to 0.
  if (map.hour === 24) map.hour = 0;
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

/**
 * Converts a wall-clock time in a target timezone to a UTC instant.
 *
 * Why iterate: timezone offsets vary by date (DST). A first-pass UTC guess
 * `Date.UTC(y,m,d,h,mi)` ignores the offset; we then ask the runtime what that
 * instant looks like in `tz`, derive the offset that actually applies, and
 * subtract it. A second pass corrects the rare case where the first pass
 * lands on the wrong side of a DST transition.
 */
function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 2; i++) {
    const observed = getZonedParts(new Date(utcMs), tz);
    const observedAsIfUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const offset = observedAsIfUtc - utcMs;
    utcMs = Date.UTC(year, month - 1, day, hour, minute) - offset;
  }
  return new Date(utcMs);
}
