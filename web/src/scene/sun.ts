// The Sun in the 3D sky (issue #120). The scene's light already comes from the Sun; this draws
// the Sun itself where that light comes from. Illustration only: whether the Sun is up at a site
// comes from core/ (the readout), not from these sprites.
//
// Two sprites: the disc, at the Sun's true direction and true apparent size (about 0.53 degrees,
// a few pixels across), and a glare round it with a fixed size on screen, like the pins, so the
// disc can be found. The glare is a symbol, not to scale.
import { CanvasTexture, Color, SRGBColorSpace } from 'three';

/** The Sun's mean radius (IAU 2015 nominal, km) and the mean Moon-Sun distance, 1 au (km). */
const SUN_RADIUS_KM = 695_700;
const AU_KM = 149_597_870.7;
/**
 * The Sun's angular radius seen from the Moon, about 0.267 degrees. The real value varies by
 * about 1.7% over a year; the table holds only the direction, so the mean is drawn.
 */
export const SUN_ANGULAR_RADIUS_DEG = Math.asin(SUN_RADIUS_KM / AU_KM) * 180 / Math.PI;

/** Sprite width, in scene km, that draws the disc at its true apparent size `drawnKm` away. */
export function sunDiscScale(drawnKm: number): number {
  return 2 * drawnKm * Math.tan(SUN_ANGULAR_RADIUS_DEG * Math.PI / 180);
}

/** The disc's opacity at `r` (0 centre, 1 sprite edge): solid, with a soft rim against jagged edges. */
export function discAlpha(r: number): number {
  return Math.max(0, Math.min(1, (1 - r) / 0.1));
}

/** The glare's opacity at `r` (0 centre, 1 sprite edge): bright in the middle, gone at the edge. */
export function glareAlpha(r: number): number {
  return r >= 1 ? 0 : 0.85 * (1 - r) ** 2;
}

/** A round sprite texture in one theme colour (`--sun`), its opacity by distance from the centre. */
export function sunTexture(color: string, alpha: (r: number) => number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const rgb = new Color(color).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
  const channels = [rgb.r, rgb.g, rgb.b].map((c) => Math.round(c * 255)).join(', ');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (let i = 0; i <= 32; i++) gradient.addColorStop(i / 32, `rgba(${channels}, ${alpha(i / 32)})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
