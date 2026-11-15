# Sources: globe.pack and north.pack, the whole-Moon and north height grids packed

The packing itself is `dem.pack`'s (#176); its sources are in `docs/sources/dem-pack.md`.

| What | Used for | Link | Licence or terms |
|---|---|---|---|
| LRO LOLA `LDEM_16` and `LDEM_75N_240M` through `globe.bin` and `north.bin` (`data-prep/make_globe.py`, issue #66) | The heights packed; unchanged | See `docs/sources/issue-66.md` and `docs/sources/T43.md` | NASA PDS, public |
| `docs/sources/dem-pack.md` | The predictor, zigzag, byte planes and gzip, and why gzip rather than brotli | `docs/sources/dem-pack.md` | This repo |
| Weinberger, Seroussi and Sapiro, "The LOCO-I lossless image compression algorithm", IEEE Trans. Image Processing 9(8), 2000 | The median (MED) predictor compared on `globe.bin`: 5.16 MB, against 5.17 MB for the plane predictor kept | https://doi.org/10.1109/83.855427 | Paper (cited) |
| MDN `DecompressionStream` | Unpacking gzip in the browser | https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream | CC-BY-SA 2.5 (docs) |
| Node.js `zlib` (`gzipSync`, `gunzipSync`, `brotliCompressSync`) | Packing at build time; the size comparison | https://nodejs.org/api/zlib.html | MIT |
| Vite 8.3.8 plugin API (`generateBundle`, `emitFile`) | Writing `data/globe.pack` and `data/north.pack` into the build | https://vite.dev/guide/api-plugin.html | MIT (docs) |
| Playwright 1.65.1 and the Chrome DevTools Protocol (`Network.emulateNetworkConditions`, `Emulation.setCPUThrottlingRate`) | The page test that the built site loads the packed files; timing the loads on Fast 4G | https://playwright.dev/ · https://chromedevtools.github.io/devtools-protocol/ | Apache 2.0 · CC BY 4.0 (docs) |
