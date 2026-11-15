"""T43: the Sun and Earth map layers away from the poles, on a smooth Moon (no terrain).

The LOLA team's maps (make_layers.py) give, for each cell near a pole, the share of hourly steps
over 18.6 years in which any part of the Sun's or Earth's disc is visible over the real terrain.
This script gives the same two shares for a smooth sphere of radius R = 1737.4 km, on a 0.5 degree
latitude-longitude grid over the whole Moon, so a map layer has a value everywhere (SPEC section 6,
docs/data-contract.md section 2, `layers/smooth.json`).

Sun and Earth come from JPL DE440 through Skyfield, in the Moon's mean-Earth frame
MOON_ME_DE440_ME421, exactly as T01's table (make_ephemeris.load_skyfield): apparent positions,
light-time corrected, seen from the Moon's centre. No atmosphere, so no refraction.

Span: hourly from 2020-01-01T00Z for 18.6 years (6794 days, to 2038-08-08T00Z), the length of the
LOLA maps' span. The LOLA team does not publish the dates of theirs; 18.6 years is one turn of the
Moon's orbital nodes, so on a smooth Moon the share barely depends on where the span starts.

Test for "any part of the disc is visible". A body of radius Rb at position X from the Moon's
centre shows part of its disc above the horizontal plane of the surface point R n (n the unit
"up") exactly when its centre is less than Rb below that plane:

    X . n - R > -Rb,   that is   X . n > R - Rb

This is the same as "the centre's altitude is above minus the disc's angular radius, seen from
the point itself", with no approximation, and it is linear in n: each time step is one column of a
matrix product. Earth's radius: 6371.0 km (IUGG mean); the Sun's: 695 700 km (IAU 2015 nominal).
check_skyfield() compares the test with Skyfield's own altitude for a surface point.

Run from anywhere:
    python data-prep/make_layers_global.py              compute, write, check
    python data-prep/make_layers_global.py --check-only read the written files back and check them

Writes only web/public/data/layers/smooth.json, smooth_sun.bin, smooth_earth.bin. Exits with
code 1 if a check fails.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

from make_ephemeris import FRAME, load_skyfield

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "web" / "public" / "data"
OUT = DATA / "layers"

R_KM = 1737.4
BODY_RADIUS_KM = {"sun": 695_700.0, "earth": 6371.0}
WIDTH, HEIGHT = 720, 360                      # 0.5 degrees a cell
START = (2020, 1, 1)
DAYS = 6794                                   # 18.6 years of 365.25 days, rounded to the day
STEP_S = 3600
VALUE_SCALE = 0.004
MAX_BYTE = 250
CHUNK = 256                                   # hours per matrix product

MEANINGS = {
    "sun": "share of hourly steps over 18.6 years with any part of the Sun's disc above the horizontal, on a smooth Moon",
    "earth": "share of hourly steps over 18.6 years with any part of Earth's disc above the horizontal, on a smooth Moon",
}


class CheckFailed(SystemExit):
    pass


def report(cond: bool, text: str) -> None:
    print(("PASS " if cond else "FAIL ") + text)
    if not cond:
        raise CheckFailed(f"check failed: {text}")


def iso(y: int, m: int, d: int) -> str:
    return f"{y:04d}-{m:02d}-{d:02d}T00:00:00Z"


def end_date() -> tuple[int, int, int]:
    import datetime as dt
    e = dt.date(*START) + dt.timedelta(days=DAYS)
    return e.year, e.month, e.day


def cell_centres() -> tuple[np.ndarray, np.ndarray]:
    """Latitude and longitude of every cell centre, degrees, row 0 at 90 N, column 0 from 180 W."""
    lat = 90 - (np.arange(HEIGHT) + 0.5) * 180 / HEIGHT
    lon = -180 + (np.arange(WIDTH) + 0.5) * 360 / WIDTH
    return lat, lon


def up_vectors() -> np.ndarray:
    """(HEIGHT * WIDTH, 3) unit "up" vectors, row by row: contract section 3's n."""
    lat, lon = cell_centres()
    la, lo = np.meshgrid(np.radians(lat), np.radians(lon), indexing="ij")
    n = np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=-1)
    return n.reshape(-1, 3)


def positions(ts, eph, frame) -> dict[str, np.ndarray]:
    """Sun and Earth from the Moon's centre, km, (3, hours), as make_ephemeris.make_table."""
    hours = np.arange(DAYS * 24)
    t = ts.utc(START[0], START[1], START[2] + hours // 24, hours % 24)
    moon = eph["moon"].at(t)
    return {
        "sun": moon.observe(eph["sun"]).apparent().frame_xyz(frame).km,
        "earth": moon.observe(eph["earth"]).apparent().frame_xyz(frame).km,
    }


def shares(x_km: np.ndarray, body: str) -> np.ndarray:
    """For every cell, the share of the hours with X . n > R - Rb. Done on unit vectors in float32
    (one hour a column) against a threshold per hour, (R - Rb) / |X|."""
    n = up_vectors().astype(np.float32)
    dist = np.linalg.norm(x_km, axis=0)
    unit = (x_km / dist).astype(np.float32)
    limit = ((R_KM - BODY_RADIUS_KM[body]) / dist).astype(np.float32)
    count = np.zeros(n.shape[0], dtype=np.int64)
    hours = x_km.shape[1]
    t0 = time.time()
    for a in range(0, hours, CHUNK):
        b = min(hours, a + CHUNK)
        count += np.count_nonzero(n @ unit[:, a:b] > limit[None, a:b], axis=1)
    print(f"  {body}: {hours} hours x {n.shape[0]} cells in {time.time() - t0:.0f} s")
    return (count / hours).reshape(HEIGHT, WIDTH)


def quantise(v: np.ndarray) -> np.ndarray:
    return np.rint(np.clip(v, 0.0, 1.0) / VALUE_SCALE).astype(np.uint8)


def write(grids: dict[str, np.ndarray]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {
        "width": WIDTH, "height": HEIGHT, "value_scale": VALUE_SCALE, "max_byte": MAX_BYTE,
        "start": iso(*START), "end": iso(*end_date()), "step_s": STEP_S,
        "files": {k: f"layers/smooth_{k}.bin" for k in grids},
        "meanings": MEANINGS,
        "source": f"JPL DE440 via Skyfield (frame {FRAME}), on a smooth sphere of radius {R_KM} km "
                  "(no terrain); Earth radius 6371.0 km, Sun radius 695700 km",
    }
    for k, g in grids.items():
        (OUT / f"smooth_{k}.bin").write_bytes(quantise(g).tobytes(order="C"))
    (OUT / "smooth.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


def read_back() -> tuple[dict, dict[str, np.ndarray]]:
    meta = json.loads((OUT / "smooth.json").read_text(encoding="utf-8"))
    grids = {}
    for k, f in meta["files"].items():
        raw = np.fromfile(DATA / f, dtype=np.uint8)
        report(raw.size == meta["width"] * meta["height"] and int(raw.max()) <= meta["max_byte"],
               f"{f}: {raw.size} bytes ({raw.size / 1e6:.2f} MB) = {meta['width']} x {meta['height']}, "
               f"bytes {int(raw.min())}..{int(raw.max())} <= {meta['max_byte']}")
        grids[k] = raw.reshape(meta["height"], meta["width"]).astype(float) * meta["value_scale"]
    return meta, grids


def at(grid: np.ndarray, lat: float, lon: float) -> float:
    """Bilinear between cell centres, longitude wrapping, as core/layers.ts parseSmooth."""
    h, w = grid.shape
    fr, fc = (90 - lat) * h / 180 - 0.5, (lon + 180) * w / 360 - 0.5
    r0, c0 = math.floor(fr), math.floor(fc)
    v, u = fr - r0, fc - c0
    cell = lambda r, c: grid[min(h - 1, max(0, r)), c % w]
    return float((cell(r0, c0) * (1 - u) + cell(r0, c0 + 1) * u) * (1 - v)
                 + (cell(r0 + 1, c0) * (1 - u) + cell(r0 + 1, c0 + 1) * u) * v)


def check_skyfield(ts, eph, pc, frame, x: dict[str, np.ndarray]) -> None:
    """Our test against Skyfield's own apparent altitude from a point on the surface: 400 random
    cells, each at 40 random hours of the span, for both bodies. A case closer than 0.01 degrees to
    the limit is left out (the two differ there only by the light-time between centre and point)."""
    rng = np.random.default_rng(43)
    lat_c, lon_c = cell_centres()
    hours = np.arange(DAYS * 24)
    n_all = up_vectors()
    checked = agree = 0
    for _ in range(400):
        j, i = int(rng.integers(HEIGHT)), int(rng.integers(WIDTH))
        hs = np.sort(rng.choice(hours, 40, replace=False))
        t = ts.utc(START[0], START[1], START[2] + hs // 24, hs % 24)
        place = (eph["moon"] + pc.build_latlon_degrees(frame, float(lat_c[j]), float(lon_c[i]), elevation_m=0.0)).at(t)
        n = n_all[j * WIDTH + i]
        for body in ("sun", "earth"):
            obs = place.observe(eph[body]).apparent()
            alt, _az, dist = obs.altaz()
            radius = np.degrees(np.arcsin(BODY_RADIUS_KM[body] / dist.km))
            margin = alt.degrees + radius                       # > 0: some of the disc is up
            ours = (n @ x[body][:, hs]) > R_KM - BODY_RADIUS_KM[body]
            clear = np.abs(margin) > 0.01
            checked += int(clear.sum())
            agree += int(((margin > 0) == ours)[clear].sum())
    report(checked > 30000 and agree == checked,
           f"Skyfield: our test agrees with Skyfield's apparent altitude from the surface point in "
           f"{agree} of {checked} cases (400 cells x 40 hours x Sun and Earth)")


def check_outputs() -> None:
    meta, g = read_back()
    report((meta["width"], meta["height"], meta["start"], meta["end"]) == (WIDTH, HEIGHT, iso(*START), iso(*end_date())),
           f"smooth.json: {meta['width']} x {meta['height']}, {meta['start']} to {meta['end']}, every {meta['step_s']} s")
    years = DAYS / 365.25
    report(abs(years - 18.6) < 0.01, f"span: {DAYS} days = {years:.3f} years (the LOLA maps' 18.6)")
    e00, e180 = at(g["earth"], 0, 0), at(g["earth"], 0, 180)
    report(e00 >= 0.996 and e180 <= 0.004, f"Earth at 0 N 0 E {e00:.3f} (near 1), at 0 N 180 E {e180:.3f} (near 0)")
    e90, em90 = at(g["earth"], 0, 90), at(g["earth"], 0, -90)
    report(abs(e90 - em90) < 0.05 and 0.3 < e90 < 0.7, f"Earth at the limbs: 0 N 90 E {e90:.3f}, 0 N 90 W {em90:.3f} (about a half, alike)")
    eq = g["sun"][HEIGHT // 2 - 1:HEIGHT // 2 + 1, :]
    # On a smooth sphere at the equator the Sun's centre is up half the time; its disc a little
    # longer: 2 x 0.27 degrees of the 360 a day turns, about 0.0015 more.
    report(abs(float(eq.mean()) - 0.5015) < 0.002, f"Sun along the equator: mean {float(eq.mean()):.4f} (about 0.5015)")
    mid = g["sun"][(np.abs(cell_centres()[0]) < 80)]
    report(float(mid.min()) > 0.49 and float(mid.max()) < 0.52,
           f"Sun between 80 S and 80 N: {float(mid.min()):.3f} to {float(mid.max()):.3f} (a smooth Moon has no shadows)")
    print("\nprinted, not pass/fail: at the seam the smooth values meet the LOLA ones")
    lola = DATA / "layers" / "layers.json"
    if lola.exists():
        lm = json.loads(lola.read_text(encoding="utf-8"))
        for pole, sign in (("south", -1), ("north", 1)):
            grid = lm.get("polar", {}).get(pole)
            if not grid:
                continue
            n = grid["size"]
            sun = np.fromfile(DATA / grid["files"]["sun"], dtype=np.uint8).reshape(n, n) * lm["value_scale"]
            yy, xx = np.mgrid[0:n, 0:n]
            r = np.hypot(grid["x_min_m"] + xx * grid["pixel_m"], grid["y_max_m"] - yy * grid["pixel_m"])
            # 80 to 80.5 degrees: c = 90 - |lat| from 10 down to 9.5, r = 2 R tan(c / 2).
            ring = (r > 2 * R_KM * 1000 * math.tan(math.radians(4.75))) & (r <= 2 * R_KM * 1000 * math.tan(math.radians(5)))
            smooth = float(np.mean([at(g["sun"], sign * 79.75, lon) for lon in range(-180, 180, 5)]))
            print(f"  {pole}: Sun, LOLA between 80 and 80.5 degrees, mean {float(sun[ring].mean()):.3f}; "
                  f"smooth Moon at 79.75 degrees, mean {smooth:.3f}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check-only", action="store_true", help="read the written files back and check them")
    args = ap.parse_args()
    if not args.check_only:
        ts, eph, pc, frame = load_skyfield()
        print(f"positions: hourly, {DAYS * 24} hours from {iso(*START)}")
        x = positions(ts, eph, frame)
        check_skyfield(ts, eph, pc, frame, x)
        grids = {body: shares(x[body], body) for body in ("sun", "earth")}
        write(grids)
        _meta, back = read_back()
        worst = max(float(np.abs(back[k] - np.clip(grids[k], 0, 1)).max()) for k in grids)
        report(worst <= VALUE_SCALE / 2 + 1e-9, f"written bytes match the computed shares to {worst:.4f} (<= {VALUE_SCALE / 2})")
    check_outputs()
    print("\nall checks passed")


if __name__ == "__main__":
    try:
        main()
    except CheckFailed as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
