import { describe, expect, it } from 'vitest';
import { afterHeightMap, holdUntilHeightMap } from './loadOrder';

describe('afterHeightMap', () => {
  it('waits for the height map, then resolves', async () => {
    let finish!: () => void;
    holdUntilHeightMap(new Promise<void>((resolve) => { finish = resolve; }));
    let done = false;
    const waiting = afterHeightMap().then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await waiting;
    expect(done).toBe(true);
  });

  it('resolves, not rejects, when the height map fails', async () => {
    holdUntilHeightMap(Promise.reject(new Error('dem.bin: HTTP 404')));
    await expect(afterHeightMap()).resolves.toBeUndefined();
  });
});
