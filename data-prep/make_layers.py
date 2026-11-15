"""T14: map layers from the LOLA team's south-polar illumination maps, on a 480 m grid of our own.

Sources: LRO LOLA polar illumination products, release 2016 (E. Mazarico, NASA GSFC), described in
Mazarico et al. (2011), Illumination conditions of the lunar polar regions using LOLA topography,
Icarus 211, 1066-1081. Product page https://pgda.gsfc.nasa.gov/products/69, files from the PDS
Geosciences Node (LOLA "EXTRAS", which the README says are not supported by the PDS or the LOLA
Science Team):
https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/extras/illumination/release_2016/img/

    AVGVISIB_65S_240M_201608        Sun:   share of hourly steps over 18.6 years with any part
                                    of the Sun's disc visible, 0..1
    AVGVISIB_65S_240M_201608_EARTH  Earth: the same for any part of Earth's disc
    LPSR_65S_240M_201608            permanently shadowed (1) or not (0)

Run from anywhere:
    python data-prep/make_layers.py              download the rows needed, resample, write, check
    python data-prep/make_layers.py --check-only read the written files back and check them

Source layout, from the labels (each is checked; the script stops if a label says otherwise):
- int16, little-endian, 6420 x 6420, detached label, 12840-byte records, image at byte 0.
- Polar stereographic on a 1737.4 km sphere, true scale at the pole, 240 m per cell,
  LINE/SAMPLE_PROJECTION_OFFSET 3209.5 = (6420 - 1) / 2, pixel-registered.
- Sun and Earth: value = DN * 0.00004. Permanent shadow: value = DN * 0.000025 + 0.5, DN = +-20000.

Orientation. The PDS labels say CENTER_LONGITUDE = 180 while the same files' labels on the LOLA
team's own mirror (imbrium.mit.edu) say 0. The data follow the layout of LDEM_75S_240M that
make_dem.py uses (longitude 0 up, 90 E right): with 0-based column i and row j,
    X = (i - 3209.5) * 240,  Y = (3209.5 - j) * 240.
check_orientation() re-tests that from named craters on every run and stops if it fails.

Our grids. Our 240 m height-map grid (contract section 2) puts its cell centres half a LOLA cell off
LOLA's: our column c sits at LOLA column 1942.5 + c, our row r at LOLA row 1942.5 + r. Bilinear
sampling there is the mean of a 2 x 2 block of LOLA cells. The layers are then averaged 2 x 2 again
onto a 480 m grid of 1267 x 1267 cells (centres at our 240 m cells 2k + 0.5, so x_min = -303960 m),
stored one byte per cell, value = byte * 0.004 (0..250). For the permanent-shadow layer the value is
the share of the cell that is permanently shadowed.

Only LOLA rows 1942..4476 are downloaded (HTTP range request, about 32.6 MB of each 82.4 MB file),
into data-prep/raw/ (git-ignored). Nothing is written outside web/public/data/layers/.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import requests

from make_dem import GAZETTEER, R_M, num, read_label

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
DATA = HERE.parent / "web" / "public" / "data"
OUT = DATA / "layers"

BASE_URL = ("https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/"
            "extras/illumination/release_2016/img/")
PRODUCT_PAGE = "https://pgda.gsfc.nasa.gov/products/69"
CITATION = ("Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T., Torrence, M. H. (2011), "
            "Illumination conditions of the lunar polar regions using LOLA topography, "
            "Icarus 211, 1066-1081, doi:10.1016/j.icarus.2010.10.030")

# Each layer: product id, expected scaling and offset, what the value means.
LAYERS = {
    "sun": ("AVGVISIB_65S_240M_201608", 0.00004, 0.0,
            "share of hourly steps over 18.6 years with any part of the Sun's disc visible"),
    "earth": ("AVGVISIB_65S_240M_201608_EARTH", 0.00004, 0.0,
              "share of hourly steps over 18.6 years with any part of Earth's disc visible"),
    "psr": ("LPSR_65S_240M_201608", 0.000025, 0.5,
            "share of the cell that is permanently shadowed"),
}

N_SRC = 6420
OFF_SRC = 3209.5
RECORD_BYTES = N_SRC * 2

# Our 240 m height-map grid (contract section 2), read from dem.json and checked against these.
DEM_SIZE, DEM_PIXEL, DEM_X_MIN, DEM_Y_MAX = 2534, 240, -304080, 304080
FIRST = int(DEM_X_MIN / DEM_PIXEL + OFF_SRC - 0.5)          # 1942: first LOLA row/column needed
COUNT = DEM_SIZE + 1                                          # 2535 rows/columns: 1942..4476

# The 480 m layer grid.
SIZE = DEM_SIZE // 2                                          # 1267
PIXEL_M = 2 * DEM_PIXEL                                       # 480
X_MIN_M = DEM_X_MIN + DEM_PIXEL // 2                          # -303960
Y_MAX_M = DEM_Y_MAX - DEM_PIXEL // 2                          # 303960
VALUE_SCALE = 0.004
MAX_BYTE = 250

# Reference points for the checks. Crater centres: IAU Gazetteer (make_dem.GAZETTEER). Sunlit
# points: Glaser et al. (2018) Table 2 (Shackleton S0, Connecting Ridge C1) and the Malapert point
# from sites.json (#82), where the 60 m map reads 79.6 %.
FLOORS = [(name, lat, lon) for name, _id, lat, lon, _d in GAZETTEER if name != "de Gerlache"]
SUNLIT = [("Shackleton rim S0", -89.6866, -162.81), ("Connecting ridge C1", -89.4398, -137.17),
          ("Malapert massif", -86.0412, 3.16)]
CROSS = [("shackleton-ridge-120e", -88.8089, 123.76, 0.860), ("de-gerlache-rim", -88.7061, -68.52, 0.773),
         ("malapert-massif", -86.0412, 3.16, 0.796)]


class CheckFailed(SystemExit):
    pass


def report(cond: bool, text: str) -> None:
    print(("PASS " if cond else "FAIL ") + text)
    if not cond:
        raise CheckFailed(f"check failed: {text}")


# --- Source --------------------------------------------------------------------------------------

def fetch_label(product: str) -> dict[str, str]:
    RAW.mkdir(exist_ok=True)
    path = RAW / (product.lower() + ".lbl")
    if not path.exists():
        r = requests.get(BASE_URL + path.name, timeout=60)
        r.raise_for_status()
        path.write_bytes(r.content)
    return read_label(path)


def check_label(layer: str, lbl: dict[str, str]) -> None:
    product, scale, offset, _ = LAYERS[layer]
    got = {
        "PRODUCT_ID": lbl["PRODUCT_ID"].strip('"'), "RECORD_TYPE": lbl["RECORD_TYPE"],
        "RECORD_BYTES": int(num(lbl, "RECORD_BYTES")), "FILE_RECORDS": int(num(lbl, "FILE_RECORDS")),
        "LINES": int(num(lbl, "LINES")), "LINE_SAMPLES": int(num(lbl, "LINE_SAMPLES")),
        "SAMPLE_TYPE": lbl["SAMPLE_TYPE"], "SAMPLE_BITS": int(num(lbl, "SAMPLE_BITS")),
        "SCALING_FACTOR": num(lbl, "SCALING_FACTOR"), "OFFSET": num(lbl, "OFFSET"),
        "MAP_PROJECTION_TYPE": lbl["MAP_PROJECTION_TYPE"].strip('"'),
        "A_AXIS_RADIUS": num(lbl, "A_AXIS_RADIUS"), "C_AXIS_RADIUS": num(lbl, "C_AXIS_RADIUS"),
        "CENTER_LATITUDE": num(lbl, "CENTER_LATITUDE"),
        "MAP_PROJECTION_ROTATION": num(lbl, "MAP_PROJECTION_ROTATION"),
        "MAP_SCALE": num(lbl, "MAP_SCALE"),
        "LINE_PROJECTION_OFFSET": num(lbl, "LINE_PROJECTION_OFFSET"),
        "SAMPLE_PROJECTION_OFFSET": num(lbl, "SAMPLE_PROJECTION_OFFSET"),
        "POSITIVE_LONGITUDE_DIRECTION": lbl["POSITIVE_LONGITUDE_DIRECTION"].strip('"'),
    }
    want = {
        "PRODUCT_ID": product, "RECORD_TYPE": "FIXED_LENGTH", "RECORD_BYTES": RECORD_BYTES,
        "FILE_RECORDS": N_SRC, "LINES": N_SRC, "LINE_SAMPLES": N_SRC, "SAMPLE_TYPE": "LSB_INTEGER",
        "SAMPLE_BITS": 16, "SCALING_FACTOR": scale, "OFFSET": offset,
        "MAP_PROJECTION_TYPE": "POLAR STEREOGRAPHIC", "A_AXIS_RADIUS": 1737.4, "C_AXIS_RADIUS": 1737.4,
        "CENTER_LATITUDE": -90.0, "MAP_PROJECTION_ROTATION": 0.0, "MAP_SCALE": 240.0,
        "LINE_PROJECTION_OFFSET": OFF_SRC, "SAMPLE_PROJECTION_OFFSET": OFF_SRC,
        "POSITIVE_LONGITUDE_DIRECTION": "EAST",
    }
    bad = [f"{k}: label {got[k]!r}, expected {want[k]!r}" for k in want if got[k] != want[k]]
    report(not bad, f"{product} label: " + ("as expected" if not bad else "; ".join(bad)))
    lon0 = num(lbl, "CENTER_LONGITUDE")
    report(lon0 in (0.0, 180.0), f"{product} label CENTER_LONGITUDE = {lon0:g} (0 or 180; the data "
           "decide the orientation, see check_orientation)")


def fetch_rows(layer: str) -> np.ndarray:
    """LOLA rows FIRST .. FIRST + COUNT - 1, whole rows, as int16 (COUNT x 6420)."""
    product = LAYERS[layer][0]
    path = RAW / f"{product.lower()}.rows{FIRST}-{FIRST + COUNT - 1}.bin"
    want = COUNT * RECORD_BYTES
    if not path.exists() or path.stat().st_size != want:
        a, b = FIRST * RECORD_BYTES, (FIRST + COUNT) * RECORD_BYTES - 1
        url = BASE_URL + product.lower() + ".img"
        print(f"downloading bytes {a}-{b} ({want / 1e6:.1f} MB) of {url}")
        with requests.get(url, headers={"Range": f"bytes={a}-{b}"}, stream=True, timeout=120) as r:
            if r.status_code != 206:
                raise CheckFailed(f"{url}: expected HTTP 206 for a range request, got {r.status_code}")
            cr = r.headers.get("Content-Range", "")
            if cr != f"bytes {a}-{b}/{N_SRC * RECORD_BYTES}":
                raise CheckFailed(f"{url}: unexpected Content-Range {cr!r}")
            tmp = path.with_suffix(".part")
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        tmp.replace(path)
    raw = np.fromfile(path, dtype="<i2")
    report(raw.size * 2 == want, f"{path.name}: {raw.size * 2} bytes = {COUNT} rows x {RECORD_BYTES}")
    return raw.reshape(COUNT, N_SRC)


# --- Geometry -------------------------------------------------------------------------------------

def xy(lat: float, lon: float) -> tuple[float, float]:
    r = 2 * R_M * math.tan(math.radians(90 + lat) / 2)
    return r * math.sin(math.radians(lon)), r * math.cos(math.radians(lon))


def src_pixel(lat: float, lon: float, sx: int = 1, sy: int = 1) -> tuple[int, int]:
    """Nearest LOLA (column, row), 0-based, for an orientation (sx, sy) = (1, 1) as LDEM."""
    x, y = xy(lat, lon)
    return round(sx * x / 240 + OFF_SRC), round(OFF_SRC - sy * y / 240)


def sample(grid: np.ndarray, x_min: float, y_max: float, pixel: float, lat: float, lon: float) -> float:
    """Bilinear value of one of our grids at a point (as core/dem.ts reads dem.bin)."""
    x, y = xy(lat, lon)
    col, row = (x - x_min) / pixel, (y_max - y) / pixel
    c0, r0 = math.floor(col), math.floor(row)
    fc, fr = col - c0, row - r0
    g = grid[r0:r0 + 2, c0:c0 + 2].astype(float)
    return float((g[0, 0] * (1 - fc) + g[0, 1] * fc) * (1 - fr) + (g[1, 0] * (1 - fc) + g[1, 1] * fc) * fr)


# --- Checks on the source -------------------------------------------------------------------------

def check_raw(dn: dict[str, np.ndarray]) -> None:
    for layer in ("sun", "earth"):
        lo, hi = int(dn[layer].min()), int(dn[layer].max())
        report(lo >= 0 and hi <= 25000, f"{layer} DN {lo}..{hi} within 0..25000 (rows {FIRST}..{FIRST + COUNT - 1})")
    vals, counts = np.unique(dn["psr"], return_counts=True)
    report(set(vals.tolist()) <= {-20000, 20000},
           f"permanent-shadow DN values {dict(zip(vals.tolist(), counts.tolist()))} only -20000/+20000")


def check_orientation(val: dict[str, np.ndarray]) -> None:
    """Floors of named craters must be permanently shadowed and dark, the sunlit points bright,
    for the LDEM orientation; each other orientation must fail at least once."""
    def window(layer: str, i: int, j: int, r: int = 4) -> np.ndarray | None:
        jj = j - FIRST
        if not (r <= jj < COUNT - r and r <= i < N_SRC - r):
            return None
        return val[layer][jj - r:jj + r + 1, i - r:i + r + 1]

    print("\norientation: 9 x 9 LOLA cells round each point")
    results = {}
    for label, sgn in (("as LDEM (lon 0 up)", (1, 1)), ("rotated 180", (-1, -1)),
                       ("X flipped", (-1, 1)), ("Y flipped", (1, -1))):
        ok_all = True
        lines = []
        for name, lat, lon in FLOORS + SUNLIT:
            i, j = src_pixel(lat, lon, *sgn)
            sun, psr = window("sun", i, j), window("psr", i, j)
            if sun is None:
                ok, txt = False, "outside the downloaded rows"
            elif (name, lat, lon) in FLOORS:
                share = float((psr == 1).mean())
                ok = share == 1.0 and float(sun.max()) < 0.01
                txt = f"shadow share {share:.2f}, Sun max {float(sun.max()):.3f}"
            else:
                share = float((psr == 1).mean())
                ok = float(sun.max()) >= 0.75 and share < 0.1
                txt = f"Sun max {float(sun.max()):.3f}, shadow share {share:.2f}"
            ok_all &= ok
            lines.append(f"    {'ok ' if ok else 'no '} {name:22s} {txt}")
        results[label] = ok_all
        print(f"  {label}: {'all as expected' if ok_all else 'fails'}")
        for line in lines:
            print(line)
    others_fail = not any(v for k, v in results.items() if k != "as LDEM (lon 0 up)")
    report(results["as LDEM (lon 0 up)"] and others_fail,
           "orientation: only the LDEM layout puts shadow on the four crater floors and light on S0, C1 and Malapert")


def check_consistency(val: dict[str, np.ndarray]) -> None:
    psr = val["psr"] == 1
    lit_in_psr = float((val["sun"][psr] > 0).mean()) if psr.any() else 0.0
    earth_in_psr = float(val["earth"][psr].mean()) if psr.any() else 0.0
    print(f"     permanently shadowed cells: {int(psr.sum())}; Earth visibility there, mean {earth_in_psr:.3f}")
    report(lit_in_psr <= 0.005, f"consistency: {lit_in_psr * 100:.3f} % of permanently shadowed cells have Sun > 0 (<= 0.5 %)")


# --- Resample ------------------------------------------------------------------------------------

def to_240(v: np.ndarray, dx: float = 0.0, dy: float = 0.0) -> np.ndarray:
    """Our 240 m grid from a LOLA block (rows FIRST.., all columns). dx, dy shift the sampling by
    that many LOLA cells (0, 0 is the true position: the mean of a 2 x 2 LOLA block)."""
    fi = np.arange(DEM_SIZE) + (FIRST + 0.5) + dx            # fractional LOLA column
    fj = np.arange(DEM_SIZE) + 0.5 + dy                      # fractional row within the block
    i0, j0 = np.floor(fi).astype(int), np.floor(fj).astype(int)
    wi, wj = (fi - i0)[None, :], (fj - j0)[:, None]
    # Only a shifted sample (the registration check) can reach past the downloaded block, and only
    # in its outermost row or column, which that check crops away. At dx = dy = 0 nothing moves.
    i0, j0 = np.clip(i0, 0, v.shape[1] - 2), np.clip(j0, 0, v.shape[0] - 2)
    J, I = np.ix_(j0, i0)
    return ((1 - wj) * ((1 - wi) * v[J, I] + wi * v[J, I + 1])
            + wj * ((1 - wi) * v[J + 1, I] + wi * v[J + 1, I + 1]))


def to_480(g240: np.ndarray) -> np.ndarray:
    return g240.reshape(SIZE, 2, SIZE, 2).mean(axis=(1, 3))


def quantise(v: np.ndarray) -> np.ndarray:
    q = np.rint(np.clip(v, 0.0, 1.0) / VALUE_SCALE)
    return q.astype(np.uint8)


def highpass(a: np.ndarray, k: int = 7) -> np.ndarray:
    """a minus its k x k box mean (edges trimmed)."""
    c = np.cumsum(np.cumsum(np.pad(a, ((1, 0), (1, 0))), axis=0), axis=1)
    box = (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
    h = k // 2
    return a[h:h + box.shape[0], h:h + box.shape[1]] - box


def check_registration(sun_block: np.ndarray, dem_m: np.ndarray) -> None:
    """Fine terrain detail in the Sun layer should line up best with our height map unshifted."""
    crop = slice(DEM_SIZE // 2 - 700, DEM_SIZE // 2 + 700)
    hd = highpass(dem_m[crop, crop])
    hd = (hd - hd.mean()) / hd.std()
    table = {}
    for dy in (-1.0, -0.5, 0.0, 0.5, 1.0):
        for dx in (-1.0, -0.5, 0.0, 0.5, 1.0):
            hs = highpass(to_240(sun_block, dx, dy)[crop, crop])
            hs = (hs - hs.mean()) / hs.std()
            table[(dx, dy)] = float((hs * hd).mean())
    print("\nregistration: correlation of fine detail, Sun layer against our height map (rows dy, columns dx, LOLA cells)")
    print("        " + " ".join(f"{dx:+6.1f}" for dx in (-1.0, -0.5, 0.0, 0.5, 1.0)))
    for dy in (-1.0, -0.5, 0.0, 0.5, 1.0):
        print(f"  {dy:+5.1f} " + " ".join(f"{table[(dx, dy)]:6.3f}" for dx in (-1.0, -0.5, 0.0, 0.5, 1.0)))
    best = max(table, key=table.get)
    report(best == (0.0, 0.0), f"registration: best match at shift {best} LOLA cells (expected (0.0, 0.0))")


# --- Write and read back -------------------------------------------------------------------------

def write(grids: dict[str, np.ndarray]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {
        "size": SIZE, "pixel_m": PIXEL_M, "x_min_m": X_MIN_M, "y_max_m": Y_MAX_M,
        "value_scale": VALUE_SCALE, "max_byte": MAX_BYTE,
        "layers": {k: {"file": f"layers/{k}.bin", "product": LAYERS[k][0], "meaning": LAYERS[k][3]}
                   for k in LAYERS},
        "source": "LRO LOLA polar illumination products, release 2016 (E. Mazarico, NASA GSFC), "
                  "PDS Geosciences Node extras: " + BASE_URL,
        "product_page": PRODUCT_PAGE,
        "citation": CITATION,
    }
    for k, g in grids.items():
        (OUT / f"{k}.bin").write_bytes(g.tobytes(order="C"))
    (OUT / "layers.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


def read_back() -> tuple[dict, dict[str, np.ndarray]]:
    meta = json.loads((OUT / "layers.json").read_text(encoding="utf-8"))
    grids = {k: np.fromfile(DATA / v["file"], dtype=np.uint8) for k, v in meta["layers"].items()}
    return meta, grids


def expected_480(src: np.ndarray, row: int, col: int) -> float:
    """A 480 m cell's value computed straight from the LOLA source, independently of to_240/to_480.
    Cell k holds our 240 m cells 2k and 2k + 1; each of those is the mean of a 2 x 2 LOLA block
    starting at LOLA column 1942 + (its index). Together: LOLA columns 1942 + 2k .. 1944 + 2k with
    weights 1/4, 1/2, 1/4, and the same for rows (rows counted from the downloaded block)."""
    w = np.array([0.25, 0.5, 0.25])
    i0, j0 = FIRST + 2 * col, 2 * row
    return float(w @ src[j0:j0 + 3, i0:i0 + 3] @ w)


def check_source_reference(val: dict[str, np.ndarray]) -> None:
    """The source itself at Shackleton rim S0, before any resampling: the 9 x 9 LOLA window's
    brightest cell is 0.892 (Glaser et al. 2018 give 89.4 % solar visibility there)."""
    i, j = src_pixel(-89.6866, -162.81)
    peak = float(val["sun"][j - FIRST - 4:j - FIRST + 5, i - 4:i + 5].max())
    report(abs(peak - 0.892) < 0.0005, f"source reference: Shackleton rim S0, brightest Sun in the 9 x 9 "
           f"LOLA cells round it = {peak:.4f} (expected 0.892)")


def check_resampling(val: dict[str, np.ndarray]) -> None:
    """Each written byte, decoded, equals its cell's value computed directly from the source
    (expected_480), to within half a quantisation step. Checked at the reference points and at
    500 cells spread over the grid, for all three layers."""
    _, grids = read_back()
    rng = np.random.default_rng(14)
    cells = [(round((Y_MAX_M - y) / PIXEL_M), round((x - X_MIN_M) / PIXEL_M))
             for _n, lat, lon in FLOORS + SUNLIT for x, y in [xy(lat, lon)]]
    cells += [tuple(c) for c in rng.integers(1, SIZE - 1, size=(500, 2))]
    worst = 0.0
    for k in LAYERS:
        g = grids[k].reshape(SIZE, SIZE).astype(float) * VALUE_SCALE
        for r, c in cells:
            worst = max(worst, abs(g[r, c] - expected_480(val[k], r, c)))
    report(worst <= VALUE_SCALE / 2 + 1e-9, f"resampling: {len(cells)} cells x 3 layers match the source's "
           f"weighted 3 x 3 LOLA mean; largest difference {worst:.5f} (<= {VALUE_SCALE / 2})")
    # Shackleton rim S0 specifically: its 480 m cell against the source, both printed.
    x, y = xy(-89.6866, -162.81)
    r, c = round((Y_MAX_M - y) / PIXEL_M), round((x - X_MIN_M) / PIXEL_M)
    got = float(grids["sun"].reshape(SIZE, SIZE)[r, c]) * VALUE_SCALE
    want = expected_480(val["sun"], r, c)
    report(abs(got - want) <= VALUE_SCALE / 2 + 1e-9,
           f"Shackleton rim S0, 480 m cell ({r}, {c}): Sun {got:.3f} written, {want:.4f} from the source "
           "(a 480 m cell averages the narrow crest with its slopes, so it is lower than the 0.892 peak)")


def check_outputs(dem_m: np.ndarray) -> None:
    meta, grids = read_back()
    n = meta["size"]
    print()
    report((n, meta["pixel_m"], meta["x_min_m"], meta["y_max_m"]) == (SIZE, PIXEL_M, X_MIN_M, Y_MAX_M),
           f"layers.json grid: size {n}, {meta['pixel_m']} m, x_min {meta['x_min_m']}, y_max {meta['y_max_m']}")
    for k, g in grids.items():
        size = (OUT / f"{k}.bin").stat().st_size
        report(size == n * n and int(g.max()) <= MAX_BYTE,
               f"{k}.bin: {size} bytes ({size / 1e6:.2f} MB) = {n} x {n}; bytes {int(g.min())}..{int(g.max())} <= {MAX_BYTE}")
        grids[k] = g.reshape(n, n).astype(float) * meta["value_scale"]

    at = lambda k, lat, lon: sample(grids[k], X_MIN_M, Y_MAX_M, PIXEL_M, lat, lon)
    name, _id, f_lat, f_lon, _d = GAZETTEER[0]
    report(at("psr", f_lat, f_lon) >= 0.5 and at("sun", f_lat, f_lon) < 0.02,
           f"Shackleton floor ({f_lat}, {f_lon}): never-lit share {at('psr', f_lat, f_lon):.3f} >= 0.5, "
           f"Sun {at('sun', f_lat, f_lon):.3f}, Earth {at('earth', f_lat, f_lon):.3f}")
    # Coverage: no cell inside 80 S may be empty in all three layers by accident of the resampling.
    yy, xx = np.mgrid[0:n, 0:n]
    inside = np.hypot(X_MIN_M + xx * PIXEL_M, Y_MAX_M - yy * PIXEL_M) <= 2 * R_M * math.tan(math.radians(5))
    print(f"     inside 80 S: Sun mean {grids['sun'][inside].mean():.3f}, Earth mean "
          f"{grids['earth'][inside].mean():.3f}, never-lit area {grids['psr'][inside].mean() * 100:.2f} %")
    report(int(inside.sum()) > 0 and all(np.isfinite(grids[k][inside]).all() for k in grids),
           f"coverage: all {int(inside.sum())} cells inside 80 S have a value in every layer "
           "(the source covers 65 S to the pole, so there is no missing data)")

    print("\ncross-check (printed, not pass/fail):")
    print(f"  Earth at Shackleton rim S0: {at('earth', -89.6866, -162.81):.3f} at 480 m "
          "(our own engine: 48.0 % Earth in view, 2026-2044, docs/sources/T07.md)")
    for sid, lat, lon, ref in CROSS:
        print(f"  {sid:22s} Sun {at('sun', lat, lon):.3f} at 480 m (60 m map, #82: {ref:.3f}; a coarser cell averages a narrow crest down)")


# --- Main ----------------------------------------------------------------------------------------

def dem_heights() -> np.ndarray:
    meta = json.loads((DATA / "dem.json").read_text(encoding="utf-8"))
    report((meta["size"], meta["pixel_m"], meta["x_min_m"], meta["y_max_m"]) == (DEM_SIZE, DEM_PIXEL, DEM_X_MIN, DEM_Y_MAX),
           f"dem.json grid matches this script ({meta['size']}, {meta['pixel_m']} m, {meta['x_min_m']}, {meta['y_max_m']})")
    v = np.fromfile(DATA / "dem.bin", dtype="<i2").reshape(DEM_SIZE, DEM_SIZE)
    return v.astype(float) * meta["height_scale"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check-only", action="store_true", help="skip download and resampling, check the files")
    args = ap.parse_args()
    dem_m = dem_heights()
    if not args.check_only:
        print(f"LOLA rows and columns needed: {FIRST}..{FIRST + COUNT - 1} ({COUNT})")
        for layer in LAYERS:
            check_label(layer, fetch_label(LAYERS[layer][0]))
        dn = {k: fetch_rows(k) for k in LAYERS}
        check_raw(dn)
        val = {k: dn[k].astype(np.float64) * LAYERS[k][1] + LAYERS[k][2] for k in LAYERS}
        # DN is only +-20000 (check_raw), so the label's formula gives 0 and 1 up to rounding.
        val["psr"] = np.rint(val["psr"])
        del dn
        check_orientation(val)
        sub = {k: v[:, FIRST:FIRST + COUNT] for k, v in val.items()}
        check_consistency(sub)
        check_registration(val["sun"], dem_m)
        check_source_reference(val)
        grids = {k: quantise(to_480(to_240(val[k]))) for k in LAYERS}
        write(grids)
        check_resampling(val)
    check_outputs(dem_m)
    print("\nall checks passed")


if __name__ == "__main__":
    try:
        main()
    except CheckFailed as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
