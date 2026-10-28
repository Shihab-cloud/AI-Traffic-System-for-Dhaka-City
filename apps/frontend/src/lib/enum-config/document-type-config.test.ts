import { describe, expect, it } from 'vitest';

import { DocumentType } from '@/lib/enums/document-type.enum';

import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPE_OPTIONS } from './document-type-config';

describe('document-type-config', () => {
  it('labels every member of the enum', () => {
    // The Record type makes a missing key a compile error; this asserts it at runtime too.
    for (const value of Object.values(DocumentType)) {
      expect(DOCUMENT_TYPE_LABELS[value]).toBeTruthy();
    }
  });

  it('derives the picker options in enum order', () => {
    expect(DOCUMENT_TYPE_OPTIONS).toEqual([
      { value: DocumentType.SUPPORT_TICKET, label: DOCUMENT_TYPE_LABELS.SUPPORT_TICKET },
      { value: DocumentType.USER, label: DOCUMENT_TYPE_LABELS.USER },
    ]);
  });

  it('has one option per enum member', () => {
    expect(DOCUMENT_TYPE_OPTIONS).toHaveLength(Object.values(DocumentType).length);
  });
});
