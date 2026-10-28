import { z } from 'zod';
import { BroadcastNotificationValidation } from '@/lib/validators/broadcast-notification.validator';

export type BroadcastNotificationRequest = z.infer<typeof BroadcastNotificationValidation>;
