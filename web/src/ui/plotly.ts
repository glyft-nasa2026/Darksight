// Plotly, loaded on first use (issue #95), so the readout's Sun and Earth numbers don't wait for
// it. Its basic build: scatter, bar and pie, the only chart types the site draws. 385 KB sent and
// about a quarter of the full build's start-up time; the full build (1.4 MB sent) took over a
// second to start and draw on arrival, and five on a phone. The sky, timeline and compare charts
// draw once it is in.

type PlotlyLib = (typeof import('plotly.js-basic-dist-min'))['default'];

let lib: PlotlyLib | null = null;
let loading: Promise<PlotlyLib> | null = null;
/** The last caller's turn: each caller of whenPlotly waits for the one before it. */
let queue: Promise<unknown> = Promise.resolve();
const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Starts the download if it hasn't started. Resolves to Plotly once it is in, for each caller in
 * a task of its own: a chart's first draw takes a few hundred ms on a phone, and the charts
 * drawing one after another in the task where Plotly arrived froze the page for over a second.
 * Between two draws the page can answer a tap and paint.
 */
export function whenPlotly(): Promise<PlotlyLib> {
  loading ??= import('plotly.js-basic-dist-min').then(
    (m) => {
      lib = m.default ?? (m as unknown as PlotlyLib);
      return lib;
    },
    (err: unknown) => {
      loading = null;   // a failed download is tried again on the next draw
      throw err;
    },
  );
  const load = loading;
  const turn = queue.then(() => load).then((P) => nextTask().then(() => P));
  queue = turn.catch(() => undefined);
  return turn;
}

/** Plotly if it is already in, else null. Doesn't start the download: for clearing a chart. */
export function plotlyIfLoaded(): PlotlyLib | null {
  return lib;
}

/** Plotly if it is already in, else null (and the download is started). */
export function plotlyNow(): PlotlyLib | null {
  if (!lib) void whenPlotly();
  return lib;
}

/** "Loading chart" in an empty chart box while Plotly downloads, so the box doesn't look broken. */
export function showChartWait(box: HTMLElement): void {
  if (box.querySelector(':scope > .chart-wait')) return;
  const p = document.createElement('p');
  p.className = 'muted chart-wait';
  p.textContent = 'Loading chart';
  box.append(p);
}

/** Takes the "Loading chart" text away before Plotly draws into the box. */
export function clearChartWait(box: HTMLElement): void {
  box.querySelector(':scope > .chart-wait')?.remove();
}
