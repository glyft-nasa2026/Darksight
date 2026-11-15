// Lossless packing of a height grid (16-bit heights, row by row from the top), so the height map
// downloads at about a third of its size (contract section 2, `dem.pack`). Ground is smooth, so
// each height is close to the plane through the three neighbours already known: left + above -
// above-left. Only the difference from that prediction is stored, zigzagged (0, -1, 1, -2 become
// 0, 1, 2, 3, so small differences either way are small numbers), as a plane of low bytes for
// every cell, then a plane of high bytes, which is nearly all zeros. Gzip, outside this file,
// does the rest. Every height comes back exactly: the arithmetic wraps at 16 bits both ways.

function checkSize(length: number, width: number, height: number, what: string): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`height pack: bad grid size ${width} x ${height}`);
  }
  if (length !== width * height * (what === 'packed' ? 2 : 1)) {
    throw new Error(`height pack: ${length} ${what === 'packed' ? 'bytes' : 'heights'} for a ${width} x ${height} grid`);
  }
}

/** Packs `width * height` heights, row 0 first. The result is twice as many bytes, before gzip. */
export function packHeights(values: Int16Array, width: number, height: number): Uint8Array {
  checkSize(values.length, width, height, 'heights');
  const n = width * height;
  const out = new Uint8Array(n * 2);
  for (let r = 0; r < height; r++) {
    for (let c = 0, i = r * width; c < width; c++, i++) {
      const p = r === 0 ? (c === 0 ? 0 : values[i - 1])
        : c === 0 ? values[i - width]
          : values[i - 1] + values[i - width] - values[i - width - 1];
      const d = ((values[i] - p) << 16) >> 16;    // the difference, wrapped to 16 bits
      const z = ((d << 1) ^ (d >> 31)) & 0xffff;  // zigzag
      out[i] = z & 0xff;
      out[n + i] = z >>> 8;
    }
  }
  return out;
}

/**
 * Rebuilds rows `rowStart` to `rowEnd - 1` into `out`. Each row is predicted from the one above,
 * so the rows must be rebuilt in order from row 0; the loader does it a slice at a time so a
 * phone doesn't freeze.
 */
export function unpackHeightRows(
  packed: Uint8Array, width: number, height: number, out: Int16Array, rowStart: number, rowEnd: number,
): void {
  checkSize(packed.length, width, height, 'packed');
  checkSize(out.length, width, height, 'heights');
  const n = width * height;
  for (let r = Math.max(0, rowStart); r < Math.min(height, rowEnd); r++) {
    for (let c = 0, i = r * width; c < width; c++, i++) {
      const z = packed[i] | (packed[n + i] << 8);
      const d = (z >>> 1) ^ -(z & 1);
      const p = r === 0 ? (c === 0 ? 0 : out[i - 1])
        : c === 0 ? out[i - width]
          : out[i - 1] + out[i - width] - out[i - width - 1];
      out[i] = d + p;   // an Int16Array keeps the low 16 bits, which undoes the wrap
    }
  }
}

/** Rebuilds the whole grid from packHeights' bytes (gzip already undone). */
export function unpackHeights(packed: Uint8Array, width: number, height: number): Int16Array {
  const out = new Int16Array(width * height);
  unpackHeightRows(packed, width, height, out, 0, height);
  return out;
}
