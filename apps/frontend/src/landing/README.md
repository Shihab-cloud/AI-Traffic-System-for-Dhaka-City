# Landing page

The public home page (`/`) of Dhaka Traffic: `traffic/TrafficLanding.tsx` with its own design tokens, fonts and
CSS module (`traffic.module.css`). Nothing here touches the app's MUI theme.

Sections: hero with an animated camera view (every vehicle tracked with its speed, a speeding car and a rider without
a helmet flagged, their case cards), facts, how it works, the eight violations, the owner's view with an example
notice, the three portals, a sign-in call to action.

- **Light and dark**: tokens in `.page` (light) and `.page[data-theme='dark']`; the moon/sun button in the nav
  toggles them with a circular wipe (`shared/useLandingTheme.ts`, remembered in `localStorage`). The camera view
  keeps its dark palette in both themes, like a real feed.
- **Motion**: GSAP (`shared/gsap.ts`), only under `prefers-reduced-motion: no-preference`. Without it the camera
  view shows a still frame with the speed case card.
- **Copy**: kept to what the system does (16 classes, 8 rules, officer check before a ticket, card / bKash / Nagad /
  Rocket payments). The notice in the owner section is marked as an example.

The template's three demo landings (ed-tech "Cadence", fin-tech, AI CRM), their `/landing/*` preview routes and the
"Explore demos" switcher were removed (they remain in the original web template). `src/proxy.ts` still lets
`/landing/*` through, which is harmless with no such routes.

## Files

```
src/landing/
  config.ts          # ACTIVE_LANDING ('traffic')
  registry.ts        # variant -> { Component, label (page title), description }
  ActiveLanding.tsx  # renders the active variant (used by app/page.tsx)
  shared/gsap.ts     # registers + re-exports gsap, ScrollTrigger, SplitText, useGSAP
  shared/useLandingTheme.ts
  traffic/           # TrafficLanding.tsx + traffic.module.css + fonts.ts
```
