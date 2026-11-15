import { describe, expect, it } from 'vitest';
import { Color, Vector3 } from 'three';
import { moonCentre, sitePosition, siteUp, sphereSite } from './coordinates';
import { globeNormalAt, globeNormalNear, parseGlobe, type GlobeMeta } from './globe';
import {
  cellSite, groundAngle, parseTile, PATCH_HALF_DEG, patchGeometry, patchLiftAt, patchWindow, stretchPatch, tileFile,
  tileHeights, viewGround, windowTiles, type TileIndex,
} from './patch';

const index: TileIndex = { cells_per_deg: 32, tile_deg: 15, height_scale: 0.5, source: 'test' };
const small: TileIndex = { cells_per_deg: 4, tile_deg: 15, height_scale: 0.5, source: 'test' };
const low = new Color(0, 0, 0), high = new Color(1, 1, 1);

describe('level-of-detail window', () => {
  it('is centred on the site and as wide on the ground east-west as north-south', () => {
    const equator = patchWindow({ lat: 0.67, lon: 23.47 }, index)!;
    expect(equator.stride).toBe(1);
    expect(equator.row1 - equator.row0).toBe(2 * PATCH_HALF_DEG * 32);
    expect(equator.col1 - equator.col0).toBe(2 * PATCH_HALF_DEG * 32);
    const mid = cellSite(index, (equator.row0 + equator.row1) / 2, (equator.col0 + equator.col1) / 2);
    expect(Math.abs(mid.lat - 0.67)).toBeLessThan(1 / 32);
    expect(Math.abs(mid.lon - 23.47)).toBeLessThan(1 / 32);

    const high60 = patchWindow({ lat: 60, lon: 0 }, index)!;
    expect(high60.stride).toBe(2);                                  // 1 / cos 60
    expect(high60.col1 - high60.col0).toBe(2 * 2 * PATCH_HALF_DEG * 32);
    expect((high60.col1 - high60.col0) % high60.stride).toBe(0);
  });

  it('stops at the polar meshes and never spans more than a tile each way in longitude', () => {
    const near = patchWindow({ lat: -76, lon: 40 }, index, -80, 80)!;
    expect(cellSite(index, near.row1, 0).lat).toBeGreaterThan(-80);
    expect(cellSite(index, near.row1 + 1, 0).lat).toBeLessThan(-80);
    expect(near.col1 - near.col0).toBeLessThanOrEqual(2 * 15 * 32);
    const top = patchWindow({ lat: 78, lon: 0 }, index, -80, 80)!;
    expect(cellSite(index, top.row0, 0).lat).toBeLessThan(80);
    expect(patchWindow({ lat: 89, lon: 0 }, index, -80, 80)).toBeNull();
    expect(patchWindow({ lat: 89.99, lon: 0 }, index)).not.toBeNull();
  });

  it('names the tiles it touches, wrapping across 180 degrees', () => {
    expect(windowTiles(patchWindow({ lat: 7, lon: 7 }, index)!, index)).toEqual([{ row: 5, col: 12 }]);
    const corner = windowTiles(patchWindow({ lat: 0, lon: 0 }, index)!, index);
    expect(corner).toHaveLength(4);
    const line = windowTiles(patchWindow({ lat: 22, lon: 179.9 }, index)!, index);
    expect(line.map((t) => t.col).sort((a, b) => a - b)).toEqual([0, 23]);
    expect(line.every((t) => t.row === 4)).toBe(true);
    expect(tileFile(4, 23)).toBe('tiles/r04c23.bin');
    expect(cellSite(index, 0, -1).lon).toBeCloseTo(180 - 1 / 64, 6);
    expect(cellSite(index, 0, 360 * 32).lon).toBeCloseTo(-180 + 1 / 64, 6);
  });
});

describe('tiles', () => {
  it('reads heights from the right tile and cell, with longitude wrapped', () => {
    const t = 60, make = (value: number, mark?: [number, number, number]) => {
      const view = new DataView(new ArrayBuffer(t * t * 2));
      for (let i = 0; i < t * t; i++) view.setInt16(i * 2, value, true);
      if (mark) view.setInt16((mark[0] * t + mark[1]) * 2, mark[2], true);
      return parseTile(small, view.buffer);
    };
    const tiles = new Map([[tileFile(0, 0), make(100, [3, 5, -2000])], [tileFile(0, 23), make(300)], [tileFile(1, 0), make(500)]]);
    const at = tileHeights(small, tiles);
    expect(at(0, 0)).toBe(50);
    expect(at(3, 5)).toBe(-1000);
    expect(at(0, -1)).toBe(150);                 // west of 180 W is the last tile
    expect(at(0, 360 * 4)).toBe(50);             // east of 180 E is the first
    expect(at(60, 0)).toBe(250);
    expect(at(0, 60)).toBe(0);                   // a tile that is not loaded
    expect(() => parseTile(small, new ArrayBuffer(8))).toThrow(/tile/);
  });
});

describe('patch mesh', () => {
  const win = patchWindow({ lat: -30, lon: 179 }, small)!;
  const up = new Vector3(), n = new Vector3();

  it('lies on the sphere at each cell centre, facing outward, coloured by height', () => {
    const geometry = patchGeometry(win, small, (row) => (row % 2 ? 2000 : -2000), low, high, [-2000, 2000], 1);
    const position = geometry.getAttribute('position'), color = geometry.getAttribute('color');
    const cols = (win.col1 - win.col0) / win.stride + 1;
    for (let i = 0; i < position.count; i++) {
      const row = win.row0 + Math.floor(i / cols), col = win.col0 + (i % cols) * win.stride;
      up.fromBufferAttribute(position, i);
      expect(up.length()).toBeCloseTo(1737.4, 2);
      const site = sphereSite(up.clone().add(moonCentre())), want = cellSite(small, row, col);
      expect(site.lat).toBeCloseTo(want.lat, 3);
      expect(Math.abs(((site.lon - want.lon + 540) % 360) - 180)).toBeLessThan(1e-3);
      expect(color.getX(i)).toBe(row % 2 ? 1 : 0);
    }
    const index3 = geometry.getIndex()!, a = new Vector3(), b = new Vector3(), c = new Vector3();
    for (let i = 0; i < index3.count; i += 3) {
      a.fromBufferAttribute(position, index3.getX(i)); b.fromBufferAttribute(position, index3.getX(i + 1));
      c.fromBufferAttribute(position, index3.getX(i + 2));
      expect(b.sub(a).cross(c.sub(a)).dot(a)).toBeGreaterThan(0);
    }
  });

  it('lights slopes without raising the ground, steeper with more relief', () => {
    const bumpy = (row: number, col: number): number => 800 * Math.sin(row) * Math.cos(col);
    const flat = patchGeometry(win, small, () => 0, low, high, [0, 1], 6);
    const gentle = patchGeometry(win, small, bumpy, low, high, [0, 1], 1);
    const steep = patchGeometry(win, small, bumpy, low, high, [0, 1], 6);
    expect(Array.from(steep.getAttribute('position').array)).toEqual(Array.from(flat.getAttribute('position').array));
    let leanFlat = 0, leanGentle = 0, leanSteep = 0;
    for (let i = 0; i < flat.getAttribute('position').count; i++) {
      up.fromBufferAttribute(flat.getAttribute('position'), i).normalize();
      leanFlat += 1 - n.fromBufferAttribute(flat.getAttribute('normal'), i).dot(up);
      leanGentle += 1 - n.fromBufferAttribute(gentle.getAttribute('normal'), i).dot(up);
      leanSteep += 1 - n.fromBufferAttribute(steep.getAttribute('normal'), i).dot(up);
    }
    expect(leanFlat).toBeLessThan(1e-3);
    expect(leanGentle).toBeGreaterThan(leanFlat + 0.01);
    expect(leanSteep).toBeGreaterThan(leanGentle * 3);
  });

  it('takes the globe\'s normal at its edge and its own in the middle', () => {
    const marker = (_lat: number, _lon: number, out: number[]): void => { out[0] = 1; out[1] = 0; out[2] = 0; };
    const own = patchGeometry(win, small, () => 0, low, high, [0, 1], 1);
    const faded = patchGeometry(win, small, () => 0, low, high, [0, 1], 1, marker);
    const cols = (win.col1 - win.col0) / win.stride + 1, rows = win.row1 - win.row0 + 1;
    const mid = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
    expect(n.fromBufferAttribute(faded.getAttribute('normal'), 0).toArray()).toEqual([1, 0, 0]);
    expect(n.fromBufferAttribute(faded.getAttribute('normal'), cols - 1).toArray()).toEqual([1, 0, 0]);
    expect(n.fromBufferAttribute(faded.getAttribute('normal'), mid).toArray())
      .toEqual(new Vector3().fromBufferAttribute(own.getAttribute('normal'), mid).toArray());
  });

  // Rising 40 m a row southward and 20 m a column eastward, lowest at the north-west corner.
  const tilted = (row: number, col: number): number => 500 + 40 * (row - win.row0) + 20 * (col - win.col0) / win.stride;
  const rows = win.row1 - win.row0 + 1, cols = (win.col1 - win.col0) / win.stride + 1;
  const inner = (r: number, c: number): boolean =>
    Math.min(r, rows - 1 - r) / (rows - 1) >= 0.15 && Math.min(c, cols - 1 - c) / (cols - 1) >= 0.15;
  const border = (r: number, c: number): boolean => r === 0 || c === 0 || r === rows - 1 || c === cols - 1;

  it('is raised by the stretch along each radius, from the lowest ground, to nothing at its edge', () => {
    const geometry = patchGeometry(win, small, tilted, low, high, [0, 1], 1);
    const position = geometry.getAttribute('position');
    const flat = Array.from({ length: position.count }, (_, i) => new Vector3().fromBufferAttribute(position, i));
    const top = stretchPatch(geometry, 3);
    let highest = 0, checked = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c, p = up.fromBufferAttribute(position, i), above = p.length() - 1737.4;
        expect(above).toBeGreaterThan(-1e-3);                         // never under the globe
        expect(p.clone().normalize().dot(flat[i].clone().normalize())).toBeCloseTo(1, 9);
        if (inner(r, c)) { expect(above).toBeCloseTo(3 * (40 * r + 20 * c) / 1000, 3); checked++; }
        if (border(r, c)) expect(Math.abs(above)).toBeLessThan(1e-3);
        highest = Math.max(highest, above);
        expect(geometry.boundingBox!.containsPoint(p)).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(top).toBeCloseTo(highest, 3);
    // A second stretch starts again from the flat ground.
    stretchPatch(geometry, 1);
    const mid = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
    expect(up.fromBufferAttribute(position, mid).length() - 1737.4)
      .toBeCloseTo((40 * Math.floor(rows / 2) + 20 * Math.floor(cols / 2)) / 1000, 3);
  });

  it('gives the lift at any point: exact on a cell centre, blended between, 0 outside, across 180 degrees', () => {
    const geometry = patchGeometry(win, small, tilted, low, high, [0, 1], 1);
    const at = (r: number, c: number) => cellSite(small, win.row0 + r, win.col0 + c * win.stride);
    const rm = Math.floor(rows / 2), cm = Math.floor(cols / 2);
    expect(patchLiftAt(geometry, at(rm, cm).lat, at(rm, cm).lon)).toBeCloseTo((40 * rm + 20 * cm) / 1000, 6);
    const between = { lat: (at(rm, cm).lat + at(rm + 1, cm).lat) / 2, lon: (at(rm, cm).lon + at(rm, cm + 1).lon) / 2 };
    expect(patchLiftAt(geometry, between.lat, between.lon)).toBeCloseTo((40 * (rm + 0.5) + 20 * (cm + 0.5)) / 1000, 6);
    // The window runs from 172 E across 180 degrees to 174 W; this cell is west of 180 W in name only.
    const east = at(rm, cm + 6);
    expect(east.lon).toBeLessThan(-179);
    expect(patchLiftAt(geometry, east.lat, east.lon)).toBeCloseTo((40 * rm + 20 * (cm + 6)) / 1000, 6);
    expect(patchLiftAt(geometry, east.lat, east.lon + 360)).toBeCloseTo((40 * rm + 20 * (cm + 6)) / 1000, 6);
    expect(patchLiftAt(geometry, at(0, cm).lat, at(0, cm).lon)).toBeCloseTo(0, 9);
    expect(patchLiftAt(geometry, -30, 150)).toBe(0);
    expect(patchLiftAt(geometry, 10, 179)).toBe(0);
    expect(patchLiftAt(patchGeometry(win, small, () => 0, low, high, [0, 1], 1), -30, 179)).toBe(0);
  });
});

describe('globe normal at a point', () => {
  const meta: GlobeMeta = { width: 72, height: 36, height_scale: 0.5, source: 'test' };
  const view = new DataView(new ArrayBuffer(72 * 36 * 2));
  for (let i = 0; i < 72 * 36; i++) view.setInt16(i * 2, Math.round(4000 * Math.sin(i * 0.7)), true);
  const globe = parseGlobe(meta, view.buffer);

  it('equals the cell\'s normal at a cell centre and blends between centres', () => {
    const a = [0, 0, 0], b = [0, 0, 0], near = [0, 0, 0];
    globeNormalAt(globe, 10, 20, 6, a); globeNormalAt(globe, 10, 21, 6, b);
    globeNormalNear(globe, 90 - 10.5 * 5, -180 + 20.5 * 5, 6, near);
    near.forEach((v, k) => expect(v).toBeCloseTo(a[k], 6));
    globeNormalNear(globe, 90 - 10.5 * 5, -180 + 21 * 5, 6, near);
    const mid = new Vector3(a[0] + b[0], a[1] + b[1], a[2] + b[2]).normalize().toArray();
    near.forEach((v, k) => expect(v).toBeCloseTo(mid[k], 6));
    globeNormalNear(globe, 12, 179.99, 6, near);                    // across 180 degrees: no jump, unit length
    expect(Math.hypot(near[0], near[1], near[2])).toBeCloseTo(1, 6);
  });
});

describe('ground in the middle of the view (issue #85)', () => {
  const close = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): void => {
    expect(groundAngle(a, b)).toBeLessThan(1e-6);
  };

  it('is where the line of sight meets the sphere, looking straight down or at a slant', () => {
    const site = { lat: 23.5, lon: -140 };
    const above = sitePosition(site, 0, 1).addScaledVector(siteUp(site), 500);
    close(viewGround(above, siteUp(site).negate()), site);
    // From far out, aimed at another site: the near side of the Moon, not the far side.
    const other = { lat: -10, lon: 30 }, from = sitePosition(other).addScaledVector(siteUp(other), 4000).add(new Vector3(800, 0, 0));
    close(viewGround(from, sitePosition(other).sub(from)), other);
  });

  it('is the point nearest the line of sight when it misses the Moon, never behind the camera', () => {
    const centre = moonCentre();
    // Looking along +X past the Moon, 2000 km to its south (+Y): the nearest point is the Moon's southmost.
    const from = centre.clone().add(new Vector3(-5000, 2000, 0));
    close(viewGround(from, new Vector3(1, 0, 0)), { lat: -90, lon: 0 });
    // Looking straight away from the Moon: the point under the camera.
    const site = { lat: 40, lon: 100 }, away = sitePosition(site).addScaledVector(siteUp(site), 300);
    close(viewGround(away, siteUp(site)), site);
  });

  it('measures the angle between two places, across 180 degrees', () => {
    expect(groundAngle({ lat: 0, lon: 179 }, { lat: 0, lon: -179 })).toBeCloseTo(2, 9);
    expect(groundAngle({ lat: -90, lon: 0 }, { lat: -80, lon: 123 })).toBeCloseTo(10, 9);
    expect(groundAngle({ lat: 10, lon: 20 }, { lat: 10, lon: 20 })).toBe(0);
  });
});
