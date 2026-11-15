import { describe, expect, it } from 'vitest';
import { drain, runSliced, type Slices } from './slices';

/** Counts to `n`, one unit of work and one pause per step. `clock.t` moves 1 ms per step. */
function* count(n: number, clock: { t: number }, log: number[] = []): Slices<number> {
  let sum = 0;
  for (let i = 1; i <= n; i++) {
    sum += i; clock.t += 1; log.push(i);
    yield;
  }
  return sum;
}

/** A scheduler the test runs by hand: `later` only queues, `turn` runs one queued task. */
function byHand() {
  const tasks: (() => void)[] = [];
  return {
    later: (fn: () => void) => { tasks.push(fn); },
    turn: () => { const fn = tasks.shift(); fn?.(); return !!fn; },
    waiting: () => tasks.length,
  };
}

describe('drain', () => {
  it('runs a job to its end and returns its result', () => {
    expect(drain(count(100, { t: 0 }))).toBe(5050);
  });
});

describe('runSliced', () => {
  it('does nothing until the browser has had its turn', () => {
    const clock = { t: 0 }, log: number[] = [], sched = byHand();
    runSliced(count(10, clock, log), { now: () => clock.t, later: sched.later, sliceMs: 4 });
    expect(log).toEqual([]);
    expect(sched.waiting()).toBe(1);
  });

  it('stops each slice at the first pause after sliceMs and carries on in a new task', async () => {
    const clock = { t: 0 }, log: number[] = [], sched = byHand();
    const job = runSliced(count(10, clock, log), { now: () => clock.t, later: sched.later, sliceMs: 4 });
    sched.turn();
    expect(log).toEqual([1, 2, 3, 4]);          // 4 ms of work, then a pause
    sched.turn();
    expect(log).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    sched.turn();
    expect(log.length).toBe(10);
    expect(sched.waiting()).toBe(0);            // done: nothing more is queued
    await expect(job.done).resolves.toBe(55);
  });

  it('gives the same result as running the job in one go', async () => {
    const sched = byHand(), clock = { t: 0 };
    const job = runSliced(count(1000, clock), { now: () => clock.t, later: sched.later, sliceMs: 7 });
    while (sched.turn()) { /* every slice */ }
    await expect(job.done).resolves.toBe(drain(count(1000, { t: 0 })));
  });

  it('a cancelled job runs no further slice', () => {
    const clock = { t: 0 }, log: number[] = [], sched = byHand();
    const job = runSliced(count(10, clock, log), { now: () => clock.t, later: sched.later, sliceMs: 4 });
    sched.turn();
    job.cancel();
    sched.turn();
    expect(log).toEqual([1, 2, 3, 4]);
    expect(sched.waiting()).toBe(0);
  });

  it('rejects when the job throws', async () => {
    const sched = byHand();
    function* broken(): Slices<number> { yield; throw new Error('no heights'); }
    const job = runSliced(broken(), { now: () => 0, later: sched.later });
    while (sched.turn()) { /* every slice */ }
    await expect(job.done).rejects.toThrow('no heights');
  });

  it('runs with the real clock and scheduler too', async () => {
    const clock = { t: 0 };
    await expect(runSliced(count(50, clock)).done).resolves.toBe(1275);
  });
});
