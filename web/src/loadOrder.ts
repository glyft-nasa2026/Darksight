// The order the big data files download in (issue #96). The height map (dem.bin) is what the
// page waits for; the whole-Moon files (globe.bin, north.bin) only dress the pictures. Sharing
// the connection with them made dem.bin arrive about 10 s later on a slow line, so they wait
// until it has finished, whether it loaded or failed.

let heightMap: Promise<void> = Promise.resolve();

/** Records the height map's download. Called once by main.ts, before any module mounts. */
export function holdUntilHeightMap(job: Promise<unknown>): void {
  heightMap = job.then(() => undefined, () => undefined);
}

/**
 * Resolves once the height map has finished, or failed. Never rejects. On a page that never
 * loads the height map it resolves at once.
 */
export function afterHeightMap(): Promise<void> {
  return heightMap;
}
