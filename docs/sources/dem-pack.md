# Sources: dem.pack, the height map at a third of its size

| What | Used for | Link | Licence or terms |
|---|---|---|---|
| LRO LOLA `LDEM_75S_240M` through `dem.bin` (T04) | The heights packed; unchanged | See `docs/sources/T04.md` | NASA PDS, public |
| W3C PNG specification, "Filter types" (Paeth and the up/left filters) | The idea of predicting a sample from its left, upper and upper-left neighbours | https://www.w3.org/TR/png-3/#9Filter-types | W3C document licence |
| Weinberger, Seroussi and Sapiro, "The LOCO-I lossless image compression algorithm", IEEE Trans. Image Processing 9(8), 2000 | The median and plane predictors compared (JPEG-LS) | https://doi.org/10.1109/83.855427 | Paper (cited) |
| Protocol Buffers "Encoding", signed integers (ZigZag) | Mapping small negative differences to small numbers | https://protobuf.dev/programming-guides/encoding/#signed-ints | CC BY 4.0 (docs) |
| MDN `DecompressionStream` | Unpacking gzip in the browser | https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream | CC-BY-SA 2.5 (docs) |
| Node.js `zlib` (`gzipSync`, `gunzipSync`, `brotliCompressSync`) | Packing at build time; the size comparison | https://nodejs.org/api/zlib.html | MIT |
| Vite 8.3.8 plugin API (`generateBundle`, `emitFile`) and "configLoader" | Writing `data/dem.pack` into the build; why the config imports `.ts` with its extension | https://vite.dev/guide/api-plugin.html · https://vite.dev/config/#configuring-vite | MIT (docs) |
| Cloudflare "Content compression" | Which content types Cloudflare compresses (not `application/octet-stream`) | https://developers.cloudflare.com/speed/optimization/content/compression/ | Cloudflare (docs) |
| Playwright 1.65.1 and the Chrome DevTools Protocol (`Network.emulateNetworkConditions`, `Emulation.setCPUThrottlingRate`) | Timing the loads on Fast 4G | https://playwright.dev/ · https://chromedevtools.github.io/devtools-protocol/ | Apache 2.0 · CC BY 4.0 (docs) |
| ImageMagick `compare` | Terrain screenshots, `main` against the branch | https://imagemagick.org/script/compare.php | ImageMagick licence |
