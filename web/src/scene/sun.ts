// The Sun's disc in the 3D sky (issue #120). The scene's light already comes from the Sun; this
// draws the Sun itself where that light comes from. Illustration only: whether the Sun is up at a
// site comes from core/ (the readout), not from this sprite.
import { CanvasTexture, Color, SRGBColorSpace } from 'three';

/** The Sun's mean radius (IAU 2015 nominal, km) and the mean Moon-Sun distance, 1 au (km). */
const SUN_RADIUS_KM = 695_700;
const AU_KM = 149_597_870.7;
/**
 * The Sun's angular radius seen from the Moon, about 0.267 degrees. The real value varies by
 * about 1.7% over a year; the table holds only the direction, so the mean is drawn.
 */
export const SUN_ANGULAR_RADIUS_DEG = Math.asin(SUN_RADIUS_KM / AU_KM) * 180 / Math.PI;
/** The sprite is this many disc radii from its centre to its edge: the disc plus a soft glow. */
export const SUN_HALO = 4;

/**
 * Opacity at `r` disc radii from the Sun's centre: the disc is solid, the glow fades to nothing
 * at the sprite's edge. The glow is there so the small disc can be found; it is not to scale.
 */
export function sunAlpha(r: number): number {
  if (r <= 1) return 1;
  if (r >= SUN_HALO) return 0;
  return 0.45 * ((SUN_HALO - r) / (SUN_HALO - 1)) ** 2;
}

/** Sprite width, in scene km, that draws the disc at its true apparent size `drawnKm` away. */
export function sunSpriteScale(drawnKm: number): number {
  return 2 * SUN_HALO * drawnKm * Math.tan(SUN_ANGULAR_RADIUS_DEG * Math.PI / 180);
}

/** The disc and glow, in one theme colour (`--sun`), as a texture for a sprite. */
export function sunTexture(color: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const rgb = new Color(color).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
  const channels = [rgb.r, rgb.g, rgb.b].map((c) => Math.round(c * 255)).join(', ');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (let i = 0; i <= 24; i++) {
    const at = i / 24;
    gradient.addColorStop(at, `rgba(${channels}, ${sunAlpha(at * SUN_HALO)})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
