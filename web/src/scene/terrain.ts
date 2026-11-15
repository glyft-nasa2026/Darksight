import { BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, SphereGeometry, Vector3 } from 'three';
import { projectToGrid, type Dem, type DemMeta } from '../core/dem';
import { MOON_RADIUS_KM, type Site } from '../core/types';
import { gridSite, moonCentre, sitePosition, sphereSite } from './coordinates';
import { mapGlobeUv } from './globe';

export type GridBounds = { col0: number; col1: number; row0: number; row1: number };
/** Which grid points a mesh's vertices sit on, kept so its triangles can be rebuilt. */
type Layout = { b: GridBounds; stride: number; cols: number; rows: number; valid: Uint8Array };

const RAD = Math.PI / 180;

/** Grid step of the whole-region mesh: at most 512 points a side, whatever the DEM's size. */
export function coarseStride(meta: DemMeta): number {
  return Math.ceil((meta.size - 1) / 511);
}

/** Native cells near the selected site, capped to keep edits and scrubbing responsive. */
export function detailBounds(dem: Dem, site: Site): GridBounds {
  const { col, row } = projectToGrid(dem.meta, site.lat, site.lon);
  const half = Math.min(64, Math.max(2, Math.ceil(20_000 / dem.meta.pixel_m)));
  const last = dem.meta.size - 1;
  const stride = coarseStride(dem.meta);
  const c = Math.max(0, Math.min(last, Math.round(col)));
  const r = Math.max(0, Math.min(last, Math.round(row)));
  return {
    col0: Math.max(0, Math.floor((c - half) / stride) * stride),
    col1: Math.min(last, Math.ceil((c + half) / stride) * stride),
    row0: Math.max(0, Math.floor((r - half) / stride) * stride),
    row1: Math.min(last, Math.ceil((r + half) / stride) * stride),
  };
}

/**
 * The Moon as a sphere centred on the origin (the caller moves it to the Moon's centre).
 * With a height map, the cap the terrain covers (south of `min_lat`, inside the grid) is left
 * open so the terrain isn't buried under the sphere. The opening is two coarse cells smaller
 * than the terrain, so the terrain's stepped edge never leaves a gap; where the two overlap the
 * globe's material is pushed back in depth so the terrain wins.
 * Texture coordinates follow the whole-Moon grid (globe.ts), whatever part of the sphere is built.
 */
export function globeGeometry(meta?: DemMeta | null, north?: DemMeta | null): SphereGeometry {
  const south = meta ? capAngle(meta) : 0;
  // The north cap (northGeometry) gets the same opening at the other pole.
  const top = north ? capAngle(north) : 0;
  // Render frame +Y is south, and SphereGeometry measures theta from +Y.
  return withGlobeUv(new SphereGeometry(MOON_RADIUS_KM, 128, 96, 0, Math.PI * 2, south, Math.PI - south - top));
}

/** How far from its pole, in radians, the sphere is left open for a polar height map. */
function capAngle(meta: DemMeta): number {
  const rM = MOON_RADIUS_KM * 1000;
  const last = meta.size - 1;
  // Distance from the pole to the nearest grid edge, so a grid smaller than min_lat still has no gap.
  const half = Math.min(-meta.x_min_m, meta.x_min_m + last * meta.pixel_m,
    meta.y_max_m, last * meta.pixel_m - meta.y_max_m);
  const gridColat = 2 * Math.atan(Math.max(0, half) / (2 * rM));
  const overlap = 2 * coarseStride(meta) * meta.pixel_m / rM;
  return Math.max(0, Math.min((90 - Math.abs(meta.min_lat)) * RAD, gridColat) - overlap);
}

/** Degrees over which a polar mesh's ground eases down to the sphere toward its edge (issue #114). */
export const CAP_FADE_DEG = 1;

/**
 * The share of its height a polar height map's ground is drawn with at `lat` (issue #114): 1
 * inside, easing to 0 where the globe's opening ends (capAngle), so the mesh meets the sphere,
 * and the level-of-detail patch, whose edge also lies on the sphere, with no step or crack.
 * The band is narrower on a grid too small for a whole degree.
 */
export function capWeight(meta: DemMeta, lat: number): number {
  const open = capAngle(meta) / RAD;
  const t = (open - (90 - Math.abs(lat))) / Math.min(CAP_FADE_DEG, open / 4);
  if (!(t > 0)) return 0;
  return t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/** A polar height map's height at (lat, lon) as the 3D scene draws it, in metres: see capWeight. */
export function drawnDemHeight(dem: Dem, lat: number, lon: number): number {
  return dem.heightAt(lat, lon) * capWeight(dem.meta, lat);
}

function withGlobeUv(geometry: SphereGeometry): SphereGeometry {
  mapGlobeUv(geometry);
  return geometry;
}

/** Writes the triangles whose three corners have data, leaving out the quads inside `hole`. */
function fillIndex(geometry: BufferGeometry, hole?: GridBounds): void {
  const { b, stride, cols, rows, valid } = geometry.userData.layout as Layout;
  const index = geometry.getIndex()!;
  const out = index.array as Uint32Array;
  let n = 0;
  for (let row = 0; row < rows - 1; row++) {
    const r0 = b.row0 + row * stride;
    const rowInHole = !!hole && r0 >= hole.row0 && Math.min(b.row1, r0 + stride) <= hole.row1;
    for (let col = 0; col < cols - 1; col++) {
      if (rowInHole && hole) {
        const c0 = b.col0 + col * stride;
        if (c0 >= hole.col0 && Math.min(b.col1, c0 + stride) <= hole.col1) continue;
      }
      const a = row * cols + col, next = a + 1, c = a + cols, d = c + 1;
      if (valid[a] && valid[next] && valid[c]) { out[n++] = a; out[n++] = c; out[n++] = next; }
      if (valid[next] && valid[c] && valid[d]) { out[n++] = next; out[n++] = c; out[n++] = d; }
    }
  }
  out.fill(0, n);
  geometry.setDrawRange(0, n);
  index.needsUpdate = true;
}

/**
 * Moves the coarse mesh's hole to sit under a new detail patch, or closes it (no `hole`).
 * Only the triangle list changes; the vertices stay, so a new site doesn't rebuild the region.
 */
export function setTerrainHole(geometry: BufferGeometry, hole?: GridBounds): void {
  fillIndex(geometry, hole);
}

/** A curved, indexed mesh. UVs map back to the full DEM, including for the detail patch.
 * Height, size, spacing and coverage all come from the loader, never a dataset-specific constant.
 * Colours follow the real heights; the shape eases down to the sphere at the edge (capWeight).
 */
export function terrainGeometry(
  dem: Dem, low: Color, high: Color, stretch = 1, bounds?: GridBounds, hole?: GridBounds,
): BufferGeometry {
  const last = dem.meta.size - 1;
  const b = bounds ?? { col0: 0, col1: last, row0: 0, row1: last };
  const coarse = coarseStride(dem.meta);
  const stride = bounds ? 1 : coarse;
  const cols = Math.ceil((b.col1 - b.col0) / stride) + 1;
  const rows = Math.ceil((b.row1 - b.row0) / stride) + 1;
  const count = cols * rows;
  const positions = new Float32Array(count * 3);
  /** The ground at its full height, which the normals are taken from (see capWeight). */
  const lit = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const heights = new Float32Array(count);
  /** Each point's capWeight: heights give the colours and light, heights times weights the shape. */
  const weights = new Float32Array(count);
  const valid = new Uint8Array(count);
  const fullHeight = (lat: number, lon: number): number => dem.heightAt(lat, lon);
  const drawnHeight = (lat: number, lon: number): number => drawnDemHeight(dem, lat, lon);
  let min = Infinity, max = -Infinity;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const c = Math.min(b.col1, b.col0 + col * stride);
      const r = Math.min(b.row1, b.row0 + row * stride);
      const site = gridSite(dem.meta, c, r);
      valid[i] = dem.covers(site.lat, site.lon) ? 1 : 0;
      const height = valid[i] ? dem.heightAt(site.lat, site.lon) : 0;
      heights[i] = height;
      weights[i] = capWeight(dem.meta, site.lat);
      if (valid[i]) { min = Math.min(min, height); max = Math.max(max, height); }
      sitePosition(site, height * weights[i], stretch).toArray(positions, i * 3);
      sitePosition(site, height, stretch).toArray(lit, i * 3);
      // Stitch the native patch to the coarse edges: their intermediate positions must lie
      // on the same straight edges, rather than leave narrow cracks between curved samples.
      if (bounds && (col === 0 || col === cols - 1 || row === 0 || row === rows - 1)) {
        const alongRow = row === 0 || row === rows - 1;
        const v = alongRow ? c : r;
        const lo = Math.floor(v / coarse) * coarse;
        const hi = Math.min(last, lo + coarse);
        if (hi > lo) {
          const a = gridSite(dem.meta, alongRow ? lo : c, alongRow ? r : lo);
          const z = gridSite(dem.meta, alongRow ? hi : c, alongRow ? r : hi);
          for (const [out, h] of [[positions, drawnHeight], [lit, fullHeight]] as const) {
            sitePosition(a, h(a.lat, a.lon), stretch)
              .lerp(sitePosition(z, h(z.lat, z.lon), stretch), (v - lo) / (hi - lo))
              .toArray(out, i * 3);
          }
        }
      }
      uvs[i * 2] = c / last;
      uvs[i * 2 + 1] = r / last;
    }
  }
  const colors = new Float32Array(count * 3);
  const color = new Color();
  // The caller reuses the whole-grid range for a detail patch through recolorTerrain().
  const range = Math.max(1, max - min);
  for (let i = 0; i < count; i++) {
    color.copy(low).lerp(high, Math.max(0, Math.min(1, (heights[i] - min) / range)));
    color.toArray(colors, i * 3);
  }
  const geometry = new BufferGeometry();
  // Lit from the full heights, so the band easing down to the sphere keeps its craters' shading.
  geometry.setAttribute('position', new Float32BufferAttribute(lit, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('height', new Float32BufferAttribute(heights, 1));
  geometry.userData.layout = { b, stride, cols, rows, valid } satisfies Layout;
  geometry.userData.weights = weights;
  geometry.setIndex(new BufferAttribute(new Uint32Array(Math.max(0, (cols - 1) * (rows - 1) * 6)), 1));
  // Normals come from the whole mesh, so they stay smooth along the edge of a hole.
  fillIndex(geometry);
  geometry.computeVertexNormals();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  if (hole) fillIndex(geometry, hole);
  geometry.computeBoundingSphere();
  geometry.userData.heightRange = Number.isFinite(min) ? [min, max] : [0, 1];
  geometry.userData.stretch = stretch;
  return geometry;
}

/**
 * Moves a whole-grid terrainGeometry or a northGeometry to another stretch, each point along its
 * own radius, without rebuilding it: a fraction of the cost. Normals and colours stay as built.
 * Not for a detail patch, whose edge points are stitched to the coarse mesh's straight edges.
 */
export function restretchTerrain(geometry: BufferGeometry, stretch: number): void {
  const from = geometry.userData.stretch as number;
  if (from === stretch) return;
  const position = geometry.getAttribute('position'), heights = geometry.getAttribute('height');
  const weights = geometry.userData.weights as Float32Array;
  const centre = moonCentre(), point = new Vector3();
  for (let i = 0; i < position.count; i++) {
    const h = heights.getX(i) * weights[i] / 1000;
    point.fromBufferAttribute(position, i).sub(centre)
      .multiplyScalar((MOON_RADIUS_KM + h * stretch) / (MOON_RADIUS_KM + h * from)).add(centre);
    position.setXYZ(i, point.x, point.y, point.z);
  }
  position.needsUpdate = true;
  geometry.userData.stretch = stretch;
  geometry.computeBoundingSphere(); geometry.computeBoundingBox();
}

/**
 * How much steeper the north cap's slopes are lit. Less than the globe's GLOBE_RELIEF because its
 * cells are a third the size, so the same ground already measures steeper; picked by eye to match.
 */
export const NORTH_RELIEF = 2;

/**
 * The cap north of the whole-Moon grid's reach, as a mesh on a square polar grid like the
 * south-pole terrain, so nothing pinches together at the pole. `mirrored` is the north height
 * map with latitudes negated (parseNorth): the mesh is built as if at the south pole, then
 * reflected through the equator. Heights are raised `stretch` times, like the south-pole
 * terrain's. Slopes are lit `relief` times steeper whatever the stretch, so the cap's shading
 * still matches the unstretched globe round it.
 */
export function northGeometry(mirrored: Dem, low: Color, high: Color, relief = NORTH_RELIEF, stretch = 1): BufferGeometry {
  const geometry = terrainGeometry(mirrored, low, high, stretch);
  if (relief !== stretch) {
    const steep = terrainGeometry(mirrored, low, high, relief);
    geometry.setAttribute('normal', steep.getAttribute('normal'));
  }
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  for (let i = 0; i < position.count; i++) {
    // The equator's plane is y = -R in the render frame.
    position.setY(i, -2 * MOON_RADIUS_KM - position.getY(i));
    normal.setY(i, -normal.getY(i));
  }
  // A reflection turns every triangle to face inward; swapping two corners turns it back.
  const index = geometry.getIndex()!;
  for (let i = 0; i < geometry.drawRange.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, b);
  }
  position.needsUpdate = normal.needsUpdate = index.needsUpdate = true;
  geometry.computeBoundingSphere(); geometry.computeBoundingBox();
  return geometry;
}

/**
 * Mean height, in metres, of the terrain within `band` degrees of its northern edge. The plain
 * globe beyond the height map takes this height's colour, so no ring shows where the map stops.
 */
export function edgeHeight(geometry: BufferGeometry, band = 0.5): number {
  const positions = geometry.getAttribute('position'), heights = geometry.getAttribute('height');
  const { valid } = geometry.userData.layout as Layout;
  const lats = new Float32Array(heights.count), point = new Vector3();
  let north = -Infinity;
  for (let i = 0; i < heights.count; i++) {
    if (!valid[i]) continue;
    lats[i] = sphereSite(point.fromBufferAttribute(positions, i)).lat;
    north = Math.max(north, lats[i]);
  }
  let sum = 0, n = 0;
  for (let i = 0; i < heights.count; i++) {
    if (valid[i] && lats[i] >= north - band) { sum += heights.getX(i); n++; }
  }
  return n ? sum / n : 0;
}

/** Reuse the coarse mesh's physical height range so a detail patch has no colour seam. */
export function recolorTerrain(geometry: BufferGeometry, low: Color, high: Color, range: number[]): void {
  const heights = geometry.getAttribute('height');
  const colors = geometry.getAttribute('color');
  const color = new Color();
  const span = Math.max(1, range[1] - range[0]);
  for (let i = 0; i < heights.count; i++) {
    color.copy(low).lerp(high, Math.max(0, Math.min(1, (heights.getX(i) - range[0]) / span)));
    colors.setXYZ(i, color.r, color.g, color.b);
  }
  colors.needsUpdate = true;
}
