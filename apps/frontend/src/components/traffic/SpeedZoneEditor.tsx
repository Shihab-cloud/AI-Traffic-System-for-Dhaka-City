'use client';

import {
  Alert,
  Box,
  Button,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';

import { Icons } from '@/lib/icons';
import type { CameraZones, ZoneConfig } from '@/lib/types/traffic.types';
import {
  CORNERS,
  STEP_M,
  ZONE_COLOR,
  crossLines,
  isConvex,
  isMeasured,
  isSpeedZone,
  shortZoneWarning,
  topDown,
  zoneLabel,
  type Pt,
} from './speedZone.util';
import { fitZones } from './ZoneEditor';

/** Corners of the zone being clicked (speed_tracker.py draws them in red). */
const CLICK_COLOR = '#ff0000';
/** A typed size is a measured one: the zone leaves automatic calibration (and the speed box uses it). */
const MEASURED: Partial<ZoneConfig> = { scale_source: 'measured', speed_uncertainty_pct: null };
const TOP_DOWN_PX = 320;

/** What a drag moves: corner `vi` (vertex) or all (move) of zone `i`. */
type DragTarget = { kind: 'vertex' | 'move'; i: number; vi: number };

/** The frame's pixels, for the top-down check. */
function useFramePixels(image: string | null) {
  const [decoded, setDecoded] = useState<{ image: string; pixels: ImageData } | null>(null);
  useEffect(() => {
    if (!image) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      if (!ctx || !alive) return;
      ctx.drawImage(img, 0, 0);
      setDecoded({ image, pixels: ctx.getImageData(0, 0, c.width, c.height) });
    };
    img.src = image;
    return () => {
      alive = false;
    };
  }, [image]);
  return decoded?.image === image ? decoded.pixels : null; // never the pixels of the frame before
}

/** speed_tracker.py's "Top-down check" window for one zone, with a line every 10 m. */
function TopDownCheck({
  frame,
  zone,
  frameSize,
}: {
  frame: ImageData;
  zone: ZoneConfig;
  frameSize: [number, number];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const top = topDown(frame, zone, TOP_DOWN_PX, [
      frame.width / frameSize[0],
      frame.height / frameSize[1],
    ]);
    c.width = top.width;
    c.height = top.height;
    const out = ctx.createImageData(top.width, top.height);
    out.data.set(top.data);
    ctx.putImageData(out, 0, 0);
    const ppm = TOP_DOWN_PX / Number(zone.length_m);
    ctx.strokeStyle = ZONE_COLOR;
    for (let d = STEP_M; d < Number(zone.length_m); d += STEP_M) {
      ctx.beginPath();
      ctx.moveTo(0, d * ppm);
      ctx.lineTo(top.width, d * ppm);
      ctx.stroke();
    }
  }, [frame, zone, frameSize]);
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
      <canvas
        ref={ref}
        style={{ background: '#000', borderRadius: 4, flex: '0 0 auto', maxWidth: 160 }}
      />
      <Typography variant="caption" color="text.secondary">
        <b>Top-down check</b> (far edge at the top, a line every {STEP_M} m): the zone seen from
        above with this size. Lane lines should come out straight and parallel; if they fan out or
        bend, fix the corners or the measurements.
      </Typography>
    </Stack>
  );
}

/**
 * Speed zones for one camera, drawn as in `speed_tracker.py --calibrate`: click the 4 corners of a real rectangle
 * on the road (far-left, far-right, near-right, near-left), then give it a name and its measured width and length.
 * Only road zones are shown and edited; the other-violations box's areas and lane lines pass through unchanged.
 */
export default function SpeedZoneEditor({
  value,
  onChange,
  image,
  frameSize,
}: {
  value: CameraZones;
  onChange: (z: CameraZones) => void;
  image: string | null;
  frameSize: [number, number];
}) {
  const [W, H] = frameSize;
  const ui = H / 1080; // as the script: sizes follow the frame height
  const svgRef = useRef<SVGSVGElement>(null);
  const [clicks, setClicks] = useState<Pt[]>([]);
  const [crossed, setCrossed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  /** The zone just drawn: its name field takes the focus, as the script asks for the name next. */
  const [named, setNamed] = useState<number | null>(null);
  // Dragging a corner (vertex) or the whole zone (move): as in ZoneEditor, the zones live in `draft` while the button
  // is down and reach `onChange` once, on release; pointer moves are applied at most once per screen frame.
  const [drag, setDrag] = useState<DragTarget | null>(null);
  const dragRef = useRef<
    (DragTarget & { start: Pt; base: CameraZones; to: Pt | null; frame: number }) | null
  >(null);
  const [draft, setDraft] = useState<CameraZones | null>(null);
  useEffect(() => () => cancelAnimationFrame(dragRef.current?.frame ?? 0), []);
  // The pointer is captured by the frame during a drag, so releasing it also "clicks" the frame: not a corner.
  const afterDrag = useRef(false);
  const undo = useRef<CameraZones[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const pixels = useFramePixels(image);
  const shown = draft ?? value;
  const zones = shown.zones ?? [];
  const speed = zones.map((z, i) => ({ z, i })).filter(({ z }) => isSpeedZone(z));
  const stroke = Math.max(2, W / 500);
  const font = 22 * ui;
  const labelFont = font * 1.3;
  const labelOf = (z: ZoneConfig) =>
    zoneLabel(z) + (z.scale_source === 'auto' ? ' (auto size)' : '');
  /** A centred label's x, moved in so that the whole text stays in the frame (width estimated from its length). */
  const inFrame = (x: number, text: string) => {
    const half = (text.length * labelFont * 0.55) / 2 + 8 * ui;
    return Math.min(Math.max(x, half), W - half);
  };

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
  const update = (i: number, patch: Partial<ZoneConfig>) =>
    save({ zones: zones.map((z, k) => (k === i ? { ...z, ...patch } : z)) });
  const remove = (i: number) => {
    setSelected(null);
    save({ zones: zones.filter((_, k) => k !== i) });
  };
  /** The script's "u": the last corner clicked, else the last change (a new zone, a move, a typed size...). */
  const undoLast = () => {
    setCrossed(false);
    if (clicks.length) {
      setClicks(clicks.slice(0, -1));
      return;
    }
    const prev = undo.current.pop();
    setUndoCount(undo.current.length);
    if (prev) {
      onChange(prev);
      // keep the selection while that zone still exists (undoing a move); drop it when the undo removed it
      const still = selected != null ? prev.zones?.[selected] : undefined;
      if (!still || !isSpeedZone(still)) setSelected(null);
    }
  };

  const startDrag = (e: React.PointerEvent, d: DragTarget) => {
    if (clicks.length) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { ...d, start: toFrame(e), base: value, to: null, frame: 0 };
    setDrag(d);
  };
  /** The zones with the dragged one moved so that the pointer, which went down at `start`, is now at `to`. */
  const dragged = (to: Pt): CameraZones => {
    const d = dragRef.current!;
    const dx = to[0] - d.start[0];
    const dy = to[1] - d.start[1];
    const moved = (pts: Pt[]) =>
      d.kind === 'vertex'
        ? pts.map((q, k) => (k === d.vi ? to : q))
        : pts.map(([x, y]): Pt => [x + dx, y + dy]);
    return {
      ...d.base,
      frame_size: frameSize,
      zones: d.base.zones.map((z, k) =>
        k === d.i ? { ...z, points: moved(z.points as Pt[]) } : z,
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
    afterDrag.current = true;
    dragRef.current = null;
    setDraft(null);
    setDrag(null);
  };

  /** A click on the frame is the next corner (with a zone selected, the first click only deselects it). */
  const onClick = (e: React.MouseEvent) => {
    if (afterDrag.current) {
      afterDrag.current = false;
      return;
    }
    if (!clicks.length && selected != null) {
      setSelected(null);
      return;
    }
    setCrossed(false);
    const pts = [...clicks, toFrame(e)];
    if (pts.length < 4) {
      setClicks(pts);
      return;
    }
    setClicks([]);
    if (!isConvex(pts)) {
      setCrossed(true);
      return;
    }
    save({
      zones: [
        ...zones,
        {
          name: `zone${speed.length + 1}`,
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
    setNamed(zones.length);
  };

  /** A zone file of speed_tracker.py --calibrate (or a camera's): its road zones replace these speed zones. */
  const importFile = async (f: File) => {
    try {
      const cfg = JSON.parse(await f.text()) as CameraZones;
      if (!Array.isArray(cfg.zones)) throw new Error('no "zones" list');
      const roads = fitZones({ ...cfg, frame_size: cfg.frame_size ?? frameSize }, W, H)
        .zones.filter(isSpeedZone)
        .map((z): ZoneConfig => ({
          road_category: 'city',
          allowed_direction: 'both',
          speed_limit_kph: null,
          banned_classes: [],
          stopping_allowed: false,
          ...z,
          type: 'road',
          ...(isMeasured(z) && !z.scale_source ? MEASURED : {}),
        }));
      if (!roads.length) throw new Error('it has no road zones');
      save({ zones: [...zones.filter((z) => !isSpeedZone(z)), ...roads] });
      setSelected(null);
    } catch (e) {
      alert(`Not a speed zone file: ${(e as Error).message}`);
    }
  };

  const picked = selected != null ? zones[selected] : undefined;
  const sel = picked && isSpeedZone(picked) ? picked : null;
  const prompt = !sel ? `Click point ${clicks.length + 1}: ${CORNERS[clicks.length]}` : null;

  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 360px' } }}>
      <Box>
        <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {sel
              ? 'Drag a white corner to move it, or drag the zone to move all of it. Click elsewhere to deselect it.'
              : 'Good corners: ends of lane-marking dashes on two lane lines, or kerb / median edges you can measure.'}
          </Typography>
          <Button
            size="small"
            startIcon={<Icons.undo />}
            disabled={!clicks.length && !undoCount}
            onClick={undoLast}
          >
            {clicks.length ? 'Undo point' : 'Undo'}
          </Button>
          <Button
            size="small"
            component="label"
            startIcon={<Icons.upload />}
            title="A speed_zones.json made with speed_tracker.py --calibrate: its zones replace these"
          >
            Import zone file
            <input
              hidden
              type="file"
              accept=".json,application/json"
              onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
            />
          </Button>
        </Stack>
        {crossed && (
          <Alert severity="warning" sx={{ mb: 1, py: 0 }} onClose={() => setCrossed(false)}>
            Those points cross over each other. Click them in order: {CORNERS.join(', ')}.
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
          {image ? (
            <Box
              component="img"
              src={image}
              alt="Camera frame"
              sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            />
          ) : (
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
            onPointerDownCapture={() => {
              afterDrag.current = false;
            }}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              cursor: drag ? 'grabbing' : 'crosshair',
              touchAction: 'none',
            }}
          >
            {speed.map(({ z, i }) => (
              <g
                key={i}
                onClick={(e) => {
                  if (!clicks.length) {
                    e.stopPropagation();
                    setSelected(i);
                  }
                }}
                style={{
                  cursor: clicks.length ? 'crosshair' : selected === i ? 'move' : 'pointer',
                }}
              >
                <polygon
                  points={z.points.map((p) => p.join(',')).join(' ')}
                  fill={ZONE_COLOR}
                  fillOpacity={selected === i ? 0.18 : 0.04}
                  stroke={ZONE_COLOR}
                  strokeWidth={selected === i ? stroke * 1.5 : stroke}
                  onPointerDown={(e) => selected === i && startDrag(e, { kind: 'move', i, vi: -1 })}
                />
                {crossLines(z).map(([a, b], k) => (
                  <line
                    key={k}
                    x1={a[0]}
                    y1={a[1]}
                    x2={b[0]}
                    y2={b[1]}
                    stroke={ZONE_COLOR}
                    strokeWidth={stroke / 2}
                    style={{ pointerEvents: 'none' }}
                  />
                ))}
                {/* in the middle of the zone: far corners crowd together near the horizon */}
                <text
                  x={inFrame(z.points.reduce((s, p) => s + p[0], 0) / z.points.length, labelOf(z))}
                  y={z.points.reduce((s, p) => s + p[1], 0) / z.points.length}
                  textAnchor="middle"
                  fill={ZONE_COLOR}
                  fontSize={labelFont}
                  fontWeight={600}
                  stroke="#141414"
                  strokeWidth={font / 3}
                  paintOrder="stroke"
                  style={{ pointerEvents: 'none' }}
                >
                  {labelOf(z)}
                </text>
              </g>
            ))}
            {/* corner handles of the selected zone: drag to adjust */}
            {!clicks.length &&
              (sel?.points ?? []).map((p, vi) => (
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
                  onPointerDown={(e) => startDrag(e, { kind: 'vertex', i: selected!, vi })}
                />
              ))}
            {clicks.length > 1 && (
              <polyline
                points={clicks.map((p) => p.join(',')).join(' ')}
                fill="none"
                stroke={CLICK_COLOR}
                strokeWidth={stroke}
              />
            )}
            {clicks.map((p, k) => (
              <g key={`c${k}`} style={{ pointerEvents: 'none' }}>
                <circle cx={p[0]} cy={p[1]} r={Math.max(3, 6 * ui)} fill={CLICK_COLOR} />
                <text
                  x={p[0] + 10 * ui}
                  y={p[1] - 10 * ui}
                  fill={CLICK_COLOR}
                  fontSize={font}
                  fontWeight={600}
                  stroke="#141414"
                  strokeWidth={font / 3}
                  paintOrder="stroke"
                >
                  {k + 1} {CORNERS[k]}
                </text>
              </g>
            ))}
            {prompt && image && (
              <text
                x={20 * ui}
                y={50 * ui}
                fill="#fff"
                fontSize={font * 1.4}
                fontWeight={600}
                stroke="#141414"
                strokeWidth={font / 2.5}
                paintOrder="stroke"
                style={{ pointerEvents: 'none' }}
              >
                {prompt}
              </text>
            )}
          </svg>
        </Box>
      </Box>

      <Stack spacing={1.5}>
        <Typography variant="subtitle2">Speed zones ({speed.length})</Typography>
        {!speed.length && (
          <Typography variant="body2" color="text.secondary">
            None yet: click the 4 corners of a measured rectangle on the frame.
          </Typography>
        )}
        {speed.map(({ z, i }) => {
          const short = shortZoneWarning(z);
          return (
            <Paper
              key={i}
              variant="outlined"
              onClick={() => setSelected(i)}
              sx={{
                p: 1.25,
                borderRadius: 1.5,
                cursor: 'pointer',
                borderColor: selected === i ? 'primary.main' : 'divider',
              }}
            >
              <Stack spacing={1.25}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '3px',
                      bgcolor: ZONE_COLOR,
                      flex: '0 0 auto',
                    }}
                  />
                  <TextField
                    size="small"
                    variant="standard"
                    label="Zone name"
                    value={z.name}
                    autoFocus={named === i}
                    onFocus={(e) => {
                      if (named !== i) return;
                      e.target.select(); // the default name, ready to be typed over
                      setNamed(null);
                    }}
                    onChange={(e) => update(i, { name: e.target.value })}
                    sx={{ flex: 1 }}
                  />
                  <IconButton
                    size="small"
                    aria-label="Delete zone"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(i);
                    }}
                  >
                    <Icons.delete />
                  </IconButton>
                </Stack>
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small"
                    type="number"
                    label="Real width (m)"
                    value={z.width_m || ''}
                    error={!(Number(z.width_m) > 0)}
                    onChange={(e) => update(i, { width_m: Number(e.target.value), ...MEASURED })}
                    helperText="left edge to right edge"
                  />
                  <TextField
                    size="small"
                    type="number"
                    label="Real length (m)"
                    value={z.length_m || ''}
                    error={!(Number(z.length_m) > 0)}
                    onChange={(e) => update(i, { length_m: Number(e.target.value), ...MEASURED })}
                    helperText="far edge to near edge"
                  />
                </Stack>
                <Stack direction="row" spacing={1}>
                  <TextField
                    select
                    size="small"
                    label="Road"
                    value={z.road_category ?? 'city'}
                    onChange={(e) => update(i, { road_category: e.target.value })}
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
                      update(i, {
                        speed_limit_kph: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    sx={{ flex: 1 }}
                    helperText="km/h, optional"
                  />
                </Stack>
                {z.scale_source === 'auto' && (
                  <Alert severity="warning" sx={{ py: 0 }}>
                    Size estimated <b>automatically</b> (about ±{z.speed_uncertainty_pct ?? 15}%):
                    speed tracking skips this zone until you type its measured width and length.
                  </Alert>
                )}
                {short && (
                  <Alert severity="warning" sx={{ py: 0 }}>
                    {short}
                  </Alert>
                )}
                {selected === i && pixels && isMeasured(z) && (
                  <TopDownCheck frame={pixels} zone={z} frameSize={frameSize} />
                )}
              </Stack>
            </Paper>
          );
        })}
        <Typography variant="caption" color="text.secondary">
          Every speed depends on the zones&apos; real width and length: measure them (lane-dash
          pattern on site, or a map ruler), never guess. Both near corners must be at the same
          distance from the camera. The other-violations box&apos;s areas and lane lines are not
          shown here and stay as they are.
        </Typography>
      </Stack>
    </Box>
  );
}
