// Long work in slices. A job that would freeze the page for a second (building the 3D meshes,
// lighting the map's 1.6 million cells) is written as a generator that yields every few rows;
// runSliced runs it a slice of a few milliseconds at a time and gives the browser its turn in
// between, so the page keeps painting and answering clicks. The work and its result are the same
// as running it in one go, which is what drain does (tests, and callers that must have the answer
// now).

/** Work that can pause: every `yield` is a place where the browser may take its turn. */
export type Slices<T> = Generator<void, T, void>;

/** Runs a job to its end in one go and returns its result. */
export function drain<T>(job: Slices<T>): T {
  for (;;) {
    const step = job.next();
    if (step.done) return step.value;
  }
}

/**
 * Milliseconds of work between two pauses. Short enough that a phone four times slower than the
 * laptop it was tuned on still answers a tap within a frame or two, long enough that the pauses
 * themselves cost little.
 */
export const SLICE_MS = 12;

export type SliceOptions = {
  /** Milliseconds of work between two pauses (default SLICE_MS). */
  sliceMs?: number;
  /** The clock, in milliseconds. Tests pass their own. */
  now?: () => number;
  /** Runs a function as a new task, after the browser has had its turn. Tests pass their own. */
  later?: (fn: () => void) => void;
};

export type SlicedJob<T> = {
  /** The job's result. Never settles for a job that was cancelled; rejects if the job throws. */
  done: Promise<T>;
  /** Stops the job before its next slice. Its result is dropped. */
  cancel(): void;
};

// A new task through a message, not setTimeout(fn, 0): browsers hold nested timeouts back by 4 ms
// each, which would add a second to a job of 250 slices.
const queue: (() => void)[] = [];
const channel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
if (channel) {
  channel.port1.onmessage = () => { queue.shift()?.(); };
  // In Node (the tests) an open port would keep the process alive; browsers have no unref.
  (channel.port1 as { unref?: () => void }).unref?.();
}
function soon(fn: () => void): void {
  if (!channel) { setTimeout(fn, 0); return; }
  queue.push(fn);
  channel.port2.postMessage(null);
}

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Runs a job a slice at a time, starting in a new task, and gives the browser its turn between
 * slices. A slice ends at the first `yield` after `sliceMs` of work, so a job should yield at
 * least every few milliseconds of work.
 */
export function runSliced<T>(job: Slices<T>, options: SliceOptions = {}): SlicedJob<T> {
  const sliceMs = options.sliceMs ?? SLICE_MS, now = options.now ?? clock, later = options.later ?? soon;
  let cancelled = false;
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const done = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  const slice = (): void => {
    if (cancelled) return;
    const until = now() + sliceMs;
    try {
      for (;;) {
        const step = job.next();
        if (step.done) { resolve(step.value); return; }
        if (now() >= until) break;
      }
    } catch (err) {
      reject(err);
      return;
    }
    later(slice);
  };
  later(slice);
  return { done, cancel: () => { cancelled = true; } };
}
