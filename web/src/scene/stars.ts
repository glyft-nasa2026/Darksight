// Issue #80: the star map behind the 3D views (the Moon explorer, the launch-site picker and the
// launch simulation). The stars are the Yale Bright Star Catalogue in the ICRF
// (data/stars.bin, contract section 2); each view turns them with a rotation from core/sky.ts.
// A picture only: no number shown to the user comes from here.
//
// The stars sit at infinity: the shader drops the translation, so they never move as the camera
// does, and a star needs no far plane. They draw first, adding light to the background, and
// everything else in the scene draws over them.
import {
  AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, Points, ShaderMaterial, SRGBColorSpace,
} from 'three';
import type { Mat3 } from '../core/sky';
import { themeColor } from '../ui/plotTheme';
import { themeLength } from '../ui/launch/earth';

export type StarMeta = {
  count: number; columns: string[]; unit_scale: number; mag_scale: number;
  frame: string; epoch: number; source: string;
};
export type StarCatalog = {
  meta: StarMeta;
  /** ICRF unit vectors, three numbers a star, brightest star first. */
  dirs: Float32Array; vmag: Float32Array; bv: Float32Array;
};

/** Fainter than this, a star is not drawn: about the faintest the eye sees on a dark night. */
export const FAINTEST_MAG = 6.5;
const BRIGHTEST_MAG = -1.5;

/** Reads stars.bin (little-endian int16: x, y, z, V, B-V a star). Throws on a size mismatch. */
export function parseStars(meta: StarMeta, buffer: ArrayBuffer): StarCatalog {
  const n = meta.count;
  if (buffer.byteLength !== n * 10) throw new Error(`stars.bin is ${buffer.byteLength} bytes, expected ${n * 10}`);
  const view = new DataView(buffer);
  const dirs = new Float32Array(n * 3), vmag = new Float32Array(n), bv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const at = (k: number): number => view.getInt16((i * 5 + k) * 2, true);
    const x = at(0), y = at(1), z = at(2), len = Math.hypot(x, y, z) || 1;
    dirs[i * 3] = x / len; dirs[i * 3 + 1] = y / len; dirs[i * 3 + 2] = z / len;
    vmag[i] = at(3) / meta.mag_scale; bv[i] = at(4) / meta.mag_scale;
  }
  return { meta, dirs, vmag, bv };
}

/**
 * How a star is drawn: `size` and `light` are 0..1 of the brightest star's, `warmth` is where its
 * colour falls from --star-hot (0) through --star (0.5) to --star-cool (1).
 */
export function starLook(vmag: number, bv: number): { size: number; light: number; warmth: number } {
  const f = Math.max(0, Math.min(1, (FAINTEST_MAG - vmag) / (FAINTEST_MAG - BRIGHTEST_MAG)));
  // B-V runs from about -0.3 (blue-white) through 0.65 (the Sun) to 1.6 and more (red).
  const warmth = bv < 0.65 ? 0.5 * Math.max(0, (bv + 0.3) / 0.95) : 0.5 + 0.5 * Math.min(1, (bv - 0.65) / 0.95);
  return { size: 0.35 + 0.65 * f, light: 0.3 + 0.7 * f, warmth };
}

let shared: Promise<StarCatalog> | null = null;
/** Fetches the catalogue from data/ next to the page, once however many views ask for it. */
export function loadStars(): Promise<StarCatalog> {
  shared ??= (async () => {
    const base = import.meta.env.BASE_URL + 'data/';
    const metaRes = await fetch(base + 'stars.json');
    if (!metaRes.ok) throw new Error(`stars.json: HTTP ${metaRes.status}`);
    const meta = (await metaRes.json()) as StarMeta;
    const binRes = await fetch(base + 'stars.bin');
    if (!binRes.ok) throw new Error(`stars.bin: HTTP ${binRes.status}`);
    return parseStars(meta, await binRes.arrayBuffer());
  })();
  // A failed download can be tried again by the next view that opens.
  shared.catch(() => { shared = null; });
  return shared;
}

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    // A direction, not a point (w = 0): the camera's position doesn't move it.
    gl_Position = projectionMatrix * vec4(mat3(modelViewMatrix) * position, 0.0);
    gl_Position.z = gl_Position.w * 0.999;   // just inside the far plane
    gl_PointSize = aSize * uScale;
  }`;
const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    gl_FragColor = vec4(vColor, 1.0 - smoothstep(0.3, 1.0, r2));
  }`;

export type StarField = {
  /** Add this to the scene's root. It is empty until the catalogue arrives. */
  object: Points;
  /** Turns the stars: `m` takes an ICRF direction to the scene's frame. */
  turn(m: Mat3): void;
  /** Takes the colours and sizes from the theme again. */
  recolor(): void;
  dispose(): void;
};

/**
 * A star field for one scene. `onReady` runs when the stars arrive, so a view that draws only on
 * demand can draw again. If the catalogue can't load the scene simply has no stars.
 */
export function makeStarField(onReady: () => void = () => {}): StarField {
  const geometry = new BufferGeometry();
  const material = new ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { uScale: { value: 1 } },
    // Opaque pass, so the stars (renderOrder -1) draw before the bodies, which then cover them;
    // light is added to the background, never taken away.
    transparent: false, blending: AdditiveBlending, depthTest: false, depthWrite: false,
  });
  const object = new Points(geometry, material);
  object.name = 'Stars';
  object.renderOrder = -1;
  object.frustumCulled = false;
  object.matrixAutoUpdate = false;
  object.onBeforeRender = (renderer) => { material.uniforms.uScale.value = renderer.getPixelRatio(); };
  let catalog: StarCatalog | null = null, disposed = false;

  function build(): void {
    if (!catalog) return;
    const { dirs, vmag, bv } = catalog;
    const ends = ['--star-hot', '--star', '--star-cool'].map((name) => new Color(themeColor(name)));
    const rgb = { r: 0, g: 0, b: 0 }, mix = new Color();
    const maxPx = themeLength('--space-1');
    const positions: number[] = [], sizes: number[] = [], colors: number[] = [];
    for (let i = 0; i < vmag.length; i++) {
      if (vmag[i] > FAINTEST_MAG) continue;
      const look = starLook(vmag[i], bv[i]);
      const t = look.warmth * 2;
      mix.copy(t <= 1 ? ends[0] : ends[1]).lerp(t <= 1 ? ends[1] : ends[2], t <= 1 ? t : t - 1);
      // The shader writes its colour straight to the screen, so it wants sRGB values.
      mix.getRGB(rgb, SRGBColorSpace);
      positions.push(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
      sizes.push(maxPx * look.size);
      colors.push(rgb.r * look.light, rgb.g * look.light, rgb.b * look.light);
    }
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
    geometry.setAttribute('aColor', new Float32BufferAttribute(colors, 3));
  }

  loadStars().then((loaded) => {
    if (disposed) return;
    catalog = loaded; build(); onReady();
  }).catch(() => { /* No star file: the background stays plain. */ });

  return {
    object,
    turn(m) {
      object.matrix.set(m[0][0], m[0][1], m[0][2], 0, m[1][0], m[1][1], m[1][2], 0, m[2][0], m[2][1], m[2][2], 0, 0, 0, 0, 1);
      object.matrixWorldNeedsUpdate = true;
    },
    recolor: build,
    dispose() { disposed = true; geometry.dispose(); material.dispose(); },
  };
}
