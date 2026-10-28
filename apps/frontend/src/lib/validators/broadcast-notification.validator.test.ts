import { describe, expect, it } from 'vitest';

import { DocumentType } from '@/lib/enums/document-type.enum';

import {
  BROADCAST_MESSAGE_MAX_LENGTH,
  BroadcastNotificationValidation,
} from './broadcast-notification.validator';

describe('BroadcastNotificationValidation', () => {
  it('exports the max length the composer counts against', () => {
    expect(BROADCAST_MESSAGE_MAX_LENGTH).toBe(1000);
  });

  it('accepts a message with no deep-link target', () => {
    const parsed = BroadcastNotificationValidation.parse({ message: 'Hello everyone' });
    expect(parsed.message).toBe('Hello everyone');
    expect(parsed.documentType).toBeUndefined();
  });

  it('trims and rejects a blank message', () => {
    expect(BroadcastNotificationValidation.safeParse({ message: '   ' }).success).toBe(false);
    expect(BroadcastNotificationValidation.parse({ message: '  hi  ' }).message).toBe('hi');
  });

  it('rejects a message past the exported max and names the number in the message', () => {
    const result = BroadcastNotificationValidation.safeParse({
      message: 'x'.repeat(BROADCAST_MESSAGE_MAX_LENGTH + 1),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain(String(BROADCAST_MESSAGE_MAX_LENGTH));
  });

  it('accepts every member of the DocumentType enum', () => {
    for (const value of Object.values(DocumentType)) {
      expect(
        BroadcastNotificationValidation.safeParse({ message: 'hi', documentType: value }).success,
      ).toBe(true);
    }
  });

  it('rejects a document type that is not in the enum', () => {
    expect(
      BroadcastNotificationValidation.safeParse({ message: 'hi', documentType: 'INVOICE' }).success,
    ).toBe(false);
  });
});
