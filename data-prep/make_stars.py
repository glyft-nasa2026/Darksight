"""Issue #80: the star map behind the 3D views, plus the fixture that checks how it is turned.

Run from anywhere:  python data-prep/make_stars.py
Needs skyfield and numpy (data-prep/requirements.txt) and, in data-prep/raw/ (git-ignored):
  bsc5/catalog.gz   the Yale Bright Star Catalogue, 5th revised edition (VizieR V/50),
                    https://vizier.cfa.harvard.edu/ftp/cats/V/50/catalog.gz (downloaded if missing)
  the JPL/NAIF kernels make_ephemeris.py downloads.

Writes (docs/data-contract.md, section 2):
  web/public/data/stars.json + stars.bin    every star with a position and a V magnitude
  web/src/core/__fixtures__/sky.json        Skyfield's own rotations, for core/sky.test.ts
then prints the checks. Exits with code 1 if any check fails.

The stars are a picture: no number shown to the user comes from them. Positions are J2000
(equinox and epoch 2000.0); proper motion is left out, at most 0.003 degrees a year for these
stars.
"""

from __future__ import annotations

import gzip
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
from skyfield.framelib import itrs

from make_ephemeris import FIX, OUT, RAW, load_skyfield

BSC_URL = "https://vizier.cfa.harvard.edu/ftp/cats/V/50/catalog.gz"
BSC = RAW / "bsc5" / "catalog.gz"
SOURCE = "Yale Bright Star Catalogue, 5th revised ed. (Hoffleit and Warren 1991), VizieR V/50"
UNIT_SCALE = 32767      # int16 per unit of a direction component
MAG_SCALE = 1000        # int16 per magnitude, for V and B-V
BV_MISSING = 0.6        # a Sun-like colour where the catalogue gives none
FIXTURE_YEARS = [1905, 1950, 1969, 1990, 2000, 2010, 2024, 2027, 2035, 2050, 2075, 2099]


def field(line: str, a: int, b: int) -> str:
    """Bytes a..b of a line, 1-based and inclusive, as in the catalogue's ReadMe."""
    return line[a - 1:b].strip()


def read_bsc() -> np.ndarray:
    """(n, 5) float64: x, y, z (ICRF unit vector), V magnitude, B-V. Brightest first."""
    if not BSC.exists():
        BSC.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(BSC_URL, BSC)
    rows = []
    with gzip.open(BSC, "rt", encoding="latin-1") as f:
        for line in f:
            line = line.rstrip("\n").ljust(197)
            ra_h, vmag = field(line, 76, 77), field(line, 103, 107)
            if not ra_h or not vmag:
                continue    # 14 entries (novae, a cluster, non-stellar objects) have no position
            ra = (int(ra_h) + int(field(line, 78, 79)) / 60 + float(field(line, 80, 83)) / 3600) * 15
            dec = int(field(line, 85, 86)) + int(field(line, 87, 88)) / 60 + int(field(line, 89, 90)) / 3600
            if field(line, 84, 84) == "-":
                dec = -dec
            bv = field(line, 110, 114)
            ra_r, dec_r = np.radians(ra), np.radians(dec)
            rows.append([np.cos(dec_r) * np.cos(ra_r), np.cos(dec_r) * np.sin(ra_r), np.sin(dec_r),
                         float(vmag), float(bv) if bv else BV_MISSING])
    stars = np.array(rows)
    return stars[np.argsort(stars[:, 3], kind="stable")]


def write_stars(stars: np.ndarray) -> None:
    packed = np.empty(stars.shape, dtype="<i2")
    packed[:, :3] = np.round(stars[:, :3] * UNIT_SCALE)
    packed[:, 3:] = np.round(stars[:, 3:] * MAG_SCALE)
    (OUT / "stars.bin").write_bytes(packed.tobytes())
    meta = {
        "count": len(stars),
        "columns": ["x", "y", "z", "vmag", "bv"],
        "unit_scale": UNIT_SCALE,
        "mag_scale": MAG_SCALE,
        "frame": "ICRF (J2000 equator and equinox)",
        "epoch": 2000.0,
        "source": SOURCE,
    }
    (OUT / "stars.json").write_text(json.dumps(meta, indent=2) + "\n")


def write_fixture() -> list[dict]:
    """Skyfield's rotations from ICRF to the Moon-fixed frame and to Earth's (ITRS)."""
    ts, eph, _pc, frame = load_skyfield()
    cases = []
    for i, year in enumerate(FIXTURE_YEARS):
        t = ts.utc(year, 1 + i % 12, 1 + (7 * i) % 27, (5 * i) % 24, 17)
        moon = eph["moon"].at(t)
        earth_km_me = moon.observe(eph["earth"]).frame_xyz(frame).km
        earth_km_icrf = moon.observe(eph["earth"]).position.km
        cases.append({
            "t": t.utc_strftime("%Y-%m-%dT%H:%M:%SZ"),
            "moon": np.round(frame.rotation_at(t), 12).tolist(),
            "earth": np.round(itrs.rotation_at(t), 12).tolist(),
            "earth_km_me": np.round(earth_km_me, 3).tolist(),
            "earth_km_icrf": np.round(earth_km_icrf, 3).tolist(),
        })
    (FIX / "sky.json").write_text(json.dumps(cases, indent=1) + "\n")
    return cases


def main() -> int:
    stars = read_bsc()
    write_stars(stars)
    cases = write_fixture()
    raw = np.frombuffer((OUT / "stars.bin").read_bytes(), dtype="<i2").reshape(-1, 5)
    meta = json.loads((OUT / "stars.json").read_text())
    unit = raw[:, :3] / UNIT_SCALE
    checks = [
        ("star count is the catalogue's 9110 less 14 without a position", meta["count"] == 9096 == len(raw)),
        ("every direction is a unit vector to 1e-4", bool(np.all(np.abs(np.linalg.norm(unit, axis=1) - 1) < 1e-4))),
        ("brightest first: Sirius, V -1.46", raw[0, 3] == -1460),
        ("faintest is under V 8", raw[-1, 3] / MAG_SCALE < 8),
        ("stars.bin under 100 kB", (OUT / "stars.bin").stat().st_size < 100_000),
        ("fixture has 12 cases", len(cases) == 12),
    ]
    print(f"stars.bin: {(OUT / 'stars.bin').stat().st_size} bytes, {meta['count']} stars")
    ok = True
    for name, passed in checks:
        print(("PASS " if passed else "FAIL ") + name)
        ok &= passed
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
