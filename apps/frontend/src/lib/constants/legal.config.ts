/**
 * The facts the privacy policy and terms state about the operator, in one place.
 *
 * **Every bracketed value is a placeholder** — the product name, the legal entity, its contact
 * address and the governing law are each project's to supply, and the wording around them is a
 * starting draft for counsel to review before either page is relied on. Brackets rather than a
 * guess, so an unfilled value shows on the page instead of passing for a real one.
 */
export const LEGAL_CONFIG = {
  /** The product, as the pages name it. */
  product: '[Product name]',
  /** The company that operates the service and is party to the terms. */
  operator: '[Operator legal name]',
  /** Where privacy requests and legal notices go. */
  contactEmail: '[legal contact email]',
  /** The law the terms are governed by, e.g. "England and Wales". */
  governingLaw: '[governing law]',
  /** Shown as "Last updated" on both pages; change it whenever either text changes. */
  lastUpdated: '[date]',
} as const;
