import { DocumentType } from '@/lib/enums/document-type.enum';

/**
 * Deep-link targets an announcement can carry, and how they read in a picker.
 *
 * Here rather than inline in the composer for the reason every other label map in
 * this folder exists: the option list is derived from the enum, so a document type
 * added to {@link DocumentType} surfaces as a missing key here — a type error —
 * instead of silently never appearing in the dropdown.
 */
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  [DocumentType.SUPPORT_TICKET]: 'Support Ticket (→ Notifications)',
  [DocumentType.USER]: 'User (→ Notifications)',
};

/** The picker's options, in enum order. */
export const DOCUMENT_TYPE_OPTIONS = Object.values(DocumentType).map((value) => ({
  value,
  label: DOCUMENT_TYPE_LABELS[value],
}));
