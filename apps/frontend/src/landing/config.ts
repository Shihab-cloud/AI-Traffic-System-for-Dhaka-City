/**
 * Landing-page system — single switch.
 *
 * `ACTIVE_LANDING` chooses which landing renders at "/". The template's three demo landings (ed-tech, fin-tech,
 * AI CRM) were replaced by the traffic system's own page; see ./README.md.
 */
export const LANDING_VARIANTS = ['traffic'] as const;

export type LandingVariant = (typeof LANDING_VARIANTS)[number];

/** The variant rendered at the site root "/". */
export const ACTIVE_LANDING: LandingVariant = 'traffic';
