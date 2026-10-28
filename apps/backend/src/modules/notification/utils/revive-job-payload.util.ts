/**
 * BullMQ JSON-serializes job data on enqueue, so Date fields revive as strings.
 * Persistence calls that store dates expect a real Date, so every processor
 * consuming a notification DTO from a job payload must revive expiresAt first.
 *
 * Only `expiresAt` is revived. If another Date field is added to the notification
 * DTO (or to a job payload that wraps it), extend this function to revive it too.
 */
export function reviveJobPayload<T extends { expiresAt?: Date | string | null }>(dto: T): T {
  return {
    ...dto,
    expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : dto.expiresAt,
  };
}
