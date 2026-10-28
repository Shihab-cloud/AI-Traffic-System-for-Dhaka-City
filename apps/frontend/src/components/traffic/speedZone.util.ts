import type { ZoneConfig } from '@/lib/types/traffic.types';

/**
 * Road-zone geometry of `speed_tracker.py --calibrate` for the speed box's zone dialog. A speed zone is a real
 * rectangle on the road: its corners are clicked in `CORNERS` order, which is the metric rectangle (0,0), (W,0),
 * (W,L), (0,L) with x across the road from the left edge and y along it from the far edge.
 */

export type Pt = [number, number];

/** Click order of a road zone's corners (as speed_tracker.py CORNERS): "far" = top of the image. */
export const CORNERS = ['far-left', 'far-right', 'near-right', 'near-left'];
/** Shorter zones are crossed too quickly to measure a speed (speed_tracker.py MIN_ZONE_LENGTH_M). */
export const MIN_ZONE_LENGTH_M = 20;
/** SpeedZone.draw: a cross line every this many metres, so distances can be checked by eye. */
export const STEP_M = 10;
/** speed_tracker.py ZONE_COLOR (BGR 255, 200, 0). */
export const ZONE_COLOR = '#00c8ff';

export const isSpeedZone = (z: ZoneConfig) => (z.type ?? 'road') === 'road';
/** A road zone with its width and length (typed, or from Auto zones). */
export const isMeasured = (z: ZoneConfig) => Number(z.width_m) > 0 && Number(z.length_m) > 0;

/** 3x3 homography (h33 = 1) mapping 4 source points onto 4 destination points: direct linear transform. */
export function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return [...b.map((v, i) => v / A[i][i]), 1];
}

/** Point `p` mapped by homography `h`. */
export const apply = (h: number[], [x, y]: Pt): Pt => {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
};

/** `apply`, rounded to 0.1 px (as zone files store points). */
export const project = (h: number[], p: Pt): Pt =>
  apply(h, p).map((v) => Math.round(v * 10) / 10) as Pt;

/** Homography from a measured zone's road coordinates (metres) to frame pixels (SpeedZone.H_inv). */
export function metresToPixels(zone: ZoneConfig): number[] {
  const W = Number(zone.width_m);
  const L = Number(zone.length_m);
  return homography(
    [
      [0, 0],
      [W, 0],
      [W, L],
      [0, L],
    ],
    zone.points as Pt[],
  );
}

/**
 * cv2.isContourConvex for the clicked corners: false when they cross over each other (clicked out of order) or
 * three of them lie on one line.
 */
export function isConvex(pts: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const [cx, cy] = pts[(i + 2) % pts.length];
    const s = Math.sign((bx - ax) * (cy - by) - (by - ay) * (cx - bx));
    if (s === 0 || (sign && s !== sign)) return false;
    sign = s;
  }
  return pts.length >= 3;
}

/** SpeedZone.draw's cross lines: one every `STEP_M` metres between the far and the near edge, in frame pixels. */
export function crossLines(zone: ZoneConfig): [Pt, Pt][] {
  if (!isMeasured(zone)) return [];
  const h = metresToPixels(zone);
  const W = Number(zone.width_m);
  const lines: [Pt, Pt][] = [];
  for (let d = STEP_M; d < Number(zone.length_m); d += STEP_M)
    lines.push([project(h, [0, d]), project(h, [W, d])]);
  return lines;
}

/** SpeedZone.draw's label: "name: W x L m" (sizes as Python's `:g`). */
export const zoneLabel = (z: ZoneConfig) =>
  isMeasured(z) ? `${z.name}: ${Number(z.width_m)} x ${Number(z.length_m)} m` : `${z.name}: size?`;

/** speed_tracker.py warn_if_short, or null when the zone is long enough. */
export const shortZoneWarning = (z: ZoneConfig) =>
  isMeasured(z) && Number(z.length_m) < MIN_ZONE_LENGTH_M
    ? `Only ${Number(z.length_m)} m long: a vehicle at 50 km/h crosses it in ${(Number(z.length_m) / 13.9).toFixed(1)} s, ` +
      `but a speed needs about 0.5-1 s of movement inside the zone. Make zones at least ${MIN_ZONE_LENGTH_M} m long ` +
      '(e.g. several lane-marking dashes).'
    : null;

/** RGBA pixels, as in an ImageData. */
export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

/**
 * speed_tracker.py show_top_down: the zone warped to a top-down view `heightPx` tall (far edge at the top). If the
 * corners and the size are right, lane lines come out straight and parallel. `frame` holds the frame's pixels;
 * `scale` maps zone points (frame_size pixels) to them. Nearest-pixel sampling; outside the frame stays black.
 */
export function topDown(
  frame: Pixels,
  zone: ZoneConfig,
  heightPx: number,
  scale: Pt = [1, 1],
): Pixels {
  const ppm = heightPx / Number(zone.length_m);
  const width = Math.max(1, Math.round(Number(zone.width_m) * ppm));
  const h = metresToPixels(zone);
  const data = new Uint8ClampedArray(width * heightPx * 4);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < width; x++) {
      const [px, py] = apply(h, [(x + 0.5) / ppm, (y + 0.5) / ppm]);
      const sx = Math.floor(px * scale[0]);
      const sy = Math.floor(py * scale[1]);
      const o = (y * width + x) * 4;
      data[o + 3] = 255;
      if (sx < 0 || sy < 0 || sx >= frame.width || sy >= frame.height) continue;
      const i = (sy * frame.width + sx) * 4;
      data[o] = frame.data[i];
      data[o + 1] = frame.data[i + 1];
      data[o + 2] = frame.data[i + 2];
    }
  }
  return { data, width, height: heightPx };
}
