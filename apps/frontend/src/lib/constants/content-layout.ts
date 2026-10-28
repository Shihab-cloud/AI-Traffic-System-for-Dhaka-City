/**
 * Page-content layout, shared by `PageHeader` and `PageBody` so a page's content starts exactly
 * under its title.
 *
 * Viewport breakpoints describe the window, not the page: the permanent sidebar and gutters take
 * ~280px of it, so at a 1280px laptop the viewport `lg` (1200px) reads as desktop while the page
 * content is only ~950px wide. Layouts inside `PageBody` switch on the content thresholds below.
 */

/** The side padding of a page's header and body. A literal so Tailwind sees the classes. */
export const PAGE_GUTTER = 'px-4 md:px-8';

/** How wide a page's content runs: the whole area, or a centred column for narrower content. */
export const CONTENT_WIDTH = {
  full: '',
  /** Single-column forms. */
  '3xl': 'max-w-3xl',
  /** Detail pages made of a few cards. */
  '6xl': 'max-w-6xl',
  /** Lists and editors that read badly stretched across a large monitor. */
  '8xl': 'max-w-8xl',
} as const;

export type ContentWidth = keyof typeof CONTENT_WIDTH;

/** Container name `PageBody` declares. Tailwind addresses it as `@[<width>]/content:`. */
export const CONTENT_CONTAINER = 'content';

/** Content-width thresholds in px — the page's own width, not the viewport's. */
export const CONTENT_BREAKPOINTS = { sm: 600, md: 900, lg: 1100, xl: 1400 } as const;

export type ContentBreakpoint = keyof typeof CONTENT_BREAKPOINTS;

/**
 * An `sx` key that applies its styles once the page content is at least `breakpoint` wide.
 * Only takes effect inside a `PageBody`; anywhere else the base styles stand alone.
 *
 * @example
 * sx={{ gridTemplateColumns: '1fr', [contentUp('lg')]: { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' } }}
 */
export const contentUp = (breakpoint: ContentBreakpoint) =>
  `@container ${CONTENT_CONTAINER} (min-width: ${CONTENT_BREAKPOINTS[breakpoint]}px)`;
