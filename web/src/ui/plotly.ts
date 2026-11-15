// Plotly, loaded on first use (issue #95). It is about 1.1 MB of the site script's 1.6 MB sent,
// and the readout's Sun and Earth numbers don't need it: as a separate file it no longer holds
// them up. The sky and timeline charts draw once it is in; compare has its own loader.

type PlotlyLib = (typeof import('plotly.js-dist-min'))['default'];

let lib: PlotlyLib | null = null;
let loading: Promise<PlotlyLib> | null = null;

/** Starts the download if it hasn't started. Resolves to Plotly once it is in. */
export function whenPlotly(): Promise<PlotlyLib> {
  loading ??= import('plotly.js-dist-min').then(
    (m) => {
      lib = m.default ?? (m as unknown as PlotlyLib);
      return lib;
    },
    (err: unknown) => {
      loading = null;   // a failed download is tried again on the next draw
      throw err;
    },
  );
  return loading;
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
