'use client';

import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';

import { Icons } from '@/lib/icons';
import type { Camera, CameraZones, ZoneConfig } from '@/lib/types/traffic.types';
import { CORNERS, homography, project, type Pt } from './speedZone.util';

const AREA_TYPES: Record<string, { label: string; color: string }> = {
  no_parking: { label: 'No-parking kerb (V3)', color: '#e63c3c' },
  bus_stop: { label: 'Bus stop (V1)', color: '#00c800' },
  intersection: { label: 'Intersection (V1)', color: '#e6e6e6' },
  signal: { label: 'Signal queue area', color: '#ffdc00' },
  parking: { label: 'Legal parking', color: '#0078ff' },
  uturn: { label: 'U-turn opening', color: '#c800c8' },
};
const ROAD_COLOR = '#00c8ff';
const LINE_COLOR = '#ffffff';
const CLASSES = [
  'Bus',
  'Car',
  'MPV',
  'Pickup',
  'Truck',
  'CNG',
  'Easybike',
  'Leguna',
  'Motorbike',
  'Bhotbhoti',
  'PowerTiller',
  'Rickshaw',
  'Bicycle',
  'Van',
  'Wheelbarrow',
];

type Mode = { kind: 'road' } | { kind: 'area'; type: string } | { kind: 'line' } | null;
/** What a drag moves: corner `vi` (vertex) or all (move) of zone / lane line `i`. */
type DragTarget = { kind: 'vertex' | 'move'; target: 'zone' | 'line'; i: number; vi: number };

/** Fields that mark a road zone's size as measured by a person (no longer from automatic calibration). */
const MEASURED: Partial<ZoneConfig> = { scale_source: 'measured', speed_uncertainty_pct: null };

/** A road zone with its width and length (typed, or from Auto zones). */
const sized = (z: ZoneConfig) => Number(z.width_m) > 0 && Number(z.length_m) > 0;
const colorOf = (z: ZoneConfig) =>
  (z.type ?? 'road') === 'road' ? ROAD_COLOR : (AREA_TYPES[z.type ?? '']?.color ?? '#999');
const DIRECTION_LABEL: Record<string, string> = {
  both: 'both ways',
  toward_camera: 'toward the camera',
  away_from_camera: 'away from the camera',
};

/**
 * A no-parking kerb strip along one edge of a road zone, `widthM` wide over its whole length (the CSE499B zone
 * editor's "+ Left edge / + Right edge"). Left / right as seen from the camera; the road zone's corners are in click
 * order (far-left, far-right, near-right, near-left), which is the metric rectangle (0,0), (W,0), (W,L), (0,L).
 */
export function kerbStrip(road: ZoneConfig, side: 'left' | 'right', widthM = 3): Pt[] {
  const W = Number(road.width_m);
  const L = Number(road.length_m);
  const h = homography(
    [
      [0, 0],
      [W, 0],
      [W, L],
      [0, L],
    ],
    road.points as Pt[],
  );
  const x0 = side === 'left' ? 0 : W - widthM;
  const x1 = side === 'left' ? widthM : W;
  const strip: Pt[] = [
    [x0, 0],
    [x1, 0],
    [x1, L],
    [x0, L],
  ];
  return strip.map((p) => project(h, p));
}

/** Zones drawn on a frame of another size, scaled to `w` x `h` (the pipelines do the same when they load them). */
export function fitZones(z: CameraZones, w: number, h: number): CameraZones {
  const [fw, fh] = z.frame_size ?? [w, h];
  if (fw === w && fh === h) return z;
  const s = ([x, y]: [number, number]): [number, number] => [
    Math.round((x * w) / fw),
    Math.round((y * h) / fh),
  ];
  return {
    ...z,
    frame_size: [w, h],
    zones: z.zones.map((zone) => ({ ...zone, points: zone.points.map(s) })),
    lane_lines: (z.lane_lines ?? []).map((l) => ({ ...l, points: l.points.map(s) })),
  };
}

/**
 * Draws a camera's zones on one of its frames. Points are stored in the frame's own pixels (`frame_size`); the
 * pipelines rescale them if the video they run on has another resolution.
 */
export default function ZoneEditor({
  value,
  onChange,
  image,
  frameSize,
  learning,
  purpose,
}: {
  value: CameraZones;
  onChange: (z: CameraZones) => void;
  image: string | null;
  frameSize: [number, number];
  /** Directions observed by the last "other violations" run, offered as each road zone's allowed direction. */
  learning?: Camera['learning'];
  /** The box the zones are edited for; the other-violations box hides the speed settings. Unset: everything. */
  purpose?: 'speed' | 'violations';
}) {
  const [W, H] = frameSize;
  const svgRef = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [clicks, setClicks] = useState<Pt[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [selLine, setSelLine] = useState<number | null>(null);
  // Dragging a corner (vertex) or a whole shape (move) of the selected zone / lane line. While the button is down
  // the shapes live in `draft` (this editor only) and reach `onChange` once, on release; pointer moves are applied
  // at most once per screen frame. A fast mouse otherwise queues updates of the whole dialog faster than it
  // renders, and React stops with "Maximum update depth exceeded".
  const [drag, setDrag] = useState<DragTarget | null>(null);
  const dragRef = useRef<
    (DragTarget & { start: Pt; base: CameraZones; to: Pt | null; frame: number }) | null
  >(null);
  const [draft, setDraft] = useState<CameraZones | null>(null);
  useEffect(() => () => cancelAnimationFrame(dragRef.current?.frame ?? 0), []);
  const undo = useRef<CameraZones[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const shown = draft ?? value;
  const zones = shown.zones ?? [];
  const lines = shown.lane_lines ?? [];
  const stroke = Math.max(2, W / 500);

  const toFrame = (e: React.MouseEvent): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [
      Math.round(((e.clientX - r.left) / r.width) * W),
      Math.round(((e.clientY - r.top) / r.height) * H),
    ];
  };
  const remember = () => {
    undo.current = [...undo.current.slice(-49), value];
    setUndoCount(undo.current.length);
  };
  const save = (z: Partial<CameraZones>) => {
    remember();
    onChange({ ...value, frame_size: frameSize, ...z });
  };
  const undoLast = () => {
    const prev = undo.current.pop();
    setUndoCount(undo.current.length);
    if (prev) {
      onChange(prev);
      // keep the selection while that shape still exists (undoing a move); drop it when the undo removed it
      if (selected != null && selected >= (prev.zones ?? []).length) setSelected(null);
      if (selLine != null && selLine >= (prev.lane_lines ?? []).length) setSelLine(null);
    }
  };

  const startDrag = (e: React.PointerEvent, d: DragTarget) => {
    if (mode) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { ...d, start: toFrame(e), base: value, to: null, frame: 0 };
    setDrag(d);
  };
  /** The shapes with the dragged one moved so that the pointer, which went down at `start`, is now at `to`. */
  const dragged = (to: Pt): CameraZones => {
    const d = dragRef.current!;
    const dx = to[0] - d.start[0];
    const dy = to[1] - d.start[1];
    const moved = (pts: Pt[]) =>
      d.kind === 'vertex'
        ? pts.map((q, k) => (k === d.vi ? to : q))
        : pts.map(([x, y]): Pt => [x + dx, y + dy]);
    const b = d.base;
    return d.target === 'zone'
      ? {
          ...b,
          frame_size: frameSize,
          zones: b.zones.map((z, k) => (k === d.i ? { ...z, points: moved(z.points as Pt[]) } : z)),
        }
      : {
          ...b,
          frame_size: frameSize,
          lane_lines: (b.lane_lines ?? []).map((l, k) =>
            k === d.i ? { ...l, points: moved(l.points as Pt[]) } : l,
          ),
        };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toFrame(e);
    if (p[0] === d.start[0] && p[1] === d.start[1] && !d.to) return;
    d.to = p;
    if (!d.frame)
      d.frame = requestAnimationFrame(() => {
        d.frame = 0;
        if (dragRef.current === d && d.to) setDraft(dragged(d.to));
      });
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    svgRef.current?.releasePointerCapture(e.pointerId);
    cancelAnimationFrame(d.frame);
    if (d.to) {
      remember(); // one undo step per drag (`value` is still the state before it), none for a plain click
      onChange(dragged(d.to));
    }
    dragRef.current = null;
    setDraft(null);
    setDrag(null);
  };

  const finish = (pts: Pt[]) => {
    if (!mode) return;
    if (mode.kind === 'line') {
      save({ lane_lines: [...lines, { name: `line${lines.length + 1}`, points: pts }] });
    } else if (mode.kind === 'road') {
      const n = zones.filter((z) => (z.type ?? 'road') === 'road').length + 1;
      save({
        zones: [
          ...zones,
          {
            name: `road${n}`,
            type: 'road',
            points: pts,
            width_m: 0,
            length_m: 0,
            road_category: 'city',
            allowed_direction: 'both',
            speed_limit_kph: null,
            banned_classes: [],
            stopping_allowed: false,
          },
        ],
      });
      setSelected(zones.length);
    } else {
      save({
        zones: [
          ...zones,
          { name: `${mode.type}${zones.length + 1}`, type: mode.type, points: pts },
        ],
      });
      setSelected(zones.length);
    }
    setClicks([]);
    setMode(null);
  };

  const onClick = (e: React.MouseEvent) => {
    if (!mode) return;
    const pts = [...clicks, toFrame(e)];
    if ((mode.kind === 'road' && pts.length === 4) || (mode.kind === 'line' && pts.length === 2))
      finish(pts);
    else setClicks(pts);
  };

  const update = (i: number, patch: Partial<ZoneConfig>) =>
    save({ zones: zones.map((z, k) => (k === i ? { ...z, ...patch } : z)) });
  const [kerbWidth, setKerbWidth] = useState(3);
  const addKerb = (road: ZoneConfig, side: 'left' | 'right') => {
    save({
      zones: [
        ...zones,
        {
          name: `${road.name} ${side} kerb`,
          type: 'no_parking',
          // without a size (other violations): a quarter of the zone's width, to be adjusted by dragging
          points: sized(road)
            ? kerbStrip(road, side, kerbWidth)
            : kerbStrip({ ...road, width_m: 1, length_m: 1 }, side, 0.25),
        },
      ],
    });
    setSelected(zones.length);
  };
  const importFile = async (f: File) => {
    try {
      const cfg = JSON.parse(await f.text()) as CameraZones;
      if (!Array.isArray(cfg.zones)) throw new Error('no "zones" list');
      remember();
      onChange({
        ...value,
        ...fitZones({ ...cfg, frame_size: cfg.frame_size ?? frameSize }, W, H),
        frame_size: frameSize,
      });
      setSelected(null);
    } catch (e) {
      alert(`Not a zone file: ${(e as Error).message}`);
    }
  };
  const hint =
    mode?.kind === 'road'
      ? `Road zone: click the ${CORNERS[clicks.length]} corner (${purpose === 'violations' ? 'a rectangle on the road; no measuring needed' : 'a real rectangle on the road whose size you measured'})`
      : mode?.kind === 'line'
        ? `Solid lane line: click end ${clicks.length + 1} of 2`
        : mode?.kind === 'area'
          ? `${AREA_TYPES[mode.type].label}: click the outline (${clicks.length} points), then Finish`
          : selected != null || selLine != null
            ? 'Drag a white corner to move it, or drag the shape itself to move all of it. Undo reverts the last change.'
            : null;
  const z = selected != null ? zones[selected] : null;

  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 340px' } }}>
      <Box>
        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
          <Button
            size="small"
            variant={mode?.kind === 'road' ? 'contained' : 'outlined'}
            onClick={() => {
              setMode({ kind: 'road' });
              setClicks([]);
            }}
          >
            + Road zone
          </Button>
          <TextField
            select
            size="small"
            label="+ Area"
            value=""
            sx={{ minWidth: 150 }}
            onChange={(e) => {
              setMode({ kind: 'area', type: e.target.value });
              setClicks([]);
            }}
          >
            {Object.entries(AREA_TYPES).map(([k, a]) => (
              <MenuItem key={k} value={k}>
                {a.label}
              </MenuItem>
            ))}
          </TextField>
          <Button
            size="small"
            variant={mode?.kind === 'line' ? 'contained' : 'outlined'}
            onClick={() => {
              setMode({ kind: 'line' });
              setClicks([]);
            }}
          >
            + Solid lane line
          </Button>
          {mode?.kind === 'area' && (
            <Button
              size="small"
              variant="contained"
              disabled={clicks.length < 3}
              onClick={() => finish(clicks)}
            >
              Finish area
            </Button>
          )}
          {mode && (
            <Button
              size="small"
              onClick={() => (clicks.length ? setClicks(clicks.slice(0, -1)) : setMode(null))}
            >
              {clicks.length ? 'Undo point' : 'Cancel'}
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button size="small" startIcon={<Icons.undo />} disabled={!undoCount} onClick={undoLast}>
            Undo
          </Button>
          <Button size="small" component="label" startIcon={<Icons.upload />}>
            Import zone file
            <input
              hidden
              type="file"
              accept=".json,application/json"
              onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
            />
          </Button>
        </Stack>
        {hint && (
          <Alert severity="info" sx={{ mb: 1, py: 0 }}>
            {hint}
          </Alert>
        )}
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            aspectRatio: `${W} / ${H}`,
            bgcolor: '#0b0f14',
            borderRadius: 1.5,
            overflow: 'hidden',
          }}
        >
          {image && (
            <Box
              component="img"
              src={image}
              alt="Camera frame"
              sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            />
          )}
          {!image && (
            <Typography
              variant="body2"
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                color: 'grey.500',
              }}
            >
              Load a frame from the camera to draw on it
            </Typography>
          )}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            onClick={onClick}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              cursor: mode ? 'crosshair' : drag ? 'grabbing' : 'default',
              touchAction: 'none',
            }}
          >
            {zones.map((zone, i) => (
              <g
                key={i}
                onClick={(e) => {
                  if (!mode) {
                    e.stopPropagation();
                    setSelected(i);
                    setSelLine(null);
                  }
                }}
                style={{ cursor: mode ? 'crosshair' : selected === i ? 'move' : 'pointer' }}
              >
                <polygon
                  points={zone.points.map((p) => p.join(',')).join(' ')}
                  fill={colorOf(zone)}
                  fillOpacity={selected === i ? 0.3 : 0.15}
                  stroke={colorOf(zone)}
                  strokeWidth={selected === i ? stroke * 2 : stroke}
                  onPointerDown={(e) =>
                    selected === i && startDrag(e, { kind: 'move', target: 'zone', i, vi: -1 })
                  }
                />
                {/* in the middle of the zone: far corners crowd together near the horizon */}
                <text
                  x={zone.points.reduce((s, p) => s + p[0], 0) / zone.points.length}
                  y={zone.points.reduce((s, p) => s + p[1], 0) / zone.points.length}
                  textAnchor="middle"
                  fill="#fff"
                  fontSize={W / 70}
                  stroke="#000"
                  strokeWidth={stroke / 2}
                  paintOrder="stroke"
                  style={{ pointerEvents: 'none' }}
                >
                  {zone.name}
                  {(zone.type ?? 'road') === 'road' && zone.width_m
                    ? ` ${zone.width_m} x ${zone.length_m} m`
                    : ''}
                  {zone.scale_source === 'auto' ? ' (auto)' : ''}
                </text>
              </g>
            ))}
            {lines.map((ln, i) => (
              <g
                key={`l${i}`}
                onClick={(e) => {
                  if (!mode) {
                    e.stopPropagation();
                    setSelLine(i);
                    setSelected(null);
                  }
                }}
                style={{ cursor: mode ? 'crosshair' : selLine === i ? 'move' : 'pointer' }}
                onPointerDown={(e) =>
                  selLine === i && startDrag(e, { kind: 'move', target: 'line', i, vi: -1 })
                }
              >
                {/* wide invisible stroke: a thin line is hard to click */}
                <line
                  x1={ln.points[0][0]}
                  y1={ln.points[0][1]}
                  x2={ln.points[1][0]}
                  y2={ln.points[1][1]}
                  stroke="transparent"
                  strokeWidth={stroke * 8}
                />
                <line
                  x1={ln.points[0][0]}
                  y1={ln.points[0][1]}
                  x2={ln.points[1][0]}
                  y2={ln.points[1][1]}
                  stroke={selLine === i ? '#ffeb3b' : LINE_COLOR}
                  strokeWidth={stroke * 1.5}
                />
              </g>
            ))}
            {/* corner handles of the selected zone / line: drag to adjust */}
            {!mode &&
              (selected != null
                ? (zones[selected]?.points ?? [])
                : selLine != null
                  ? (lines[selLine]?.points ?? [])
                  : []
              ).map((p, vi) => (
                <circle
                  key={`h${vi}`}
                  cx={p[0]}
                  cy={p[1]}
                  r={stroke * 4}
                  fill="#fff"
                  stroke="#000"
                  strokeWidth={stroke / 2}
                  style={{ cursor: 'grab' }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) =>
                    startDrag(
                      e,
                      selected != null
                        ? { kind: 'vertex', target: 'zone', i: selected, vi }
                        : { kind: 'vertex', target: 'line', i: selLine!, vi },
                    )
                  }
                />
              ))}
            {clicks.length > 1 && (
              <polyline
                points={clicks.map((p) => p.join(',')).join(' ')}
                fill="none"
                stroke="#ffeb3b"
                strokeWidth={stroke}
              />
            )}
            {clicks.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={stroke * 3} fill="#ffeb3b" />
            ))}
          </svg>
        </Box>
      </Box>

      <Stack spacing={1.5}>
        <Typography variant="subtitle2">
          Zones ({zones.length}) and lane lines ({lines.length})
        </Typography>
        {zones.map((zone, i) => (
          <Paper
            key={i}
            variant="outlined"
            onClick={() => {
              setSelected(i);
              setSelLine(null);
            }}
            sx={{
              p: 1,
              borderRadius: 1.5,
              cursor: 'pointer',
              borderColor: selected === i ? 'primary.main' : 'divider',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: '3px',
                bgcolor: colorOf(zone),
                flex: '0 0 auto',
              }}
            />
            <Typography variant="body2" sx={{ flex: 1 }} noWrap>
              {zone.name}{' '}
              <Typography component="span" variant="caption" color="text.secondary">
                ({zone.type ?? 'road'}
                {zone.scale_source === 'auto' ? ', auto size' : ''})
              </Typography>
            </Typography>
            {(zone.type ?? 'road') === 'road' &&
              !(Number(zone.width_m) > 0 && Number(zone.length_m) > 0) && (
                <Typography variant="caption" color="error.main">
                  size?
                </Typography>
              )}
            <IconButton
              size="small"
              aria-label="Delete zone"
              onClick={(e) => {
                e.stopPropagation();
                setSelected(null);
                save({ zones: zones.filter((_, k) => k !== i) });
              }}
            >
              <Icons.delete />
            </IconButton>
          </Paper>
        ))}
        {lines.map((ln, i) => (
          <Paper
            key={`l${i}`}
            variant="outlined"
            onClick={() => {
              setSelLine(i);
              setSelected(null);
            }}
            sx={{
              p: 1,
              borderRadius: 1.5,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              borderColor: selLine === i ? 'primary.main' : 'divider',
            }}
          >
            <Box sx={{ width: 12, height: 3, bgcolor: 'text.primary' }} />
            <TextField
              size="small"
              variant="standard"
              value={ln.name}
              onChange={(e) =>
                save({
                  lane_lines: lines.map((l, k) => (k === i ? { ...l, name: e.target.value } : l)),
                })
              }
              sx={{ flex: 1 }}
            />
            <IconButton
              size="small"
              aria-label="Delete line"
              onClick={(e) => {
                e.stopPropagation();
                setSelLine(null);
                save({ lane_lines: lines.filter((_, k) => k !== i) });
              }}
            >
              <Icons.delete />
            </IconButton>
          </Paper>
        ))}

        {z && (
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
            <Stack spacing={1.25}>
              <TextField
                size="small"
                label="Name"
                value={z.name}
                onChange={(e) => update(selected!, { name: e.target.value })}
              />
              {z.type === 'bus_stop' && (
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={!!z.approved}
                      onChange={(e) => update(selected!, { approved: e.target.checked })}
                    />
                  }
                  label={
                    <Typography variant="body2">
                      Officially approved mid-block bus bay (otherwise a bus stop counts only within
                      120 m after an intersection)
                    </Typography>
                  }
                />
              )}
              {(z.type ?? 'road') === 'road' && (
                <>
                  <Stack direction="row" spacing={1}>
                    {/* A typed size is a measured one: the zone leaves automatic calibration (and the speed box uses it). */}
                    <TextField
                      size="small"
                      type="number"
                      label="Width (m)"
                      value={z.width_m || ''}
                      onChange={(e) =>
                        update(selected!, { width_m: Number(e.target.value), ...MEASURED })
                      }
                      helperText={
                        purpose === 'violations' ? 'left to right, optional' : 'left to right edge'
                      }
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Length (m)"
                      value={z.length_m || ''}
                      onChange={(e) =>
                        update(selected!, { length_m: Number(e.target.value), ...MEASURED })
                      }
                      helperText={
                        purpose === 'violations' ? 'far to near, optional' : 'far to near edge'
                      }
                    />
                  </Stack>
                  {z.scale_source === 'auto' &&
                    (purpose === 'violations' ? (
                      <Alert severity="info" sx={{ py: 0 }}>
                        Size estimated <b>automatically</b> from vehicle sizes (about ±
                        {z.speed_uncertainty_pct ?? 15}%). Type the measured width or length if you
                        know it.
                      </Alert>
                    ) : (
                      <Alert severity="warning" sx={{ py: 0 }}>
                        Size estimated <b>automatically</b> (about ±{z.speed_uncertainty_pct ?? 15}
                        %): speed tracking skips this zone until you type its measured width and
                        length.
                      </Alert>
                    ))}
                  <TextField
                    select
                    size="small"
                    label="Allowed direction (V4)"
                    value={z.allowed_direction ?? 'both'}
                    onChange={(e) => update(selected!, { allowed_direction: e.target.value })}
                  >
                    <MenuItem value="both">Both ways (no wrong-side check)</MenuItem>
                    <MenuItem value="toward_camera">Toward the camera only</MenuItem>
                    <MenuItem value="away_from_camera">Away from the camera only</MenuItem>
                  </TextField>
                  {learning?.zones?.[z.name] && (
                    <Alert severity="info" sx={{ py: 0 }}>
                      Seen in traffic: <b>{learning.zones[z.name].toward}</b> toward,{' '}
                      <b>{learning.zones[z.name].away}</b> away.{' '}
                      {!learning.zones[z.name].suggestion ? (
                        'Not enough one-way evidence yet.'
                      ) : learning.zones[z.name].suggestion === (z.allowed_direction ?? 'both') ? (
                        'Matches the current setting.'
                      ) : (
                        <>
                          Suggested: <b>{DIRECTION_LABEL[learning.zones[z.name].suggestion!]}</b>
                          <Button
                            size="small"
                            onClick={() =>
                              update(selected!, {
                                allowed_direction: learning.zones[z.name].suggestion!,
                              })
                            }
                          >
                            Apply
                          </Button>
                        </>
                      )}
                    </Alert>
                  )}
                  {(sized(z) || purpose === 'violations') && (
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
                    >
                      <Typography variant="body2" component="div" sx={{ flex: 1, minWidth: 120 }}>
                        No-parking kerb (V3)
                        {!sized(z) && (
                          <Typography variant="caption" color="text.secondary" component="div">
                            a quarter of the zone wide: drag its corners to fit
                          </Typography>
                        )}
                      </Typography>
                      {sized(z) && (
                        <TextField
                          size="small"
                          type="number"
                          label="m wide"
                          value={kerbWidth}
                          onChange={(e) => setKerbWidth(Math.max(0.5, Number(e.target.value) || 3))}
                          sx={{ width: 80 }}
                        />
                      )}
                      <Button size="small" variant="outlined" onClick={() => addKerb(z, 'left')}>
                        + Left edge
                      </Button>
                      <Button size="small" variant="outlined" onClick={() => addKerb(z, 'right')}>
                        + Right edge
                      </Button>
                    </Stack>
                  )}
                  {purpose !== 'violations' && (
                    <Stack direction="row" spacing={1}>
                      <TextField
                        select
                        size="small"
                        label="Road"
                        value={z.road_category ?? 'city'}
                        onChange={(e) => update(selected!, { road_category: e.target.value })}
                        sx={{ flex: 1 }}
                      >
                        <MenuItem value="city">City (60 km/h)</MenuItem>
                        <MenuItem value="highway">Highway (80)</MenuItem>
                        <MenuItem value="expressway">Expressway (80)</MenuItem>
                      </TextField>
                      <TextField
                        size="small"
                        type="number"
                        label="Lower limit"
                        value={z.speed_limit_kph ?? ''}
                        onChange={(e) =>
                          update(selected!, {
                            speed_limit_kph: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        sx={{ flex: 1 }}
                        helperText="km/h, optional"
                      />
                    </Stack>
                  )}
                  <TextField
                    select
                    size="small"
                    label="Banned classes (V8)"
                    value={z.banned_classes ?? []}
                    onChange={(e) =>
                      update(selected!, { banned_classes: e.target.value as unknown as string[] })
                    }
                    slotProps={{ select: { multiple: true } }}
                  >
                    {CLASSES.map((c) => (
                      <MenuItem key={c} value={c}>
                        {c}
                      </MenuItem>
                    ))}
                  </TextField>
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={!!z.stopping_allowed}
                        onChange={(e) => update(selected!, { stopping_allowed: e.target.checked })}
                      />
                    }
                    label={
                      <Typography variant="body2">
                        Stopping allowed in the whole zone (service lane)
                      </Typography>
                    }
                  />
                </>
              )}
            </Stack>
          </Paper>
        )}
        <Typography variant="caption" color="text.secondary">
          {purpose === 'violations'
            ? 'Road zone sizes are optional here: an empty one is estimated from vehicle sizes when the box starts (a measured one is more exact).'
            : 'Every speed depends on the road zones’ real width and length: measure them (lane-dash pattern on site, or a map ruler), never guess.'}{' '}
          Both near corners must be at the same distance from the camera.
        </Typography>
      </Stack>
    </Box>
  );
}
