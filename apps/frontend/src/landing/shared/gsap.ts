'use client';

/**
 * Central GSAP entry point for the landing system.
 *
 * Registers the plugins once (idempotent) and re-exports them plus the
 * `useGSAP` hook so every landing imports from a single place. All plugins
 * used here ship free in the public `gsap` package (3.13+).
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);
}

export { gsap, ScrollTrigger, SplitText, useGSAP };
