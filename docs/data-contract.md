# Data contract

The one file both halves follow. Anyone can propose a contract change as part of a task.
Coordinate overlapping edits and tell contributors using the interface before changing it;
update the contract and affected code together.

Conventions (also in `CLAUDE.md`): degrees; latitude north-positive; longitude east-positive,
-180 to 180; azimuth clockwise from north; UTC; Moon radius `R = 1737.4 km`; heights in metres
above that sphere; no atmospheric refraction.

## 1. Moon-fixed frame

All vectors are in the Moon's mean-Earth frame (Skyfield name `MOON_ME_DE440_ME421`, built from
the DE440 kernels), the frame LOLA maps use.

- `+x` points at latitude 0, longitude 0 (the middle of the side facing Earth)
- `+y` points at latitude 0, longitude 90 E
- `+z` points at the north pole

## 2. Files in `web/public/data/`

### Mock data (made by T20, then replaced file by file by T01, T03, T04 and T07)

Same file names and formats as the real files, so the site runs before the real data exists.
A mock file says so: `"source": "mock"` in `ephemeris.json` and `dem.json`, and
`"checked_at": null` in `validation.json`. Tests that need real data skip when they see this.

| Mock feature | Where |
|---|---|
| Height grid | `size` 634, `pixel_m` 960, `x_min_m` -304320, `y_max_m` 304320; flat at 0 m apart from the features below |
| Bowl crater, 10 km radius, floor 3,000 m down | Centre: latitude -88.0, longitude 45.0 |
| Its rim, 500 m above the plain | 10 km from the centre. Due north of it: latitude -87.67, longitude 45.0 |
| Ridge, 1,500 m high, 20 km long | Centre: latitude -87.0, longitude -120.0 |
| Sun | Circles once per 29.53 days, never more than 1.5 degrees from the Moon's equator |
| Earth | 384,400 km away, near `+x`, wobbling 7 degrees either way over 27.3 days |
| `sites.json` | `mock-floor` (-88.0, 45.0), `mock-rim` (-87.67, 45.0), `mock-equator` (1.0, 23.0) |

When a task says "crater floor" or "crater rim", it means these points on mock data, and
`shackleton-floor` and `shackleton-rim` from `sites.json` on real data.

### `ephemeris.json` + `ephemeris/<decade>.bin` (made by T01)

One row every 3 hours, 1900-01-01T00Z to 2101-01-01T00Z, split into one file per decade so the page downloads
only what it needs: the 2020s (`home`) on load, any other decade the first time a scenario's
time needs it. `ephemeris.json` is the index:

```json
{
  "start": "1900-01-01T00:00:00Z",
  "step_s": 10800,
  "rows": 587313,
  "frame": "MOON_ME_DE440_ME421",
  "columns": ["sun_x", "sun_y", "sun_z", "earth_x_km", "earth_y_km", "earth_z_km"],
  "source": "JPL DE440 via Skyfield",
  "home": 12,
  "chunks": [
    { "file": "ephemeris/1900.bin", "start": "1900-01-01T00:00:00Z", "rows": 29217, "hash": "4087c9f312215c1f" },
    "... one per decade, 1900 to 2090 ...",
    { "file": "ephemeris/2090.bin", "start": "2090-01-01T00:00:00Z", "rows": 32137, "hash": "cfcf9e643a152242" }
  ]
}
```

Each decade file runs from its decade's first hour to the next decade's first hour inclusive,
so neighbouring files share one row and a time inside a decade needs that file alone. The
2090s file runs to 2101-01-01T00Z. `rows` counts each shared row once. Row `i` of a file is at
its `start` + `i` * `step_s` of Unix time (no leap seconds). About 0.7 MB per file, 14.1 MB in
all. `hash` is the first 16 hex digits of the file's SHA-256.

The browser keeps each decade file it downloads in Cache Storage, under the file's URL plus
`?v=<hash>`, and reads it from there on later visits; copies the index no longer lists are
removed. `ephemeris.json` itself is always asked for again (`no-cache`), so a regenerated table
is picked up on the next visit.

A 3-hour step is accurate enough: with the browser's straight-line step and re-normalised Sun,
the table agrees with Skyfield's own surface alt/az to 0.001 degrees (T02 allows 0.02).

A table without `chunks` is one file, `ephemeris.bin`, holding all `rows` (T20's mock and the
tests use this form).

Each `.bin`: little-endian float32, 6 values per row, rows in time order.

- `sun_*`: unit vector from the Moon's centre to the Sun (apparent, light-time corrected)
- `earth_*_km`: vector from the Moon's centre to Earth's centre, in km

Earth is stored with its distance because it is close enough that the site's position on the
Moon shifts its direction by up to about 0.26 degrees. The Sun is too far for that to matter.

### `dem.bin` + `dem.json` (made by T04)

A square height grid in south polar stereographic projection, **in our own grid defined here**,
whatever layout the LOLA source file uses.

`dem.json`:

```json
{
  "size": 2534,
  "pixel_m": 240,
  "x_min_m": -304080,
  "y_max_m": 304080,
  "height_scale": 0.5,
  "nodata": -32768,
  "min_lat": -80,
  "source": "LOLA product name and version here"
}
```

`dem.bin`: little-endian int16, `size * size` values, row by row from the top row
(`y = y_max_m`). Height in metres = `value * height_scale`.

Projection (sphere, true scale at the pole):

```
c   = 90 + lat                      degrees from the south pole
r   = 2 * R * tan(c / 2)            metres
x   = r * sin(lon)
y   = r * cos(lon)                  longitude 0 points up, 90 E points right
col = (x - x_min_m) / pixel_m
row = (y_max_m - y) / pixel_m
```

Inverse: `r = hypot(x, y)`, `lat = 2 * atan(r / (2R)) - 90`, `lon = atan2(x, y)`.

`size` and `pixel_m` may change if T04 needs it; code reads them from `dem.json`, never
hard-codes them. File budget: 15 MB.

`dem.pack` (made by `npm run build` from `dem.bin`, not by T04; only in the built site): the
same heights, losslessly packed, 4.4 MB against `dem.bin`'s 12.8 MB, which a host sends
uncompressed. The site loads it first and `dem.bin` where it is missing or broken (the dev
server has none). It is gzip of `2 * size * size` bytes: for each cell, row by row from the
top, the stored value minus a prediction (`left + above - above-left`; `left` on the top row,
`above` in the first column, 0 for the first cell), wrapped to 16 bits and zigzagged (0, -1, 1,
-2 become 0, 1, 2, 3); the low bytes of every cell, then the high bytes. Code:
`core/heightPack.ts`. Python and tests keep reading `dem.bin`.

### `globe.bin` + `globe.json`, `north.bin` + `north.json` (made by `data-prep/make_globe.py`, issue #66)

Heights of the Moon north of the south-pole height map. They draw pictures: the 3D globe, and
the flat map (whole-Moon view, the fading ring around a polar view, and the north polar view).
Since T43 (decision of 15 Nov 2026, SPEC section 6) they are also a source of numbers, the one
exception to "pictures only": the height and slope map layers, and the readout's slope line, take
heights from them where `dem.bin` does not reach, through `core/globe.ts` (section 3). No other
number comes from them. They download once, after `dem.bin` (issue #96), for every view that
uses them (`sharedGlobe()` and `sharedNorth()` in `web/src/scene/globeHeights.ts`); the globe is
a plain sphere until they arrive or when they are missing (the mock data set has none). Both come
from the same LOLA gridded data record as `dem.bin`.

`globe.json`:

```json
{
  "width": 2880,
  "height": 1440,
  "height_scale": 0.5,
  "source": "LOLA product name and version here"
}
```

Read by `core/globe.ts` (`parseGlobe`, `parseNorth`). The 3D globe, the 2D map (its whole-Moon
picture and its north polar view, issue #112), the map layers and the readout share one download
of each file.

`globe.bin`: little-endian int16, `width * height` values, row by row. Height in metres =
`value * height_scale`, above the `R` sphere. A latitude-longitude grid laid out like
`shadeGlobal`'s: cell (row `j`, column `i`) is centred on latitude `90 - (j + 0.5) * 180 / height`
and longitude `-180 + (i + 0.5) * 360 / width`. So row 0 is at 90 N and column 0 starts at
180 W. 0.125 degrees a cell (3.8 km at the equator); 8.29 MB. File budget: 9 MB.

`north.json` has the fields of `dem.json`, with `min_lat` 80 (the southern limit of the data).
`north.bin`: little-endian int16, `size * size` values, row by row from the top. The grid is the
mirror image of `dem.bin`'s, about the north pole, because a latitude-longitude grid pinches
together at a pole:

```
c   = 90 - lat                      degrees from the north pole
r   = 2 * R * tan(c / 2)            metres
x   = r * sin(lon)
y   = r * cos(lon)                  longitude 0 points up, 90 E points right
col = (x - x_min_m) / pixel_m
row = (y_max_m - y) / pixel_m
```

`size` 509, `pixel_m` 1200; 0.52 MB. File budget: 1 MB.

### `tiles.json` + `tiles/rRRcCC.bin` (made by `data-prep/make_globe.py`, issue #66)

Level of detail for the 3D globe: finer whole-Moon heights, cut into tiles so the page fetches
only the one to four under the selected site, when a site is picked in the 3D globe view. For
the picture only, like `globe.bin`, and loaded by `web/src/scene/patch.ts`. From the same LOLA
gridded data record as `dem.bin`.

`tiles.json`:

```json
{
  "cells_per_deg": 32,
  "tile_deg": 15,
  "height_scale": 0.5,
  "source": "LOLA product name and version here"
}
```

The whole grid is laid out like `globe.bin` at `cells_per_deg` cells a degree (about 950 m at the
equator). Tile row `RR` counts from 90 N and tile column `CC` from 180 W, each `tile_deg`
degrees: 12 rows of 24. A tile is little-endian int16, `(tile_deg * cells_per_deg)` squared
values (480 x 480, 0.46 MB), row by row from its north edge. 288 tiles, 132.7 MB in all, of
which a visit downloads only what it looks at. Budget: 140 MB in all.

### `stars.json` + `stars.bin` (made by `data-prep/make_stars.py`, issue #80)

The star map behind the three 3D views (the Moon explorer's 3D orbit, the launch-site picker and
the launch simulation). For the picture only: no number shown to the user comes from it, and
nothing in `core/` loads it. `web/src/scene/stars.ts` fetches it once per page; a view without
it has a plain background.

```json
{
  "count": 9096,
  "columns": ["x", "y", "z", "vmag", "bv"],
  "unit_scale": 32767,
  "mag_scale": 1000,
  "frame": "ICRF (J2000 equator and equinox)",
  "epoch": 2000.0,
  "source": "Yale Bright Star Catalogue, 5th revised ed. (Hoffleit and Warren 1991), VizieR V/50"
}
```

`stars.bin`: little-endian int16, 5 values a star, brightest first: the ICRF unit vector to the
star times `unit_scale`, then V magnitude and B-V colour times `mag_scale`. Every catalogue star
with a position (14 of the 9,110 have none); B-V is 0.6 where the catalogue gives none. Proper
motion is left out. 91 KB. File budget: 150 KB.

Each view turns the stars with a rotation from `core/sky.ts`: the Moon explorer by the Moon's
orientation at the selected scenario's time, the picker by Earth's at the planned launch, the
simulation by laying the scene's transfer plane on the Moon's real orbit plane at touchdown.

### `sites.json` (made by T07)

```json
[
  {
    "id": "apollo-11",
    "name": "Apollo 11",
    "lat": 0.0,
    "lon": 0.0,
    "agency": "NASA",
    "year": 1969,
    "status": "landed",
    "group": "apollo",
    "note": "One short line",
    "source": "https://..."
  }
]
```

`status`: `landed`, `planned`, `candidate` or `reference` (a point used for checks and the demo,
not a landing site). `group`: `apollo`, `lander` or `south-pole`.

The real list always has `shackleton-floor` and `shackleton-rim` (both `reference`). The terrain
checks in T24 and the demo use them by id.

### `validation.json` (made by T03)

```json
{
  "checked_at": "2026-11-14T00:00:00Z",
  "tolerance_deg": 0.1,
  "max_diff_deg": 0.0,
  "cases": [
    { "lat": 0, "lon": 0, "t": "2027-01-01T00:00:00Z", "body": "sun",
      "ours": { "alt": 0, "az": 0 }, "horizons": { "alt": 0, "az": 0 }, "diff_deg": 0 }
  ]
}
```

`ours` is the Python calculation (Skyfield for a surface point, as in T01's fixtures). The
browser's own maths is checked against the same Horizons numbers by the `horizons.json` fixture
below. In the mock file, `checked_at` is `null` and `cases` is empty.

### `layers/layers.json` + `layers/{sun,earth,psr}.bin`, `layers/north_{sun,earth,psr}.bin` (made by T14 and T43, `data-prep/make_layers.py`)

Map layers near the two poles (spec F14), from the LOLA team's polar illumination maps, release
2016 (Mazarico et al. 2011, Icarus 211, 1066-1081): south `AVGVISIB_65S_240M_201608`,
`..._EARTH` and `LPSR_65S_240M_201608`; north `AVGVISIB_65N_240M_201608`, `..._EARTH` and
`LPSR_65N_240M_201608` (T43: the LOLA team publishes both poles). They illustrate; no number in
the Sun and Earth rows of the readout or the tables comes from them, and they can differ from our
own calculation (see "What the values mean").

```json
{
  "value_scale": 0.004,
  "max_byte": 250,
  "polar": {
    "south": {
      "size": 1267, "pixel_m": 480, "x_min_m": -303960, "y_max_m": 303960, "min_lat": -80,
      "files":    { "sun": "layers/sun.bin", "earth": "layers/earth.bin", "psr": "layers/psr.bin" },
      "products": { "sun": "AVGVISIB_65S_240M_201608", "earth": "AVGVISIB_65S_240M_201608_EARTH", "psr": "LPSR_65S_240M_201608" }
    },
    "north": {
      "size": 1267, "pixel_m": 480, "x_min_m": -303960, "y_max_m": 303960, "min_lat": 80,
      "files":    { "sun": "layers/north_sun.bin", "earth": "layers/north_earth.bin", "psr": "layers/north_psr.bin" },
      "products": { "sun": "AVGVISIB_65N_240M_201608", "earth": "AVGVISIB_65N_240M_201608_EARTH", "psr": "LPSR_65N_240M_201608" }
    }
  },
  "meanings": { "sun": "...", "earth": "...", "psr": "..." },
  "source": "...", "product_page": "https://pgda.gsfc.nasa.gov/products/69", "citation": "..."
}
```

Grids. South: the projection of `dem.bin`, at twice its cell size. North: the same numbers in
`north.bin`'s projection, the mirror image of the south's about the equator (`c = 90 - lat`,
`x = r sin lon`, `y = r cos lon`, longitude 0 up). In both, cell (row 0, col 0) is centred at
(`x_min_m`, `y_max_m`); col = (x - x_min_m) / pixel_m, row = (y_max_m - y) / pixel_m. A 480 m cell
is the mean of two by two 240 m cells of `dem.bin`'s layout, so its centre sits half a 240 m cell
in from the height map's: the grid covers 80 degrees to the pole, minus a 120 m border. A grid
applies poleward of its `min_lat` (section "Which source applies where", below). Code reads the
grids from the file, never hard-codes them.

Each `.bin`: one unsigned byte a cell, `size * size` bytes, row by row from the top row. Value =
byte * `value_scale`, 0..1 (byte 0..250). No missing data: the sources cover 65 degrees to the pole.

What the values mean:
- `sun`: share of hourly steps over 18.6 years in which any part of the Sun's disc is visible.
- `earth`: the same for any part of Earth's disc (our readout treats Earth as a point).
- `psr`: share of the cell that is permanently shadowed over those 18.6 years (not "until 2100").

All three are for a point on the surface (our readout uses a 2 m eye height). About 1.6 MB each,
fetched only when a layer is switched on.

### `layers/smooth.json` + `layers/smooth_sun.bin`, `layers/smooth_earth.bin` (made by T43, `data-prep/make_layers_global.py`)

The Sun and Earth layers away from the poles: the same two shares as the LOLA maps, on a smooth
Moon (a sphere of radius `R`, no terrain), from JPL DE440 through Skyfield in the frame
`MOON_ME_DE440_ME421`, as T01. Hourly over 18.6 years, the length of the LOLA maps' span, so the
two agree in kind at the seam. The LOLA team does not give the dates of its span; 18.6 years is one
turn of the Moon's orbital nodes, so a smooth-Moon share barely depends on where the span starts.

```json
{
  "width": 720, "height": 360, "value_scale": 0.004, "max_byte": 250,
  "start": "2020-01-01T00:00:00Z", "end": "2038-08-08T00:00:00Z", "step_s": 3600,
  "files": { "sun": "layers/smooth_sun.bin", "earth": "layers/smooth_earth.bin" },
  "meanings": { "sun": "...", "earth": "..." },
  "source": "JPL DE440 via Skyfield, on a smooth sphere of radius 1737.4 km (no terrain)"
}
```

A latitude-longitude grid laid out like `globe.bin`: cell (row `j`, column `i`) is centred on
latitude `90 - (j + 0.5) * 180 / height` and longitude `-180 + (i + 0.5) * 360 / width`, 0.5
degrees a cell. Each `.bin`: one unsigned byte a cell, `width * height` bytes, row by row from
row 0; value = byte * `value_scale`, 0..1. 0.26 MB each, fetched only when its layer is on.

What the values mean: `sun`, the share of the hours in which any part of the Sun's disc is above
the horizontal (its centre higher than minus its angular radius at that hour); `earth`, the same
for Earth's disc, seen from the point itself (Earth is close enough for that to matter). At the
surface, no eye height. A smooth Moon has no permanent shadow, so there is no `psr` file: the
never-lit layer is 0 outside the polar grids.

### Which source applies where (T43, SPEC section 6)

`core/layers.ts` decides it for every point, and every number and picture of a layer comes from
there (`layerAt`, section 3). A polar grid applies poleward of its `min_lat` (80 S or 80 N) and
inside its cell centres; elsewhere the whole-Moon source fills in. Where they meet the values jump
(terrain shadow against none): that is correct, and the map draws the seam as a dashed line.

| Layer | Poleward of 80 degrees | Elsewhere | `source.id` |
|---|---|---|---|
| `sun`, `earth` | LOLA polar maps, 480 m, with terrain | Smooth Moon, 0.5 degrees, no terrain shadows | `lola-south`, `lola-north`; `smooth` |
| `psr` | LOLA permanent-shadow maps, 480 m | 0: a smooth Moon has no permanent shadow | `lola-south`, `lola-north`; `smooth` |
| `height` | `dem.bin` (240 m) south, `north.bin` (1200 m) north | `globe.bin` (0.125 degrees, 3.8 km north to south) | `dem-south`, `dem-north`; `globe` |
| `slope` | The same polar grids, `slopeAt` | `globe.bin`, `globeSlopeAt` | the same as `height` |

For height and slope, a polar point that its grid cannot answer (the outermost cells, a `nodata`
cell) takes the whole-Moon value, and says so. The legend names the source at the selected site
in the words of `sourceText()` (`web/src/ui/layers/model.ts`): "LOLA, 480 m cells, with terrain",
"Smooth Moon, no terrain shadows", "LOLA whole-Moon height map, 3.8 km cells".

### Fixtures: `web/src/core/__fixtures__/horizons.json` (made by T03)

The same cases, Horizons values only. A test owned by T03 runs `ephemeris.ts` and `geometry.ts`
on each case and fails above 0.1 degrees, so the badge on the About page is true of the code
the user runs.

```json
[
  { "lat": 0, "lon": 0, "t": "2027-01-01T00:00:00Z", "body": "sun", "alt": 0, "az": 0 }
]
```

### Fixtures: `web/src/core/__fixtures__/altaz.json` (made by T01)

At least 20 cases computed by Skyfield directly for a point on the Moon's surface, not through
our table. Tests in T02 compare against them.

```json
[
  { "lat": -89.5, "lon": 0, "t": "2027-01-01T00:00:00Z",
    "sun": { "alt": 0, "az": 0 }, "earth": { "alt": 0, "az": 0 } }
]
```

### Fixtures: `web/src/core/__fixtures__/features.json` (made by T36, `data-prep/check_features.py`)

The IAU feature each `planned` site in `sites.json` sits on, from the USGS Gazetteer of Planetary
Nomenclature's Moon point file (`MOON_nomenclature_center_pts.kmz`, linked from
https://planetarynames.wr.usgs.gov/GIS_Downloads; LOLA 2011 control network). A test owned by
T36 in `sites.test.ts` checks that every planned site is at most half the feature's diameter,
plus `margin_km`, from the feature's centre, on the `R` sphere.

```json
{
  "source": "USGS Gazetteer of Planetary Nomenclature, MOON_nomenclature_center_pts.kmz",
  "url": "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.kmz",
  "file_date": "2026-11-14",
  "frame": "east longitude (written here as -180..180), planetocentric latitude, LOLA 2011 control network",
  "radius_km": 1737.4,
  "sites": {
    "im-3": { "feature": "Reiner Gamma", "gazetteer_id": 4987, "type": "Albedo Feature",
              "lat": 7.3853, "lon": -58.9583, "diameter_km": 73.441048,
              "page": "https://planetarynames.wr.usgs.gov/Feature/4987" }
  }
}
```

The keys of `sites` are exactly the planned site ids. `lon` is in -180..180 (the file gives 0 to
360 east). `diameter_km` is the gazetteer's "approximate diameter or longest dimension".
`file_date` is the day the gazetteer made the file (it is regenerated nightly). A region target,
or a point published as on a crater's rim, adds `margin_km` and `margin_reason`; a target on no
named feature is
`{ "feature": null, "reason": "..." }`, and the QuickMap contact sheet and a person check it
alone.

## 3. TypeScript: `web/src/core/`

`types.ts` (T00):

```ts
export type Site = { lat: number; lon: number; eye_m?: number };   // eye_m default 2
export type AltAz = { alt: number; az: number };
export type Skyline = { elev: Float32Array; terrain: boolean };    // 360 values, index = azimuth
export type Sample = {
  tMs: number;
  sun: AltAz; earth: AltAz;
  sunAbove: number;    // Sun centre minus skyline at its azimuth, degrees
  earthAbove: number;
  sunFrac: number;     // 0..1, fraction of the Sun's disc above the skyline, by height
  earthUp: boolean;
};
export type Body = 'sun' | 'earth';
export type Flip = { type: 'rise' | 'set'; tMs: number } | null;
export type Summary = {
  litPct: number; longestLit_h: number; longestDark_h: number;
  earthPct: number; longestEarthGap_h: number;
};
export type CuratedSite = { id: string; name: string; lat: number; lon: number; agency: string;
  year: number; status: string; group: string; note: string; source: string };
```

| File | Task | Functions |
|---|---|---|
| `ephemeris.ts` | T00 | `loadEphemeris(): Promise<Ephemeris>` (index + home decade) · `loadEphemerisChunk(eph, i): Promise<ArrayBuffer>` · `indexEphemeris(meta): Ephemeris` and `parseEphemeris(meta, buffer: ArrayBuffer): Ephemeris` (no network; tests use them) · `eph.startMs`, `eph.endMs` (whole table), `eph.homeStartMs`, `eph.homeEndMs`, `eph.meta` · `eph.vectorsAt(tMs): { sun: [x,y,z]; earthKm: [x,y,z] }` (straight-line step between rows; Sun re-normalised) · `eph.missing(fromMs, toMs): number[]` (decades not yet loaded) · `eph.withChunk(i, buffer): Ephemeris` (a new value, one more decade) |
| `dem.ts` | T00 | `loadDem(onProgress?): Promise<Dem>` (`dem.pack` first, else `dem.bin`) · `parseDem(meta, buffer: ArrayBuffer): Dem` (no network; tests use it) · `demFromHeights(meta, values: Int16Array): Dem` · `unpackDemFile(meta, file): Promise<Int16Array \| null>` (`dem.pack`'s bytes to stored values; null when they are not gzip) · `dem.covers(lat, lon): boolean` · `dem.heightAt(lat, lon): number` (bilinear, metres; 0 outside) · `dem.cell(row, col): number` (one stored cell, metres; row 0 at the top as in the file; no data is 0) · `dem.hasData(row, col): boolean` (T41: false on a `nodata` cell or outside the grid) · `dem.meta` |
| `heightPack.ts` | dem.pack | `packHeights(values: Int16Array, width, height): Uint8Array` · `unpackHeights(packed, width, height): Int16Array` · `unpackHeightRows(packed, width, height, out, rowStart, rowEnd)` (rows in order from row 0). The lossless packing of section 2's `dem.pack`, before gzip; the build packs, the loader unpacks |
| `geometry.ts` | T00 first pass, then T02 | `sunAltAz(eph, site, groundM, tMs): AltAz` · `earthAltAz(eph, site, groundM, tMs): AltAz` · `destination(lat, lon, bearingDeg, distM): { lat, lon }` · `sunAltAzAtSite(eph, site): (tMs) => AltAz` (issue #32: `sunAltAz` for one site at many times, the site's axes worked out once; the same numbers bit for bit) |
| `horizon.ts` | T00 flat skyline, then T05 | `skylineAt(dem: Dem | null, site: Site): Skyline` · `skylineElev(s: Skyline, az: number): number` (interpolated) |
| `projection.ts` | T31 | `polarForward(lat, lon, pole = 'south'): { x, y }` and `polarInverse(x, y, pole = 'south'): { lat, lon }` (polar stereographic in metres, seen from above the pole. `'south'`: dem.bin's grid, section 2's formulas, longitude 0 up, 90 E right. `'north'`: longitude 0 down, 180 up, 90 E right; that is north.bin's grid upside down, `y = -r cos lon`, because north.bin's own grid is a mirror image) · `cylForward(lat, lon, lon0 = 0): { x, y }` and `cylInverse(x, y, lon0 = 0): { lat, lon } \| null` (equidistant cylindrical, km, `x = R (lon - lon0) rad`, `y = R lat rad`; longitude wrapped to -180..180; null beyond a pole) · `MapView = { cx, cy, scale, width, height }` (map units at the centre, screen pixels per unit, canvas size in pixels; screen y grows down, map y grows up) · `viewToScreen(view, x, y)` and `screenToView(view, px, py)` |
| `shade.ts` | T31 | `shadePolar(dem, sun: Vec3, maxCells = 1300): PolarShade` (`{ size, stride, frac, cosI, height, heightRange }`: on every `stride`th cell of the height map, the fraction of the Sun's disc above the terrain, 0, 0.5 or 1, the cosine of the Sun's incidence on the ground, and the cell's height; NaN outside coverage) · `shadeGlobal(sun: Vec3, width, height, rowStart = 0, rowEnd = height, out?: Float32Array): Float32Array` (cosine of the Sun's zenith angle at each cell centre of a latitude-longitude grid, row 0 at 90 N; only rows `rowStart` to `rowEnd - 1`, `width` values each; written into `out` and returned when `out` is long enough) · `subPoint(v: Vec3): { lat, lon }` (where a direction from the Moon's centre meets the surface). Illustration for the map only: lit and dark answers come from `windows.ts` |
| `sky.ts` | issue #80 | `Mat3` (three rows; `apply(m, v)` takes a vector from the first frame to the second) · `moonFromIcrf(tMs)` (ICRF to the Moon-fixed frame: the IAU WGCCRE lunar model, Archinal et al. 2011; within 0.02 degrees of DE440's mean-Earth frame) · `earthFromIcrf(tMs)` (ICRF to Earth-fixed: IAU 1976 precession and 1982 sidereal time, UTC for UT1, no nutation) · `moonFromEarthIcrf(earthKm, tMs)` · `moonOrbitIcrf(eph, tMs): { toMoon, pole }` · `alignFrames(fromX, fromZ, toX, toZ)` · `apply`, `applyInverse`, `multiply`, `angleBetween`. Turns the star map only; Sun and Earth angles still come from `geometry.ts` |
| `slope.ts` | T41, T43 | `slopeAt(dem, lat, lon): number \| null` (ground slope in degrees from level; null off the height map, north of its `min_lat`, or where a cell it needs is `nodata`) · `cellSlope(dem, row, col)` and `cellGradient(dem, row, col)` (one stored cell; null on the grid's edge or next to `nodata`) · `slopeBaselineM(dem)` (what it is measured over: `pixel_m`, 240 m on the real map) · `SLOPE_RAMP_MAX_DEG` (30: the Slope layer's ramp ends there). Central differences on the grid, `dz/dx = (z[c+1] - z[c-1]) / (2 pixel_m / k)` and the same along rows, with the projection's scale `k = 1 + (r / 2R)^2` (conformal, so one `k` for both directions); slope = `atan(hypot(dz/dx, dz/dy))`. At a point, the gradient is interpolated bilinearly from the four cells around it. A baseline slope: a boulder or a 10 m crater does not show. T43, the whole Moon on `globe.bin`: `globeSlopeAt(globe, lat, lon): number \| null` · `globeCellGradient(globe, row, col)` · `globeSlopeBaselineM(globe)` (the row spacing, `pi R / height`: 3.8 km). Central differences on the latitude-longitude grid, `dz/dy = (z[j-1] - z[j+1]) / (2 R dphi)` and `dz/dx = (z[i+s] - z[i-s]) / (2 s R cos(phi) dlambda)`, stepping `s = max(1, floor(1 / cos phi))` columns so the east-west step is never longer than the north-south one: the baseline named is the longer of the two. Null on the first and last row; bilinear between cells at a point, as `slopeAt` |
| `globe.ts` | T43 | The reader for `globe.bin` and `north.bin` (section 2), moved here from `web/src/scene/` (issue #66, #112), which re-exports it: `parseGlobe(meta, buffer): GlobeHeights` (`meta`, `range` (lowest and highest cell, metres), `cell(row, col)` (columns wrap, rows stop at the poles), `heightAt(lat, lon)` (the cell holding the point: the pictures use it), `heightBilinear(lat, lon)` (between the four cell centres round the point: numbers use it), `rowSpacingM` (`pi R / height`)) · `parseNorth(meta, buffer): Dem` (`north.bin` as a height map of mirrored latitudes: ask it for `(-lat, lon)`). No network: `sharedGlobe()` and `sharedNorth()` in `web/src/scene/globeHeights.ts` fetch the files. T37 uses the same reader |
| `layers.ts` | T14, T43 | `LAYER_KEYS` (`sun`, `earth`, `psr`, `height`, `slope`) and `LayerKey` · `readLayersMeta(json): LayersMeta` and `readSmoothMeta(json): SmoothMeta` (throw on a bad file) · `parseLayer(meta, pole, name, buffer): Layer` (`valueAt(lat, lon)`: bilinear, null outside the grid or equatorward of its `min_lat`; `covers`, `cell`) · `parseSmooth(meta, name, buffer): SmoothLayer` (`valueAt`: bilinear, longitude wraps) · `gridPoint(grid, lat, lon)`, `gridLatLon(grid, row, col)` (the grid's `pole`, south by default) · **`layerAt(key, lat, lon, inputs): LayerPoint \| null`**, the one function for a layer's value and source anywhere on the Moon (section 2, "Which source applies where"): `{ value, source: { id, cellM } }`, value 0..1 for `sun`, `earth`, `psr`, metres for `height`, degrees for `slope`; `cellM` is the size of the cells the value comes from, for slope the distance it is measured over (null for the smooth never-lit layer). Null only where the file the point needs is not in `inputs` (`{ layers, polar, smooth, dem, north, globe }`, each as far as loaded) · `layerValueAt(key, lat, lon, inputs): number` (the same value, NaN for null, nothing allocated: the layer pictures call it for every pixel) · `seamLats(key, inputs)` (the latitudes where that layer's sources meet) · `heightRange(inputs)` (lowest and highest height of the loaded height sources, for one colour ramp everywhere). No network: `web/src/ui/layers/` fetches the files |
| `panel.ts` | T15 | `panelPower(sample): { flat, upright }` (each 0..1 of full power: flat = `sunFrac * sin(alt)`, none below 0 degrees; upright and turned to the Sun = `sunFrac * cos(alt)`) · `panelAverage(samples): { flat, upright }` (mean, dark hours count as 0) |
| `pads.ts` | T34 | `PADS` (Earth launch pads in use: the brief's seven first, then twelve more for the launch-site picker; `{ id, name, pad, country, lat, lon }`, each from a cited source) · `BRIEF_PAD_COUNT` · `padById(id): Pad` (Kennedy LC-39A for an unknown id) · `DEFAULT_PAD_ID` |
| `mission.ts` | T34 | `planMission(input): MissionPlan` (from a pad to touchdown at `input.site` at `input.touchdownMs` exactly: `{ ok: true, launchMs, touchdownMs, steps, totals, orbit, runsOutMs }`, or `{ ok: false, error }` with `'bad-input' \| 'coast-out-of-range' \| 'thrust-too-low'`) · `missionAt(plan, tMs): MissionState` (step, altitude, speed, propellant left, positions in the transfer plane and the lunar-orbit plane, the Moon-fixed point under the craft, distance to the site in the descent; what the animation draws) · `approachSeconds(plan)`, `hyperbolaAt`, `hyperbolaTimeToRadius`, `MOON_SOI_KM` (the arrival hyperbola round the Moon, from its sphere of influence to LOI; `missionAt` gives `approach: true` and a `moonPlane` point there, with altitude and speed above the Moon) · `moonFixedInPlane(plan, tMs, lat, lon, altKm?)` (a Moon-fixed point in `missionAt`'s lunar-orbit frame, `[x, y]` as `moonPlane` and `z` along the orbit's normal; the inverse of the ground point; the simulation page places the landing site and turns the Moon with it) · `earthMoonKmAt(eph, tMs)` · the pieces, each tested: `transferFor`, `captureDv`, `descentOrbitDv`, `simulateDescent` (T34's gravity turn, kept as a checked case), `simulateGuidedDescent` (the descent planDescent flies: braking at full thrust from 15 km to the `HIGH_GATE_KM` 2 km high gate, then throttled straight down; issue #181), `planDescent` (always from 15 km; no plan when the thrust can't lift the lander in the Moon's gravity), `propellantFor`, `dvFor`, `burnSeconds` · `EXAMPLE_LANDER`, `APOLLO_11_TIMES`, `SEQUENCE`, `ASCENT_LOSSES_KMS` (1.75 km/s of gravity and drag losses added to the launch Δv; issue #181). A planning model, not a flight-dynamics solution: patched conics, instant burns but the descent, a 100 km circular polar lunar orbit, a guided powered descent in Apollo's phases; times run back from touchdown with Apollo 11's phase lengths |
| `report.ts` | T35 | `buildReport(plan, context): Report` (the mission report as plain data: every phase with T+ and the point under the craft, the key events, the coast every 12 h, the totals and orbits, the powered descent every 30 s, the landing site's numbers and warnings as the mission card shows them, the first 30 days' periods, the model's limits and sources) · `reportJson(report)` (the JSON download, schema below) · `reportCsv(report)` (the flight schedule, one row per phase) · `reportFileName(report, 'json' | 'csv')` (`darksight-mission-<site id or coordinates>-<touchdown like 2026-11-21T1604Z>.<ext>`) · `descentTrack(plan, stepS)`, `missionEvents(plan)`, `coastTrack(plan, stepH)`, `periods(samples, body)` (up and down runs with `summary()`'s rules) · `PHASE_NAMES`, `EVENT_NAMES`, `MODEL_LIMITS`, `REPORT_SOURCES`, `REPORT_SCHEMA`. Every number from `missionAt` and the plan; the landing site's numbers come in from `ui/mission/conditions.ts` |
| `windows.ts` | T00 first pass, then T06 | `series(eph, site, groundM, skyline, startMs, endMs, stepMs): Sample[]` · `nextFlip(eph, site, groundM, skyline, tMs, body: Body, maxDays = 60): Flip` · `summary(samples: Sample[]): Summary` · `countdownText(body: Body, upNow: boolean, flip: Flip, tMs: number, neverLit = false, checking = false): string` · `durationText(ms): string` (`3 d 4 h`, or `5 h 20 min` under one day; T42) |
| `datesearch.ts` | T42 | `firstWindow(eph, site, groundM, skyline, startMs, endMs, need: Need, minHours): DateSearch` (`Need` is `'both' \| 'sun' \| 'earth'`; the first window at or after `startMs`, starting before `endMs`, in which the Sun (any of its disc showing), Earth, or both at once stay up for at least `minHours`. `{ status: 'found', startMs, endMs }`, `endMs` null when it lasts more than `END_LOOK_DAYS` (60) days; `{ status: 'none', checkedToMs }` (the search's end, or the end of the table first); `{ status: 'no-rows', atMs }` where a decade is not in memory or before 1900, never read as dark. Hourly samples from `series()`, each edge halved to under a minute as `nextFlip()` does; a start after `startMs` is rounded up to the whole minute) · `monthsLater(tMs, months)` (calendar months in UTC; a day the month lacks becomes its last day) · `END_LOOK_DAYS` |

**First pass** means T00 writes the function straight from the formulas below, with a few sanity
tests, so the site shows live numbers from the first hour. The follow-up task adds the real
tests and fixes what they find. These are task dependencies, not person assignments. Keep the
documented names and signatures unless a coordinated contract change updates their callers.

`countdownText` wording (F4). Durations read `3 d 4 h`, or `5 h 20 min` under one day.

| Case | Text |
|---|---|
| Sun up, a set found | `Sunset in 3 d 4 h` |
| Sun down, a rise found | `Sunrise in 3 d 4 h` |
| Sun up, no set found | `No sunset in the next 60 days` |
| Sun down, no rise found | `No sunrise in the next 60 days` |
| Sun down, no rise found, `checking` true (T32) | `No sunrise in the next 60 days · checking to 2100…` |
| Sun down, `neverLit` true | `Permanently shadowed (until 2100)` |
| Earth up or down, a flip found | `Earthset in 3 d 4 h` or `Earthrise in 3 d 4 h` |
| Earth up, no flip found | `Earth always visible` |
| Earth down, no flip found | `Earth never visible` |

`neverLit` wins over `checking` when both are true. Callers pass `neverLitFor(sc)` and
`neverLitPendingFor(sc)` from `state.ts` (section 4); no module works either out itself.

### Geometry (T02)

```
n     = (cos lat cos lon, cos lat sin lon, sin lat)          site "up"
east  = (-sin lon, cos lon, 0)
north = (-sin lat cos lon, -sin lat sin lon, cos lat)
p     = (R + ground + eye) * n                               site position, km

Sun:   d = sun unit vector
Earth: d = normalise(earthKm - p)

alt = asin(d . n)
az  = atan2(d . east, d . north), wrapped to 0..360
```

### Skyline (T05)

For each azimuth 0..359, walk outward along the great circle from the site, from one grid cell
to 150 km. Step = the larger of half a cell and 1 % of the distance so far.

```
gamma = dist / R                          angle at the Moon's centre
r0    = R + ground(site) + eye
r1    = R + ground(point)
elev  = atan2(r1 cos(gamma) - r0, r1 sin(gamma))
skyline[az] = largest elev along that azimuth
```

`terrain = false` and all zeros when `dem` is null or the site is north of 85 S.

### Visibility (T06)

```
SUN_RADIUS = 0.267 degrees
sunAbove   = sun.alt - skylineElev(skyline, sun.az)
sunFrac    = clamp((sunAbove + SUN_RADIUS) / (2 * SUN_RADIUS), 0, 1)
lit        = sunFrac > 0
earthAbove = earth.alt - skylineElev(skyline, earth.az)
earthUp    = earthAbove > 0
```

`nextFlip` walks forward hourly, then halves the last interval until it is under one minute.

## 4. State: `web/src/state.ts` (created by T00)

UI modules read state and call actions. They never call each other.

```ts
export type Scenario = { id: string; label: string; color: string; site: Site; tMs: number };
// color is the name of a theme variable, for example '--scn-a'. Never a colour code.
export type Range = '30d' | '90d' | '365d';
export type AppState = {
  live: Scenario; pinned: Scenario[]; ghost: Scenario | null;
  selectedId: string; range: Range; mode: '2d' | '3d';
  windowStartMs: number;                 // left edge of the timeline for the live scenario
  eph: Ephemeris | null; dem: Dem | null; sites: CuratedSite[];
  landing: { site: Site; tMs: number } | null;   // T34: a copy of a scenario's site and time
  padId: string; lander: Lander;                 // T34: core/pads.ts id, core/mission.ts Lander
  battery: Battery;    // T40: core/battery.ts; in the address as bat=capacityWh,panelW,useW when changed
};

getState(): AppState
subscribe(fn: (s: AppState) => void): () => void
setLiveSite(site: Site) · setLiveTime(tMs: number) · pin() · unpin(id) · select(id)
setRange(r: Range) · shiftWindow(dir: -1 | 1) · setGhost(s: Scenario | null) · setMode(m)
setLanding(sc: Scenario | null) · setPad(id) · setLander(l)            // T34
setBattery(b: Battery)                                                 // T40
selected(): Scenario                     // the live or pinned scenario named by selectedId

// computed once and cached here, so modules don't repeat the work
skylineFor(sc: Scenario): Skyline
samplesFor(sc: Scenario, range: Range): Sample[]     // hourly from sc.tMs: strips, sky paths
timelineFor(sc: Scenario, range: Range): Sample[]    // hourly from the window start: timeline
summaryFor(sc: Scenario): Summary                     // over 30 days from sc.tMs
flipFor(sc: Scenario, body: Body): Flip               // next rise or set after sc.tMs
neverLitFor(sc: Scenario): boolean                    // no sunlight there from sc.tMs to the end of 2100
neverLitPendingFor(sc: Scenario): boolean             // T32: neverLitFor still waits for decades to 2100, or its scan
tableGap(tMs: number): 'none' | 'outside' | 'failed'  // T33: why a time may have no row
failedDecades(): number[]                             // T33: start of each failed decade, for the status line
isLanding(sc) · landingScenario(): Scenario | null    // T34: the landing point as a scenario ('land')
missionFor(): { status: 'none' | 'loading' | 'outside' } | { status: 'failed'; decadeMs: number }
  | { status: 'ready'; plan: MissionPlan }            // 'failed' (T33): a decade it needs did not download
dateSearchFor(sc, need, minHours, months): DateSearch | { status: 'loading' } | { status: 'failed'; decadeMs }
                                                      // T42: core's firstWindow from sc's site and time
```

**Selected and live.** `selectedId` is the live scenario's id or a pinned one's. The readout,
timeline, sky panorama and the 3D scene's Sun all show the selected scenario. Pinned scenarios
never change. `setLiveSite` and `setLiveTime` change the live scenario and select it. So an
edit made anywhere (map click, coordinate boxes, time box, timeline drag, a nudge step) lands
on live, and the view follows.

**First open (F19, T25).** When the page address names no scenario (no live one, none pinned)
and the site list arrives, state builds an example: live at the crater rim and the crater floor
pinned as A, both at the current hour, live selected. Don't also pin the rim: compare shows a
Live column, so the page would open on two identical columns. The two sites are found by id
(section 2: `shackleton-rim` and `shackleton-floor`, or `mock-rim` and `mock-floor`). An address
that names any scenario opens exactly what it says. An edit to live or a pin made before the
list arrives cancels the example, so an early click is never overwritten. The example goes into
the page address like any other change. So a module may find a scenario pinned before the user
has touched anything.

**Decades.** `eph` is null until the table has loaded, and null again while a decade that the
live scenario (its time plus 60 days, and its timeline window) or a pinned scenario (its time
plus 60 days or the range, whichever is longer) needs is still downloading. So a module that
shows "Loading" while `eph` is null needs nothing more.

**A decade that fails to download (T33, issue #32 row 4)** (a dropped connection, a phone in a
tunnel) is asked for again once a wait is over: 10 s (`RETRY_MS`) after the first failure,
doubling after each failure in a row to at most 60 s (`RETRY_MAX_MS`), so a dead connection
isn't asked over and over. A timer wakes the page when the wait is over, so a decade a scenario
still needs is tried again with nobody touching the page; one no longer needed waits until it
is. The browser's `online` event makes every failed decade due at once. While a retry
downloads, the decade counts as downloading again: `eph` is null and modules show "Loading".
Between tries its hours have no rows, as outside the table. `tableGap(tMs)` tells the two
apart: `'outside'` before 1900 or after 2100, `'failed'` in a decade that failed, `'none'`
otherwise. A module with no row for a time says so with `noRowText(tableGap(tMs), tMs)` from
`ui/tableGap.ts`: `The Sun and Earth table for the 2050s did not download. Trying again…`, or
`This time is outside the Sun and Earth table`. The status line lists `failedDecades()`.
`missionFor` answers `{ status: 'failed', decadeMs }` (the start of that decade) when a decade
from the arrival to touchdown failed, and `'outside'` only before 1900 or after 2100; the mission
and launch simulation pages say `noRowText('failed', decadeMs)`, and the mission page's status
line lists `failedDecades()` too.

**Never lit.** `neverLitFor` is true when no part of the Sun's disc clears the skyline at any
hour from the scenario's time to the end of the table (2100-12-31), whatever time is chosen. It
is false at once, with no download, when the Sun is up or rises within 60 days. Otherwise it
needs every decade from the scenario's time to 2100: they download in the background without
holding the page on "Loading", and it reads false ("No sunrise in the next 60 days") until they
are in. It is also false within 60 days of the end of the table, where a few dark hours prove
nothing. The scan runs back from 2100 and is remembered per site, so a later call for an
earlier time only scans the new hours. A scan of more than `LIT_SCAN_SLICE_HOURS` (20,000 hours)
does that many at once and the rest in slices of that size between frames, so picking a dark
spot doesn't freeze the page (issue #32, row 1): a new spot near the pole scans about 650,000
hours. It reads false while the scan runs, as while decades download, and `state.ts` notifies
the modules when it is done.

**Still checking (T32, issue #32 row 3).** While `neverLitFor` still waits for those decades,
or for its scan to finish once they are in (issue #32 row 1), `neverLitPendingFor` reads true, so the countdown says `No sunrise in the next 60 days · checking
to 2100…` and then, once they are in, `Permanently shadowed (until 2100)` (or plain "No sunrise"
if the Sun does come back before 2100). A never-lit site never shows plain "No sunrise" in
between. `neverLitPendingFor` is false once `neverLitFor` answers, false while one of the decades waits to
be tried again after a failed download (the text is then plain `No sunrise in the next 60 days`;
true again while the retry downloads), and false wherever `neverLitFor` is false at once,
including within 60 days of the end of the table.

**Timeline window.** `timelineFor` starts at the scenario's own time for a pinned scenario and
at `windowStartMs` for live. `setLiveTime` leaves the window alone while the new time is inside
it, and restarts it at the new time otherwise. `shiftWindow` moves it by half the range. This
is what lets a drag move the marker without the chart sliding under the cursor.

**Date search (T42).** `dateSearchFor` runs `firstWindow` from the scenario's site and time to
`monthsLater(sc.tMs, months)`. It asks for every decade from the scenario's time to that end plus
the look for the window's end (the longer of `minHours` and 60 days), without holding the page on
"Loading": `eph` stays as it is, and the answer is `'loading'` until they are in. `'failed'` when
the decade holding the scenario's time did not download; a failed decade further on stops the
search there (`'no-rows'`). The last answer is kept, so the scenario panel asks on every redraw.

**While data is loading** (`eph` is null), the accessors return empty arrays, `null` flips, a
flat skyline and zeros. Modules show "Loading" and must not crash.

## 5. Page slots: `web/index.html` (created by T00)

| Element id | Module folder | Task |
|---|---|---|
| `#scene` | `web/src/scene/` | T12 |
| `#scenarios` | `web/src/ui/scenarios/` | T08 |
| `#playback` | `web/src/ui/playback/` | T40 (shares the place of `#scenarios`, see below) |
| `#sidetabs` | `web/src/ui/sidetabs/` | T40 |
| `#readout` | `web/src/ui/readout/` | T08 |
| `#compare` | `web/src/ui/compare/` | T09 |
| `#timeline` | `web/src/ui/timeline/` | T10 |
| `#sky` | `web/src/ui/sky/` | T11 |
| `#nudge` | `web/src/ui/nudge/` | T13 (made by `#scene`, see below) |
| `#about` | `web/src/ui/about/` | T16 |
| `#panel` | `web/src/ui/panel/` | T15 |
| `#mission` | `web/src/ui/mission/` | T34 (on its own page, `mission.html`, see below) |

Each folder has `index.ts` exporting `mount(el)`, and its own CSS file. `main.ts` mounts each
one, from the list in `site.ts`, after "Start exploring" (`web/src/ui/intro/`). T00 wired the
first eight with placeholders; T15 added `#panel`. A task that adds a slot includes `site.ts`,
`index.html` and this contract in its scope, and coordinates with active layout work.

The main page (`web/src/ui/intro/`) is not a slot. Under its first screen it scrolls to About,
Meet the team, Privacy, Licence and a footer (issue #117). Their words and the team list are in
`intro/landing.ts`; the team photos are `web/public/team/*.jpg`. Links there to a section are
buttons that scroll, never `#id` links: the page address hash holds the state (section 4).

`#scenarios` and `#playback` (T40) sit in one place, `#sidecard`, with `#sidetabs` over them: two tabs, Scenarios and Timeline, that show one card and hide the other. The playback keeps playing while Scenarios is shown. It moves the live time through `setLiveTime`, and pauses when anything else moves the live scenario.

`#mission` (T34) is not on the site's page: it is the card of the page `web/mission.html`
(`web/src/missionPage/`), which loads the same data files and mounts `ui/mission`. "Land here" on a
scenario card sets its landing point; the page address keeps it as `land=`, with `pad=` and
`lander=` when they differ from the defaults. The Scenarios panel then shows "Open mission"
beside "Copy share link" (the two wrap to the next line together), which opens `mission.html` in a new tab (the current tab if a pop-up blocker stops it)
with the same page address; its "Back to landing sites" returns to the site's tab, or opens
`index.html` with the address it has. "Proceed" on the card opens the launch-site picker
(a pop-up with a satellite globe of Earth and the pads, `web/src/ui/launch/`); confirming a pad
opens the second page, `web/simulation.html` (`web/src/simulation/`), in a new tab (the current
tab if a pop-up blocker stops it), with the same page address, so it plans the same mission through `missionFor()`. That page draws the mission in 3D
from `missionAt` only and links back to the mission page with the address it has. "Generate full
launch schedule" on the card opens the fourth page, `web/report.html` (`web/src/reportPage/`,
`ui/report`), the same way: the mission report (T35), built from the same `missionFor()` plan, with
print (or save as PDF) and JSON and CSV downloads made in the browser. Only `#report` prints. The
card and the report take their table cells, landing-site numbers, warnings and "no plan" messages
from `ui/mission/cells.ts` and `ui/mission/conditions.ts`, so the two show the same numbers. Vite
builds all four pages (`vite.config.ts`, `build.rolldownOptions.input`).

**The report's JSON (`reportJson`, schema `darksight-mission-report/1`).** Units are in the key
names (`_ms` metres a second, `_s` seconds, `_km`, `_kg`, `_deg`, `_pct`); times are ISO 8601 with
`Z` (to the millisecond; `met_s`, `met_start_s` and `duration_s` carry the exact seconds); numbers
are not rounded; a value the model doesn't give is `null`, never 0. Top level: `schema`,
`generated_utc`, `data` (`ephemeris`, `terrain`: the files' source lines; `mock`), `share_link`,
`site` (`id` or null, `name`, `lat_deg`, `lon_deg`), `pad` (`id`, `name`, `pad`, `country`,
`lat_deg`, `lon_deg`, `checked`), `lander` (`mass_after_tli_kg`, `dry_mass_kg`, `isp_s`,
`thrust_n`, `example`), `phase_times_s` (`ascent`, `parking_orbit`, `translunar_coast`,
`lunar_orbit`, `apollo_11`), `launch_utc`, `touchdown_utc`, `duration_s`, `touchdown_reached`,
`phases[]` (`n`, `id`, `name`, `by`, `start_utc`, `end_utc`, `met_start_s`, `duration_s`,
`dv_ms`, `burn_s`, `propellant_kg`, `mass_after_kg`, `alt_km`, `body`, `lat_deg`, `lon_deg`),
`events[]` (`id`, `name`, `utc`, `met_s`, `near`, `alt_km`, `speed_ms`, `propellant_left_kg`,
`to_touchdown_s`), `coast[]` (the same point keys), `totals` (`launch_vehicle_dv_ms`,
`lander_dv_ms`, `propellant_loaded_kg`, `propellant_used_kg`, `propellant_left_kg`, `margin_pct`,
`mass_at_touchdown_kg`), `orbit`, `descent` (`start_utc`, `duration_s`, `dv_ms`, `propellant_kg`,
`samples[]`: `t_s`, `utc`, `alt_km`, `speed_ms`, `range_to_go_km`, `propellant_left_kg`),
`site_at_touchdown` (or null: `sun` and `earth` with `alt_deg`, `az_deg`, `above_skyline_deg`,
the Sun's `disc_visible_pct` and `up`, Earth's `visible`; `next_sun_flip`, `next_earth_flip`;
`sun_text`, `earth_text`; `summary_30d`; `terrain_skyline`), `surface_periods[]` (`body`, `up`,
`start_utc`, `end_utc`, `duration_s`), `warnings[]` (`code`, `level`, `text`), `model[]`,
`sources[]` (`name`, `url`). The CSV has the header row
`n,phase_id,phase,by,start_utc,end_utc,met_start_s,duration_s,dv_ms,burn_s,propellant_kg,mass_after_kg,alt_km,lat_deg,lon_deg`,
an empty cell for null, ASCII only.

`#about` is a thin bar across the top: the product name, the Horizons badge and an About button
that opens the About panel. On desktop `#scenarios` sits beside `#scene` with `#panel` under it,
and `#readout` sits under `#scene`; on a phone `#panel` comes after `#readout`.

The flat map (`web/src/map/`, T31) is not a slot either: the scene mounts it in its viewport, over
the 3D canvas, and shows or hides it by `mode`; the map doesn't hide itself. A change of `mode`
cross-fades the two over about 0.8 s, the 3D camera easing between straight above the site
(turned and zoomed like the map, from the map's `viewOf(el)`) and its orbit view (T29, spec F16).
Neither view takes a click while they fade. With `prefers-reduced-motion` the view jumps.

`#nudge` (issue #58) is not in `index.html`. The scene creates it inside its map viewport (the
`position: relative` box that holds the map canvas), before `main.ts` reaches it, so the nudge
panel is ordinary HTML floating over the map, never drawn in the canvas. The nudge places itself
in one of the viewport's four corners (`data-corner="tl" | "tr" | "bl" | "br"`, bottom left to
start); one button moves it on, top left, top right, bottom left, bottom right (issue #126). Any map control the scene puts inside the viewport marks its corner with
`data-map-corner="tl"` (and so on); the nudge then skips that corner for the next free one,
clockwise. The scene's toolbar sits above the viewport and claims no corner. The map-layer
controls float in the viewport's top right corner (`.scene-layers`, `data-map-corner="tr"`), as
icon switches with a fold button for transparency and notes; the nudge panel sits above them
(`z-index`) so its buttons stay reachable where the two meet on a narrow map. This replaces the
"under its map caption, outside the viewport" placement in the next paragraph.

The map-layer controls (T14, `web/src/ui/layers/`) are not in `index.html` either. The scene
creates `<section class="scene-layers">` under its map caption, outside the viewport, so nothing
floats over the map, and calls `mount(el)` on it. The controls show in 2D mode only. Below the
icon switches, folded or not, a legend names, for each layer that is on, its value and its source
at the selected site (T43).
The layers are drawn by the 2D map (`web/src/map/`) on all three of its views, the south polar,
north polar and whole-Moon maps (T43, SPEC section 6): in its draw step, after the terrain and
before the grid and pins, it calls `drawLayers(ctx, { kind, view, reachDeg, unitPx })` (`kind`
`'south' | 'north' | 'global'`, `view` its `MapView` from `core/projection.ts`, `reachDeg` how far
from the pole a polar view reaches, `unitPx` the width of `--space-1` in the map's drawing units (CSS pixels), for the
seam's line), and it redraws whenever `onLayersChange()` fires (data arriving, a switch, an
opacity change, each frame of a fade). Both come from `web/src/ui/layers/index.ts`, which also
holds the one store of layer settings (`layerStore`). Each view's picture of a layer is built in
the browser, the first time that view shows the layer, by asking `layerValueAt` (section 3) at
every pixel, a slice of rows at a time between frames so the page never freezes: on a polar view the polar grid's 480 m cells within its circle (80 degrees) and a
ring out to `reachDeg` (fading out as the map's own ring does); on the whole-Moon view a
latitude-longitude grid (0.25 degrees for Sun, Earth and never lit, `globe.bin`'s 0.125 degrees
for height and slope). A dashed line marks the seam where a layer's sources meet. Height uses one
colour ramp everywhere (`heightRange`); slope is coloured `--dark` (level) to `--bad`
(`SLOPE_RAMP_MAX_DEG` and steeper).

## 6. Look: `web/src/ui/theme.css` (T00 creates, T19 designs)

Modules use these names and never write a colour code, font or pixel size of their own. T19
changes the values; the names stay.

| Variable | For |
|---|---|
| `--bg`, `--panel`, `--panel-2`, `--border` | Page, cards, raised cards, lines |
| `--text`, `--muted` | Main text, secondary text |
| `--accent` | Primary button, selection |
| `--ok`, `--warn`, `--bad` | Best value in a row, caution, error message |
| `--scn-a`, `--scn-b`, `--scn-c`, `--scn-ghost` | Scenario colours (fixed: `#E69F00`, `#0072B2`, `#009E73`, grey) |
| `--sun`, `--earth` | Sun and Earth in charts (fixed: `#F0E442`, `#56B4E9`) |
| `--lit`, `--dark` | Filled and empty parts of the strips |
| `--terrain-lo`, `--terrain-hi` | The two ends of the height colour ramp in the 3D scene |
| `--star-hot`, `--star`, `--star-cool` | Star colours behind the 3D views, by B-V: blue-white, Sun-like, orange (issue #80) |
| `--space-1` … `--space-5` | Gaps: 4, 8, 12, 16, 24 px |
| `--radius` | Corner rounding |
| `--font`, `--font-num` | Text; fixed-width digits for numbers |
| `--fs-sm`, `--fs-md`, `--fs-lg`, `--fs-xl` | Type sizes |

Shared classes: `.card`, `.btn`, `.btn-primary`, `.field`, `.table`, `.badge`, `.muted`.

**On paper (T35).** Under `@media print` the same names get light values (white page, dark text;
the scenario, Sun and Earth colours stay fixed), so a printed page doesn't waste ink and keeps its
contrast when the browser drops background colours. `:root.print-colours` holds the same values,
for a picture drawn for paper while the screen is still dark (the report's descent chart);
`ui/printColours.test.ts` keeps the two blocks the same.

In the strips, a scenario keeps its own colour for both bars; the Sun bar is solid and the Earth
bar is the same colour at half strength. `--sun` and `--earth` are for single-scenario charts
(timeline, sky panorama).

Charts: every Plotly chart spreads `plotLayout()` from `web/src/ui/plotTheme.ts` into its layout.
`web/src/ui/layout.css` places the slots of section 5; modules style only their own insides.

**Colours in JavaScript.** Plotly and three.js can't read `var(--sun)`; they need the real
value. `plotTheme.ts` also exports `themeColor(name: string): string`, which returns the current
value of a theme variable: `themeColor('--sun')`, `themeColor(sc.color)`. In CSS and inline
styles, write `var(--sun)` or `var(${sc.color})`.

**The one pixel value a module may write** is the phone breakpoint:
`@media (max-width: 800px)`. Everything else comes from the variables.

**CSS order.** A module's task writes its first CSS using the shared classes. T23 polishes it
after that task merges. Anyone can take either task; coordinate further code and CSS changes
with active work on the same files.
