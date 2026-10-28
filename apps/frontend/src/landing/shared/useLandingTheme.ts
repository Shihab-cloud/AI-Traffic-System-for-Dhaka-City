'use client';

import { type MouseEvent, useCallback, useEffect, useState } from 'react';
import type { LandingVariant } from '../config';
import { gsap } from './gsap';

export type Theme = 'light' | 'dark';

const STORAGE_PREFIX = 'landing-theme:';

/**
 * Per-variant light/dark theme state for a landing page.
 *
 * - Defaults to `light` (matches SSR markup, so no hydration mismatch).
 * - Remembers the visitor's manual choice in localStorage, scoped per variant.
 * - `toggle(event, pageEl)` runs a GSAP "circular wipe" from the click point:
 *   an overlay painted with the *current* background is laid over the page, the
 *   new theme is applied underneath, then the overlay shrinks to reveal it.
 *   Falls back to an instant swap when `prefers-reduced-motion` is set.
 */
export function useLandingTheme(variant: LandingVariant, initial: Theme = 'light') {
  const [theme, setTheme] = useState<Theme>(initial);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-hydration guard: must flip false→true only after mount, so it can't be a lazy initializer (stays false during SSR/first render)
    setMounted(true);
    try {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}${variant}`);
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, [variant]);

  const apply = useCallback(
    (next: Theme) => {
      setTheme(next);
      try {
        localStorage.setItem(`${STORAGE_PREFIX}${variant}`, next);
      } catch {
        /* ignore */
      }
    },
    [variant],
  );

  const toggle = useCallback(
    (event?: MouseEvent, pageEl?: HTMLElement | null) => {
      const next: Theme = theme === 'light' ? 'dark' : 'light';
      const reduce =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (reduce || !event || !pageEl) {
        apply(next);
        return;
      }

      const fromBg = getComputedStyle(pageEl).backgroundColor || '#000';
      const x = event.clientX;
      const y = event.clientY;

      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '9999',
        background: fromBg,
        pointerEvents: 'none',
      } satisfies Partial<CSSStyleDeclaration>);
      document.body.appendChild(overlay);

      // Swap the theme underneath the (full-screen) overlay, then reveal it.
      apply(next);

      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );
      gsap.fromTo(
        overlay,
        { clipPath: `circle(${radius}px at ${x}px ${y}px)` },
        {
          clipPath: `circle(0px at ${x}px ${y}px)`,
          duration: 0.6,
          ease: 'power2.inOut',
          onComplete: () => overlay.remove(),
        },
      );
    },
    [theme, apply],
  );

  return { theme, toggle, mounted };
}
