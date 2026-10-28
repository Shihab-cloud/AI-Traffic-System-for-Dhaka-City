'use client';

import { Box, Paper, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';

import { Icons, type IconType } from '@/lib/icons';

/* A still frame of an overpass camera: perspective road, the measured road zone, tracked vehicles with their speed,
 * one flagged. Same picture as the home page's hero, without the motion. Camera colours are fixed (a feed is dark in
 * both themes). `at(f, y)`: road-contact point of lane position f (0 left kerb, 1 right kerb) at height y. */
const ROAD = { top: 30, bottom: 320, leftTop: 262, widthTop: 36, leftBottom: 20, widthBottom: 520 };
const DET = '#36d399';
const VIOL = '#ff4d4f';
/** "Verified" green: the theme's success colour is the brand purple. */
const GREEN = { light: '#15803d', dark: '#3fcf7f' } as const;

function at(f: number, y: number) {
  const t = (y - ROAD.top) / (ROAD.bottom - ROAD.top);
  const left = ROAD.leftTop + (ROAD.leftBottom - ROAD.leftTop) * t;
  const width = ROAD.widthTop + (ROAD.widthBottom - ROAD.widthTop) * t;
  return { x: left + f * width, s: width / ROAD.widthBottom };
}

type Kind = 'car' | 'bus' | 'cng' | 'bike';
const BODY: Record<Kind, { w: number; h: number; rx: number; fill: string }> = {
  car: { w: 54, h: 35, rx: 9, fill: '#d6dbe4' },
  bus: { w: 68, h: 82, rx: 8, fill: '#c8463d' },
  cng: { w: 42, h: 40, rx: 14, fill: '#2f9e5b' },
  bike: { w: 16, h: 40, rx: 7, fill: '#2c3e66' },
};

const SCENE: {
  kind: Kind;
  f: number;
  y: number;
  label: string;
  fill?: string;
  flagged?: boolean;
}[] = [
  { kind: 'car', f: 0.583, y: 70, label: 'MPV 27 km/h', fill: '#f1f1ee' },
  { kind: 'cng', f: 0.917, y: 128, label: 'CNG 29 km/h' },
  { kind: 'car', f: 0.75, y: 205, label: 'V2 · 71 km/h', fill: '#b9312c', flagged: true },
  { kind: 'car', f: 0.583, y: 298, label: 'CAR 31 km/h' },
  { kind: 'car', f: 0.417, y: 110, label: 'CAR 26 km/h', fill: '#3d6fc2' },
  { kind: 'bike', f: 0.25, y: 190, label: 'BIKE 31 km/h' },
  { kind: 'bus', f: 0.083, y: 300, label: 'BUS 20 km/h', fill: '#2f8a57' },
];

function laneLine(f: number) {
  return {
    x1: ROAD.leftTop + f * ROAD.widthTop,
    y1: ROAD.top,
    x2: ROAD.leftBottom + f * ROAD.widthBottom,
    y2: ROAD.bottom,
  };
}

function CameraStill() {
  const zone = [at(0.5, 100), at(1, 100), at(1, 300), at(0.5, 300)];
  return (
    <svg
      viewBox="0 0 560 320"
      style={{ display: 'block', width: '100%', height: 'auto' }}
      aria-hidden
    >
      <rect width={560} height={320} fill="#0a111d" />
      <polygon
        points={`${ROAD.leftTop},${ROAD.top} ${ROAD.leftTop + ROAD.widthTop},${ROAD.top} ${ROAD.leftBottom + ROAD.widthBottom},${ROAD.bottom} ${ROAD.leftBottom},${ROAD.bottom}`}
        fill="#232d3e"
      />
      {[1 / 6, 2 / 6, 4 / 6, 5 / 6].map((f) => (
        <line
          key={f}
          {...laneLine(f)}
          stroke="rgba(255,255,255,0.5)"
          strokeWidth={1.4}
          strokeDasharray="10 14"
        />
      ))}
      <line {...laneLine(0.494)} stroke="#f2c14e" strokeWidth={1.4} />
      <line {...laneLine(0.506)} stroke="#f2c14e" strokeWidth={1.4} />
      <polygon
        points={zone
          .map((p, i) => `${p.x + (i % 3 === 0 ? 3 : -3)},${i < 2 ? 100 : 300}`)
          .join(' ')}
        fill="rgba(90,176,255,0.07)"
        stroke="#5ab0ff"
        strokeWidth={1.2}
        strokeDasharray="6 5"
      />
      <text
        x={zone[0].x + 6}
        y={93}
        fill="#a9d4ff"
        fontSize={9}
        fontFamily="monospace"
        fontWeight={600}
      >
        ROAD ZONE 10.5 × 90 m
      </text>
      {SCENE.map((v) => {
        const p = at(v.f, v.y);
        const b = BODY[v.kind];
        const color = v.flagged ? VIOL : DET;
        const labelW = v.label.length * 6.4 + 10;
        return (
          <g key={`${v.kind}${v.f}${v.y}`} transform={`translate(${p.x} ${v.y}) scale(${p.s})`}>
            <rect
              x={-b.w / 2}
              y={-b.h}
              width={b.w}
              height={b.h}
              rx={b.rx}
              fill={v.fill ?? b.fill}
            />
            {v.kind !== 'bike' && (
              <rect
                x={-b.w / 2 + 6}
                y={-b.h + 5}
                width={b.w - 12}
                height={b.h * 0.3}
                rx={4}
                fill="rgba(9,16,28,0.72)"
              />
            )}
            {v.kind === 'bike' && <circle cx={0} cy={-b.h - 6} r={7} fill="#3a2a22" />}
            <rect
              x={-b.w / 2 - 6}
              y={-b.h - (v.kind === 'bike' ? 20 : 6)}
              width={b.w + 12}
              height={b.h + (v.kind === 'bike' ? 26 : 12)}
              rx={4}
              fill="none"
              stroke={color}
              strokeWidth={v.flagged ? 2.6 : 2}
              vectorEffect="non-scaling-stroke"
            />
            <g transform={`translate(${-b.w / 2 - 6} ${-b.h - (v.kind === 'bike' ? 20 : 6) - 17})`}>
              <rect width={labelW} height={15} rx={3} fill={color} />
              <text
                x={5}
                y={11}
                fontSize={10}
                fontFamily="monospace"
                fontWeight={700}
                fill={v.flagged ? '#fff' : '#04210f'}
              >
                {v.label}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Side panel of the sign-in and register pages: a camera still with a flagged vehicle and its case card, then what
 * the page is for. Replaces the template's generic illustrations.
 */
export default function AuthTrafficPanel({ title, points }: { title: string; points: string[] }) {
  return (
    <Stack spacing={4} sx={{ width: '100%', maxWidth: 560 }}>
      <Box sx={{ position: 'relative', pb: 3 }}>
        <Box
          sx={{
            borderRadius: '16px',
            overflow: 'hidden',
            boxShadow: '0 30px 60px -30px rgba(10,20,40,0.55)',
          }}
        >
          <CameraStill />
        </Box>
        <Box
          sx={{
            position: 'absolute',
            top: 12,
            left: 12,
            px: 1,
            py: 0.5,
            borderRadius: '6px',
            bgcolor: 'rgba(5,10,18,0.62)',
            color: 'rgba(255,255,255,0.86)',
            fontFamily: 'monospace',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          <Box component="span" sx={{ color: '#ff8a8a' }}>
            ● REC
          </Box>{' '}
          CAM KAK-01 · Kakoli overpass
        </Box>
        <Paper
          elevation={0}
          sx={{
            position: 'absolute',
            right: { xs: 8, xl: -16 },
            bottom: 0,
            display: 'flex',
            gap: 1.5,
            alignItems: 'flex-start',
            p: 1.5,
            width: 300,
            maxWidth: '85%',
            borderRadius: '14px',
            border: 1,
            borderColor: 'divider',
            boxShadow: '0 24px 50px -24px rgba(10,20,40,0.45)',
          }}
        >
          <Box
            sx={{
              display: 'grid',
              placeItems: 'center',
              flex: 'none',
              width: 36,
              height: 36,
              borderRadius: '10px',
              bgcolor: 'rgba(229,72,77,0.12)',
              color: '#e5484d',
            }}
          >
            <Icons.speed size={18} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              V2 · Over the speed limit
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div">
              71 km/h in a 60 km/h zone
            </Typography>
            <Typography
              variant="caption"
              component="div"
              sx={{
                mt: 0.5,
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                color: (t) => GREEN[t.palette.mode],
                fontWeight: 600,
              }}
            >
              <Icons.verified size={13} /> Verified by an officer
            </Typography>
          </Box>
        </Paper>
      </Box>

      <Box>
        <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
          {title}
        </Typography>
        <Stack component="ul" spacing={1.25} sx={{ listStyle: 'none', p: 0, m: 0, mt: 2 }}>
          {points.map((p) => (
            <Box
              component="li"
              key={p}
              sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}
            >
              <Box
                sx={{
                  display: 'grid',
                  placeItems: 'center',
                  flex: 'none',
                  width: 22,
                  height: 22,
                  mt: '1px',
                  borderRadius: '50%',
                  bgcolor: 'rgba(22,163,74,0.14)',
                  color: (t) => GREEN[t.palette.mode],
                }}
              >
                <Icons.check size={13} />
              </Box>
              <Typography variant="body1" color="text.secondary">
                {p}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}

/** Round icon with a dashed road marking under it: the picture on the password and access pages. */
export function AuthBadge({
  icon: Icon,
  tone = 'primary',
}: {
  icon: IconType;
  tone?: 'primary' | 'error';
}) {
  return (
    <Stack spacing={1.5} sx={{ alignItems: 'center' }} aria-hidden>
      <Box
        sx={{
          display: 'grid',
          placeItems: 'center',
          width: 112,
          height: 112,
          borderRadius: '50%',
          bgcolor: (t) =>
            alpha(tone === 'error' ? t.palette.error.main : t.palette.primary.main, 0.12),
          color: tone === 'error' ? 'error.main' : 'primary.main',
        }}
      >
        <Icon size={48} strokeWidth={1.75} />
      </Box>
      <Box
        sx={{
          width: 120,
          height: 5,
          borderRadius: '2px',
          background: 'repeating-linear-gradient(90deg, #f5a524 0 18px, transparent 18px 28px)',
        }}
      />
    </Stack>
  );
}
