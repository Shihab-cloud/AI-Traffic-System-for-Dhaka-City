import { twMerge } from 'tailwind-merge';

import {
  CONTENT_CONTAINER,
  CONTENT_WIDTH,
  PAGE_GUTTER,
  type ContentWidth,
} from '@/lib/constants/content-layout';

interface PageBodyProps {
  children: React.ReactNode;
  /**
   * Caps the content to a centred column. Pass the same value to the page's `PageHeader`, so the
   * title sits over the content. `full` (default) uses the whole content area.
   */
  width?: ContentWidth;
  /** Classes for the content column, e.g. a flex layout for its children. */
  className?: string;
}

/**
 * The page content below `PageHeader`: the shared gutter, and the size container that
 * `contentUp()` and Tailwind `@[<width>]/content:` variants query.
 */
export default function PageBody({ children, width = 'full', className }: PageBodyProps) {
  return (
    <div className={`${PAGE_GUTTER} w-full min-w-0 pt-6 pb-16`}>
      <div
        className={twMerge('mx-auto w-full min-w-0', CONTENT_WIDTH[width], className)}
        // Safari still applies layout containment to a query container, so a `position: fixed`
        // descendant is positioned against this box there (Chrome 129+ and Firefox no longer do
        // this). Overlays rendered inside a page go through a portal, not fixed positioning.
        style={{ containerType: 'inline-size', containerName: CONTENT_CONTAINER }}
      >
        {children}
      </div>
    </div>
  );
}
