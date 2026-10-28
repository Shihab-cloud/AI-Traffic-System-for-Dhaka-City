import { describe, expect, it } from 'vitest';

import type { ZoneConfig } from '@/lib/types/traffic.types';

import {
  apply,
  crossLines,
  homography,
  isConvex,
  shortZoneWarning,
  topDown,
  zoneLabel,
  type Pt,
} from './speedZone.util';

/** A zone that is an upright rectangle in the frame: 1 px per 0.1 m across, 0.1 m along. */
const zone = (over: Partial<ZoneConfig> = {}): ZoneConfig => ({
  name: 'Right side',
  type: 'road',
  points: [
    [0, 0],
    [100, 0],
    [100, 900],
    [0, 900],
  ],
  width_m: 10,
  length_m: 90,
  ...over,
});

describe('homography', () => {
  it('maps each source corner onto its destination corner', () => {
    const src: Pt[] = [
      [0, 0],
      [10.5, 0],
      [10.5, 90],
      [0, 90],
    ];
    const dst: Pt[] = [
      [775, 372],
      [855, 370],
      [1405, 770],
      [830, 760],
    ];
    const h = homography(src, dst);
    src.forEach((p, i) => {
      const [x, y] = apply(h, p);
      expect(x).toBeCloseTo(dst[i][0], 6);
      expect(y).toBeCloseTo(dst[i][1], 6);
    });
  });
});

describe('crossLines', () => {
  it('draws a line every 10 m between the far and the near edge, not on the edges themselves', () => {
    // + 0 turns a rounded -0 into 0
    const lines = crossLines(zone()).map((l) => l.map((p) => p.map((v) => v + 0)));
    expect(lines).toHaveLength(8);
    expect(lines[0]).toEqual([
      [0, 100],
      [100, 100],
    ]);
    expect(lines[7][0]).toEqual([0, 800]);
  });

  it('draws none until the zone has a size', () => {
    expect(crossLines(zone({ width_m: 0, length_m: 0 }))).toEqual([]);
  });
});

describe('isConvex', () => {
  it('accepts corners clicked in order', () => {
    expect(isConvex(zone().points as Pt[])).toBe(true);
  });

  it('rejects corners that cross over each other (clicked out of order)', () => {
    expect(
      isConvex([
        [0, 0],
        [100, 900],
        [100, 0],
        [0, 900],
      ]),
    ).toBe(false);
  });

  it('rejects three corners on one line', () => {
    expect(
      isConvex([
        [0, 0],
        [50, 0],
        [100, 0],
        [0, 900],
      ]),
    ).toBe(false);
  });
});

describe('zoneLabel / shortZoneWarning', () => {
  it('writes the size as the script does ("Right side: 10.5 x 90 m")', () => {
    expect(zoneLabel(zone({ width_m: 10.5, length_m: 90 }))).toBe('Right side: 10.5 x 90 m');
    expect(zoneLabel(zone({ width_m: 0 }))).toBe('Right side: size?');
  });

  it('warns about zones shorter than 20 m only', () => {
    expect(shortZoneWarning(zone({ length_m: 15 }))).toContain('crosses it in 1.1 s');
    expect(shortZoneWarning(zone())).toBeNull();
  });
});

describe('topDown', () => {
  /** 20 x 20 frame: left half red, right half blue. */
  const frame = () => {
    const data = new Uint8ClampedArray(20 * 20 * 4);
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 20; x++)
        data.set(x < 10 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 20 + x) * 4);
    return { data, width: 20, height: 20 };
  };
  const px = (img: { data: Uint8ClampedArray; width: number }, x: number, y: number) =>
    Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

  it('warps the zone to a view with the zone’s own width-to-length ratio', () => {
    const top = topDown(
      frame(),
      zone({
        points: [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ],
        width_m: 2,
        length_m: 4,
      }),
      10,
    );
    expect([top.width, top.height]).toEqual([5, 10]);
    expect(px(top, 1, 5)).toEqual([255, 0, 0, 255]);
    expect(px(top, 3, 5)).toEqual([0, 0, 255, 255]);
  });

  it('leaves the part of the zone outside the frame black', () => {
    const top = topDown(
      frame(),
      zone({
        points: [
          [10, 0],
          [30, 0],
          [30, 20],
          [10, 20],
        ],
        width_m: 2,
        length_m: 2,
      }),
      10,
    );
    expect(px(top, 2, 5)).toEqual([0, 0, 255, 255]);
    expect(px(top, 8, 5)).toEqual([0, 0, 0, 255]);
  });
});
