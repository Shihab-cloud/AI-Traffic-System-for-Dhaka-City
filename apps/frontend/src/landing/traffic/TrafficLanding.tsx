'use client';

import {
  ArrowRight,
  ArrowUpDown,
  Ban,
  Bus,
  Camera,
  Car,
  CircleParkingOff,
  Gauge,
  HardHat,
  Moon,
  OctagonX,
  Receipt,
  Ruler,
  SeparatorVertical,
  Settings2,
  ShieldCheck,
  Sun,
  TrafficCone,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import { type MouseEvent, useRef } from 'react';

import { RouteUrls } from '@/lib/routes/route.config';
import { gsap, ScrollTrigger, SplitText, useGSAP } from '../shared/gsap';
import { useLandingTheme } from '../shared/useLandingTheme';
import { body, display, mono } from './fonts';
import styles from './traffic.module.css';

const FACTS = [
  { value: '16', label: 'vehicle classes, trained on Bangladeshi roads' },
  { value: '8', label: 'traffic rules checked on every vehicle' },
  { value: '30', unit: 'fps', label: 'every frame of a recording analysed' },
  { value: '1', label: 'officer check before any ticket is sent' },
];

const STEPS = [
  {
    icon: Camera,
    title: 'Detect and track',
    text: 'Overpass cameras find every vehicle, from rickshaws to buses, and follow each one with its own ID through the frame.',
  },
  {
    icon: Ruler,
    title: 'Measure',
    text: 'A stretch of road of known size turns pixels into metres, so speed, stopping time and distance are measured, not guessed.',
  },
  {
    icon: ShieldCheck,
    title: 'Officer verifies',
    text: 'Each case arrives with photos, the measurements and a written explanation. An officer checks the plate and decides.',
  },
  {
    icon: Receipt,
    title: 'Ticket, pay or appeal',
    text: 'The owner gets the ticket by email, sees the same evidence, pays online and receives an invoice, or asks for a review.',
  },
];

const VIOLATIONS = [
  {
    code: 'V1',
    icon: Bus,
    title: 'Bus stopping outside a stop',
    text: 'A bus loading passengers away from an approved stop while traffic has to go round it.',
  },
  {
    code: 'V2',
    icon: Gauge,
    title: 'Over the speed limit',
    text: '60 km/h on city roads, 80 km/h on highways, measured over a road section of known length.',
  },
  {
    code: 'V3',
    icon: CircleParkingOff,
    title: 'Parking at a no-parking kerb',
    text: 'Waiting or parked on a marked kerb strip during peak hours or heavy traffic.',
  },
  {
    code: 'V4',
    icon: ArrowUpDown,
    title: 'Wrong-side driving',
    text: 'Driving against the flow on a one-way carriageway.',
  },
  {
    code: 'V5',
    icon: SeparatorVertical,
    title: 'Crossing a solid line',
    text: 'Changing lanes across a painted solid lane line.',
  },
  {
    code: 'V6',
    icon: HardHat,
    title: 'Riding without a helmet',
    text: 'A motorbike rider seen bare-headed across several frames.',
  },
  {
    code: 'V7',
    icon: OctagonX,
    title: 'Blocking a running lane',
    text: 'Standing in a running lane while the rest of the traffic has to pass it.',
  },
  {
    code: 'V8',
    icon: Ban,
    title: 'Vehicle banned on this road',
    text: 'Rickshaws, CNGs or other classes on roads where they are not allowed.',
  },
];

const ROLES = [
  {
    icon: UserCheck,
    title: 'Traffic officers',
    text: 'Live surveillance of IP cameras and recordings, a queue of violations to check, tickets and review decisions.',
  },
  {
    icon: Car,
    title: 'Vehicle owners',
    text: 'Your cases with photo evidence, online payment by card, bKash, Nagad or Rocket, invoices and review requests.',
  },
  {
    icon: Settings2,
    title: 'Administrators',
    text: 'Cameras and their measured road zones, fine amounts, user accounts, reports and the audit log.',
  },
];

/* ---------------- Hero camera view ----------------
 * A perspective road in a 640x420 box. `at(f, y)` places a vehicle's road-contact point on lane position `f`
 * (0 = left kerb, 1 = right kerb) at screen height `y`, with the scale the perspective gives it there. */
const ROAD = { top: 46, bottom: 420, leftTop: 296, widthTop: 48, leftBottom: 16, widthBottom: 608 };
// Far end: practically invisible. Near end: below the frame even for a bus, so waiting vehicles are hidden.
const FAR_Y = 48;
const NEAR_Y = 560;

function at(f: number, y: number) {
  const t = (y - ROAD.top) / (ROAD.bottom - ROAD.top);
  const left = ROAD.leftTop + (ROAD.leftBottom - ROAD.leftTop) * t;
  const width = ROAD.widthTop + (ROAD.widthBottom - ROAD.widthTop) * t;
  return { x: left + f * width, scale: width / ROAD.widthBottom };
}

function place(f: number, y: number) {
  const p = at(f, y);
  return {
    transform: `translate(${p.x.toFixed(1)} ${y.toFixed(1)}) scale(${p.scale.toFixed(3)})`,
    opacity: Math.min(1, Math.max(0, (p.scale - 0.08) / 0.12)),
  };
}

type Kind = 'car' | 'bus' | 'cng' | 'bike';
type Vehicle = {
  id: string;
  kind: Kind;
  lane: number;
  toward: boolean;
  label: string;
  color?: string;
  duration: number;
  delay: number;
  /** Static position when motion is reduced. */
  y0: number;
  violation?: string;
};

// Left carriageway moves away from the camera, right carriageway toward it (Dhaka drives on the left).
// Vehicles sharing a lane share a duration and start half a cycle apart, so they never run into each other.
const TRAFFIC: Vehicle[] = [
  {
    id: 'r1',
    kind: 'car',
    lane: 0.583,
    toward: true,
    label: 'CAR 31 km/h',
    color: '#d6dbe4',
    duration: 6.5,
    delay: 0,
    y0: 300,
  },
  {
    id: 'r2',
    kind: 'car',
    lane: 0.583,
    toward: true,
    label: 'MPV 27 km/h',
    color: '#f1f1ee',
    duration: 6.5,
    delay: 3.25,
    y0: 120,
  },
  {
    id: 'r3',
    kind: 'cng',
    lane: 0.917,
    toward: true,
    label: 'CNG 29 km/h',
    duration: 8,
    delay: 1,
    y0: 190,
  },
  {
    id: 'r4',
    kind: 'bus',
    lane: 0.917,
    toward: true,
    label: 'BUS 18 km/h',
    color: '#c8463d',
    duration: 8,
    delay: 5,
    y0: 395,
  },
  {
    id: 'l1',
    kind: 'car',
    lane: 0.417,
    toward: false,
    label: 'CAR 26 km/h',
    color: '#3d6fc2',
    duration: 7,
    delay: 2,
    y0: 240,
  },
  {
    id: 'l2',
    kind: 'car',
    lane: 0.417,
    toward: false,
    label: 'CAR 25 km/h',
    color: '#e4e6ea',
    duration: 7,
    delay: 5.5,
    y0: 90,
  },
  {
    id: 'l3',
    kind: 'cng',
    lane: 0.083,
    toward: false,
    label: 'CNG 28 km/h',
    duration: 8.5,
    delay: 0.5,
    y0: 150,
  },
  {
    id: 'l4',
    kind: 'bus',
    lane: 0.083,
    toward: false,
    label: 'BUS 20 km/h',
    color: '#2f8a57',
    duration: 8.5,
    delay: 4.75,
    y0: 360,
  },
];

// The two flagged vehicles, run by one timeline in step with the case cards.
const SPEEDER: Vehicle = {
  id: 'ev-speed',
  kind: 'car',
  lane: 0.75,
  toward: true,
  label: 'CAR 58 km/h',
  color: '#b9312c',
  duration: 5.5,
  delay: 0,
  y0: 255,
  violation: 'V2 · 71 km/h',
};
const RIDER: Vehicle = {
  id: 'ev-helmet',
  kind: 'bike',
  lane: 0.25,
  toward: false,
  label: 'BIKE 31 km/h',
  duration: 6,
  delay: 6,
  y0: 330,
  violation: 'V6 · NO HELMET',
};

const BOXES: Record<Kind, { x: number; y: number; w: number; h: number }> = {
  car: { x: -33, y: -41, w: 66, h: 46 },
  bus: { x: -40, y: -90, w: 80, h: 96 },
  cng: { x: -27, y: -47, w: 54, h: 52 },
  bike: { x: -15, y: -53, w: 30, h: 58 },
};

function VehicleBody({ kind, color, toward }: { kind: Kind; color?: string; toward: boolean }) {
  const lamp = toward ? '#fff3c4' : '#ff4d4d';
  if (kind === 'bus') {
    return (
      <>
        <rect x={-34} y={-82} width={68} height={82} rx={8} fill={color} />
        <rect x={-28} y={-74} width={56} height={24} rx={4} fill="rgba(9,16,28,0.78)" />
        <rect x={-34} y={-40} width={68} height={6} fill="rgba(255,255,255,0.35)" />
        <rect x={-29} y={-11} width={10} height={5} rx={2} fill={lamp} />
        <rect x={19} y={-11} width={10} height={5} rx={2} fill={lamp} />
      </>
    );
  }
  if (kind === 'cng') {
    return (
      <>
        <rect x={-21} y={-40} width={42} height={40} rx={14} fill="#2f9e5b" />
        <rect x={-21} y={-40} width={42} height={13} rx={10} fill="#237a45" />
        <rect x={-15} y={-25} width={30} height={10} rx={3} fill="rgba(9,16,28,0.7)" />
        <rect x={-17} y={-8} width={7} height={4} rx={2} fill={lamp} />
        <rect x={10} y={-8} width={7} height={4} rx={2} fill={lamp} />
      </>
    );
  }
  if (kind === 'bike') {
    return (
      <>
        <rect x={-4} y={-12} width={8} height={12} rx={3} fill="#10151f" />
        <rect x={-8} y={-36} width={16} height={26} rx={7} fill="#2c3e66" />
        {/* bare head: the V6 case */}
        <circle cx={0} cy={-42} r={7} fill="#3a2a22" />
        <rect x={-2} y={-6} width={4} height={3} rx={1} fill={lamp} />
      </>
    );
  }
  return (
    <>
      <rect x={-27} y={-35} width={54} height={35} rx={9} fill={color} />
      <rect x={-21} y={-31} width={42} height={12} rx={4} fill="rgba(9,16,28,0.72)" />
      <rect x={-23} y={-10} width={10} height={5} rx={2} fill={lamp} />
      <rect x={13} y={-10} width={10} height={5} rx={2} fill={lamp} />
    </>
  );
}

function Label({
  x,
  y,
  text,
  className,
}: {
  x: number;
  y: number;
  text: string;
  className: string;
}) {
  const w = text.length * 6.7 + 10;
  return (
    <g className={className} transform={`translate(${x} ${y - 17})`}>
      <rect width={w} height={15} rx={3} />
      <text x={5} y={11}>
        {text}
      </text>
    </g>
  );
}

function TrackedVehicle({ v }: { v: Vehicle }) {
  const b = BOXES[v.kind];
  const p = place(v.lane, v.y0);
  return (
    <g data-vehicle={v.id} className={styles.vehicle} transform={p.transform} opacity={p.opacity}>
      <VehicleBody kind={v.kind} color={v.color} toward={v.toward} />
      <rect className={styles.box} x={b.x} y={b.y} width={b.w} height={b.h} rx={4} />
      <Label x={b.x} y={b.y} text={v.label} className={styles.labelOk} />
      {v.violation && (
        <Label x={b.x} y={b.y} text={v.violation} className={styles.labelViolation} />
      )}
    </g>
  );
}

function laneLine(f: number) {
  const top = ROAD.leftTop + f * ROAD.widthTop;
  const bottom = ROAD.leftBottom + f * ROAD.widthBottom;
  return { x1: top, y1: ROAD.top, x2: bottom, y2: ROAD.bottom };
}

function zonePoints() {
  const near = 372;
  const far = 132;
  const a = at(0.5, far);
  const b = at(1, far);
  const c = at(1, near);
  const d = at(0.5, near);
  return `${a.x + 3},${far} ${b.x - 2},${far} ${c.x - 4},${near} ${d.x + 3},${near}`;
}

function CameraFeed() {
  return (
    <div
      className={styles.feed}
      data-feed
      role="img"
      aria-label="Illustration: an overpass camera view of a Dhaka road, every vehicle tracked with its speed, and two vehicles flagged for violations."
    >
      <svg viewBox="0 0 640 420" className={styles.feedSvg} aria-hidden>
        <rect width={640} height={420} className={styles.feedBg} />
        <polygon
          points={`0,46 ${ROAD.leftTop},46 ${ROAD.leftBottom},420 0,420`}
          className={styles.sidewalk}
        />
        <polygon
          points={`640,46 ${ROAD.leftTop + ROAD.widthTop},46 ${ROAD.leftBottom + ROAD.widthBottom},420 640,420`}
          className={styles.sidewalk}
        />
        <polygon
          points={`${ROAD.leftTop},${ROAD.top} ${ROAD.leftTop + ROAD.widthTop},${ROAD.top} ${ROAD.leftBottom + ROAD.widthBottom},${ROAD.bottom} ${ROAD.leftBottom},${ROAD.bottom}`}
          className={styles.asphalt}
        />
        {[1 / 6, 2 / 6, 4 / 6, 5 / 6].map((f) => (
          <line key={f} {...laneLine(f)} className={styles.laneDash} />
        ))}
        <line {...laneLine(0.494)} className={styles.median} />
        <line {...laneLine(0.506)} className={styles.median} />
        <polygon points={zonePoints()} className={styles.zone} />
        <text x={at(0.5, 132).x + 6} y={124} className={styles.zoneText}>
          ROAD ZONE 10.5 × 90 m
        </text>
        {TRAFFIC.map((v) => (
          <TrackedVehicle key={v.id} v={v} />
        ))}
        <TrackedVehicle v={SPEEDER} />
        <TrackedVehicle v={RIDER} />
      </svg>

      <div className={styles.hud}>
        <span className={styles.rec}>
          <span className={styles.recDot} /> REC
        </span>
        <span>CAM KAK-01 · Kakoli overpass</span>
      </div>
      <div className={`${styles.hud} ${styles.hudRight}`}>LIVE · 30 FPS</div>
      <div className={styles.legend}>
        <span>
          <i className={styles.legendOk} /> tracked
        </span>
        <span>
          <i className={styles.legendViolation} /> violation
        </span>
      </div>

      <div className={styles.cases}>
        <div className={styles.caseCard} data-case="speed">
          <span className={styles.caseIcon}>
            <Gauge size={18} />
          </span>
          <span>
            <span className={styles.caseTitle}>V2 · Over the speed limit</span>
            <span className={styles.caseText}>71 km/h in a 60 km/h zone</span>
            <span className={styles.caseMeta}>Car #2041 · 3 photos saved · sent to officer</span>
          </span>
        </div>
        <div className={`${styles.caseCard} ${styles.caseHidden}`} data-case="helmet">
          <span className={styles.caseIcon}>
            <HardHat size={18} />
          </span>
          <span>
            <span className={styles.caseTitle}>V6 · Riding without a helmet</span>
            <span className={styles.caseText}>Bare head in 5 of 6 frames</span>
            <span className={styles.caseMeta}>
              Motorbike #773 · 2 photos saved · sent to officer
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Nav({ theme, onToggleTheme }: { theme: string; onToggleTheme: (e: MouseEvent) => void }) {
  return (
    <header className={styles.nav}>
      <div className={`${styles.shell} ${styles.navInner}`}>
        <Link href={RouteUrls.root} className={styles.brand}>
          <span className={styles.brandMark}>
            <TrafficCone size={18} />
          </span>
          Dhaka Traffic
        </Link>
        <nav className={styles.navLinks} aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#violations">Violations</a>
          <a href="#owners">For vehicle owners</a>
        </nav>
        <div className={styles.navActions}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <Link href={RouteUrls.auth.signin} className={styles.btnGhost}>
            Sign in
          </Link>
          <Link href={RouteUrls.auth.signup} className={`${styles.btnPrimary} ${styles.navCta}`}>
            Create account
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function TrafficLanding() {
  const root = useRef<HTMLDivElement>(null);
  const { theme, toggle } = useLandingTheme('traffic');

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        // --- Hero: headline words rise in, the "road marking" under the key word paints itself ---
        const title = el.querySelector<HTMLElement>('[data-hero-title]');
        const split = title ? new SplitText(title, { type: 'words' }) : undefined;
        if (split) {
          gsap.from(split.words, {
            yPercent: 45,
            opacity: 0,
            duration: 0.6,
            ease: 'power3.out',
            stagger: 0.05,
          });
        }
        gsap.from('[data-marking]', {
          scaleX: 0,
          transformOrigin: 'left center',
          duration: 0.7,
          ease: 'power2.inOut',
          delay: 0.55,
        });
        gsap.from('[data-hero-fade]', {
          y: 16,
          opacity: 0,
          duration: 0.6,
          ease: 'power2.out',
          stagger: 0.08,
          delay: 0.3,
        });
        gsap.from('[data-feed]', {
          y: 28,
          opacity: 0,
          duration: 0.8,
          ease: 'power3.out',
          delay: 0.2,
        });

        // --- Camera view: vehicles drive along their lanes; scale and fade come from the perspective ---
        const drive = (v: Vehicle, node: SVGGElement, proxy: { y: number }) => () => {
          const p = place(v.lane, proxy.y);
          node.setAttribute('transform', p.transform);
          node.setAttribute('opacity', p.opacity.toFixed(2));
        };
        const span = (v: Vehicle) =>
          v.toward
            ? { from: FAR_Y, to: NEAR_Y, ease: 'power2.in' }
            : { from: NEAR_Y, to: FAR_Y, ease: 'power2.out' };

        TRAFFIC.forEach((v) => {
          const node = el.querySelector<SVGGElement>(`[data-vehicle="${v.id}"]`);
          if (!node) return;
          const s = span(v);
          const proxy = { y: s.from };
          gsap.fromTo(
            proxy,
            { y: s.from },
            {
              y: s.to,
              duration: v.duration,
              ease: s.ease,
              delay: v.delay,
              repeat: -1,
              onUpdate: drive(v, node, proxy),
            },
          );
          drive(v, node, proxy)(); // parked off-screen until its delay is over
        });

        // --- The two flagged vehicles and their case cards, one 12 s loop ---
        const events = gsap.timeline({ repeat: -1, delay: 0.8 });
        (
          [
            [SPEEDER, 'speed', 3.6, 6.6],
            [RIDER, 'helmet', 1.6, 5.6],
          ] as const
        ).forEach(([v, caseKey, flagAt, cardOut]) => {
          const node = el.querySelector<SVGGElement>(`[data-vehicle="${v.id}"]`);
          const card = el.querySelector<HTMLElement>(`[data-case="${caseKey}"]`);
          if (!node || !card) return;
          gsap.set(card, { opacity: 0, x: 18, display: 'flex' });
          const s = span(v);
          const proxy = { y: s.from };
          const t0 = v.delay;
          events
            .call(() => node.setAttribute('data-state', 'ok'), [], t0)
            .fromTo(
              proxy,
              { y: s.from },
              { y: s.to, duration: v.duration, ease: s.ease, onUpdate: drive(v, node, proxy) },
              t0,
            )
            .call(() => node.setAttribute('data-state', 'violation'), [], t0 + flagAt)
            .to(card, { opacity: 1, x: 0, duration: 0.4, ease: 'power3.out' }, t0 + flagAt + 0.1)
            .to(card, { opacity: 0, x: 18, duration: 0.35, ease: 'power2.in' }, t0 + cardOut);
          drive(v, node, proxy)();
        });

        // --- Sections reveal as they scroll in ---
        const reveal = Array.from(el.querySelectorAll<HTMLElement>('[data-reveal]'));
        gsap.set(reveal, { opacity: 0, y: 26 });
        ScrollTrigger.batch(reveal, {
          start: 'top 88%',
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', stagger: 0.07 }),
        });
        ScrollTrigger.refresh();

        return () => split?.revert();
      });

      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div
      ref={root}
      data-theme={theme}
      className={`${display.variable} ${body.variable} ${mono.variable} ${styles.page}`}
    >
      <Nav theme={theme} onToggleTheme={(e) => toggle(e, root.current)} />

      {/* ---------------- Hero ---------------- */}
      <section className={styles.hero}>
        <div className={`${styles.shell} ${styles.heroGrid}`}>
          <div>
            <span className={styles.eyebrow} data-hero-fade>
              <span className={styles.eyebrowDot} /> AI traffic enforcement · Dhaka
            </span>
            <h1 className={`${styles.display} ${styles.heroTitle}`} data-hero-title>
              Every violation, with the{' '}
              <span className={styles.accent}>
                evidence
                <span className={styles.marking} data-marking aria-hidden />
              </span>{' '}
              to prove it.
            </h1>
            <p className={styles.heroLede} data-hero-fade>
              Overpass cameras detect and track every vehicle, measure its speed and check eight
              traffic rules. An officer reviews each case before a ticket is sent, and owners see
              the same photos, pay online or ask for a review.
            </p>
            <div className={styles.heroActions} data-hero-fade>
              <Link
                href={RouteUrls.auth.signin}
                className={`${styles.btnPrimary} ${styles.btnLarge}`}
              >
                Check my cases <ArrowRight size={18} />
              </Link>
              <a href="#how" className={`${styles.btnGhost} ${styles.btnLarge}`}>
                How it works
              </a>
            </div>
            <p className={styles.heroNote} data-hero-fade>
              Officers and administrators sign in with the account the traffic division gave them.
            </p>
          </div>
          <CameraFeed />
        </div>
      </section>

      {/* ---------------- Facts ---------------- */}
      <section className={styles.facts} aria-label="The system in numbers">
        <div className={`${styles.shell} ${styles.factsGrid}`} data-reveal>
          {FACTS.map((f) => (
            <div key={f.label} className={styles.fact}>
              <span className={`${styles.display} ${styles.factValue}`}>
                {f.value}
                {f.unit && <small>{f.unit}</small>}
              </span>
              <span className={styles.factLabel}>{f.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- How it works ---------------- */}
      <section id="how" className={styles.section}>
        <div className={styles.shell}>
          <div className={styles.sectionHead} data-reveal>
            <span className={styles.kicker}>How it works</span>
            <h2 className={`${styles.display} ${styles.sectionTitle}`}>
              From the camera to a closed case
            </h2>
            <p className={styles.sectionLede}>
              The cameras do the watching and the measuring. People make the decisions.
            </p>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((s, i) => (
              <li key={s.title} className={styles.step} data-reveal>
                <span className={styles.stepTop}>
                  <span className={styles.stepIcon}>
                    <s.icon size={20} />
                  </span>
                  <span className={styles.stepNo}>0{i + 1}</span>
                </span>
                <h3 className={styles.stepTitle}>{s.title}</h3>
                <p className={styles.stepText}>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------- Violations ---------------- */}
      <section id="violations" className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.shell}>
          <div className={styles.sectionHead} data-reveal>
            <span className={styles.kicker}>What the cameras check</span>
            <h2 className={`${styles.display} ${styles.sectionTitle}`}>
              Eight rules, each with its own evidence
            </h2>
            <p className={styles.sectionLede}>
              A rule only runs where its road zones are drawn and measured, so nothing is flagged on
              guesswork.
            </p>
          </div>
          <div className={styles.violations}>
            {VIOLATIONS.map((v) => (
              <article key={v.code} className={styles.violation} data-reveal>
                <span className={styles.violationTop}>
                  <span className={styles.violationIcon}>
                    <v.icon size={19} />
                  </span>
                  <span className={styles.code}>{v.code}</span>
                </span>
                <h3 className={styles.violationTitle}>{v.title}</h3>
                <p className={styles.violationText}>{v.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Owners ---------------- */}
      <section id="owners" className={styles.section}>
        <div className={`${styles.shell} ${styles.ownersGrid}`}>
          <div data-reveal>
            <span className={styles.kicker}>For vehicle owners</span>
            <h2 className={`${styles.display} ${styles.sectionTitle}`}>
              Got a ticket? See exactly what the camera saw.
            </h2>
            <ul className={styles.checks}>
              <li>Photos of your vehicle, the time, the place and what was measured.</li>
              <li>Pay online by card, bKash, Nagad or Rocket; the invoice is emailed to you.</li>
              <li>Disagree? Apply for a review and an officer looks at the case again.</li>
            </ul>
            <div className={styles.heroActions}>
              <Link href={RouteUrls.auth.signup} className={styles.btnPrimary}>
                Create an account <ArrowRight size={17} />
              </Link>
              <Link href={RouteUrls.auth.signin} className={styles.btnGhost}>
                I already have one
              </Link>
            </div>
            <p className={styles.heroNote}>
              Register with the email that is on your vehicle&apos;s registration.
            </p>
          </div>

          <div className={styles.ticket} data-reveal aria-label="Example of a violation notice">
            <div className={styles.ticketHead}>
              <span>
                <span className={styles.ticketKicker}>Traffic violation notice</span>
                <span className={styles.ticketCase}>Case KAK-01-0412 · example</span>
              </span>
              <span className={styles.verified}>
                <ShieldCheck size={14} /> Verified by officer
              </span>
            </div>
            <div className={styles.ticketPhoto} aria-hidden>
              <span className={styles.ticketBox}>
                <span>V2 · 71 km/h</span>
              </span>
              <span className={styles.ticketPhotoNote}>Evidence photo 1 of 3</span>
            </div>
            <dl className={styles.ticketRows}>
              <div>
                <dt>Violation</dt>
                <dd>V2 · Over the speed limit</dd>
              </div>
              <div>
                <dt>Measured</dt>
                <dd>71 km/h in a 60 km/h zone</dd>
              </div>
              <div>
                <dt>Where</dt>
                <dd>Kakoli overpass, Banani</dd>
              </div>
              <div>
                <dt>When</dt>
                <dd>22 Sep 2026, 17:46</dd>
              </div>
              <div>
                <dt>Plate</dt>
                <dd className={styles.plate}>DHAKA METRO-GA 12-3456</dd>
              </div>
            </dl>
            <div className={styles.ticketActions} aria-hidden>
              <span className={styles.btnPrimary}>Pay the fine</span>
              <span className={styles.btnGhost}>Apply for review</span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Roles ---------------- */}
      <section className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.shell}>
          <div className={styles.sectionHead} data-reveal>
            <span className={styles.kicker}>One system, three portals</span>
            <h2 className={`${styles.display} ${styles.sectionTitle}`}>
              Everyone sees the part they need
            </h2>
          </div>
          <div className={styles.roles}>
            {ROLES.map((r) => (
              <article key={r.title} className={styles.role} data-reveal>
                <span className={styles.stepIcon}>
                  <r.icon size={20} />
                </span>
                <h3 className={styles.stepTitle}>{r.title}</h3>
                <p className={styles.stepText}>{r.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Call to action ---------------- */}
      <section className={styles.ctaWrap}>
        <div className={`${styles.shell} ${styles.cta}`} data-reveal>
          <div>
            <h2 className={`${styles.display} ${styles.ctaTitle}`}>Check your cases in a minute</h2>
            <p className={styles.ctaText}>
              Sign in to see open tickets, the evidence behind them, and pay or appeal.
            </p>
          </div>
          <div className={styles.heroActions}>
            <Link href={RouteUrls.auth.signin} className={`${styles.btnLight} ${styles.btnLarge}`}>
              Sign in <ArrowRight size={18} />
            </Link>
            <Link
              href={RouteUrls.auth.signup}
              className={`${styles.btnOutlineLight} ${styles.btnLarge}`}
            >
              Create account
            </Link>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={`${styles.shell} ${styles.footerInner}`}>
          <span className={styles.brand}>
            <span className={styles.brandMark}>
              <TrafficCone size={16} />
            </span>
            Dhaka Traffic
          </span>
          <span className={styles.footerNote}>
            AI-assisted traffic enforcement · CSE 499 project
          </span>
          <span className={styles.footerLinks}>
            <a href="#how">How it works</a>
            <Link href={RouteUrls.auth.signin}>Sign in</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
