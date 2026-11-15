"""T36: the gazetteer check's data. Which IAU feature each planned site sits on, and how big it is.

Run from anywhere:  python data-prep/check_features.py  [--refresh]
Standard library only. Downloads, into data-prep/raw/gazetteer/ (git-ignored), when missing or
with --refresh:
  MOON_nomenclature_center_pts.kmz   the USGS Gazetteer of Planetary Nomenclature's point file
                                     for the Moon, linked from
                                     https://planetarynames.wr.usgs.gov/GIS_Downloads
                                     (regenerated nightly; east longitude 0..360, planetocentric
                                     latitude; LOLA 2011 control network, as that page says)

Writes (docs/data-contract.md, section 2, fixtures):
  web/src/core/__fixtures__/features.json   per planned site in sites.json: the feature it sits
                                            on, its gazetteer id, centre, diameter and the file's
                                            date
then prints, for each planned site, its distance from the feature's centre against half the
feature's diameter (plus a margin for a region target), the check web/src/core/sites.test.ts
makes. Exits with code 1 if a planned site has no entry below, a feature isn't in the file, or a
site is too far from its feature.

The feature names come from the mission owners' own descriptions of each target
(docs/sources/T36.md). A target with no IAU feature gets `None` and the reason; the QuickMap
contact sheet (web/scripts/quickmap-sheet.mjs) and a person then check it alone.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RAW = HERE / "raw" / "gazetteer"
SITES = ROOT / "web" / "public" / "data" / "sites.json"
FIXTURE = ROOT / "web" / "src" / "core" / "__fixtures__" / "features.json"

KMZ_URL = "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.kmz"
KMZ = RAW / "MOON_nomenclature_center_pts.kmz"
KML_NAME = "MOON_nomenclature_center_pts.kml"
KML_NS = "{http://www.opengis.net/kml/2.2}"
R_KM = 1737.4

# Planned site id -> the IAU feature its owner names as the target. A region target adds
# "margin_km" and "margin_reason"; a target on no named feature has "feature": None and "reason".
TARGETS: dict[str, dict] = {
    "im-3": {"feature": "Reiner Gamma"},
    "blue-ghost-2": {"feature": "Nassau"},
    "blue-ghost-3": {"feature": "Mons Gruithuisen Gamma"},
    "chandrayaan-4": {"feature": "Mons Mouton"},
}


def download(refresh: bool) -> None:
    if KMZ.exists() and not refresh:
        return
    RAW.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(KMZ_URL, headers={"User-Agent": "darksight-data-prep"})
    with urllib.request.urlopen(request, timeout=120) as res:
        data = res.read()
    if not zipfile.is_zipfile(io.BytesIO(data)):
        raise SystemExit(f"{KMZ_URL} did not return a KMZ (zip) file")
    KMZ.write_bytes(data)


def read_features() -> tuple[dict[str, dict], str]:
    """Every feature in the file by its name, and the date the file was made (YYYY-MM-DD)."""
    with zipfile.ZipFile(KMZ) as z:
        made = date(*z.getinfo(KML_NAME).date_time[:3]).isoformat()
        root = ET.fromstring(z.read(KML_NAME))
    features: dict[str, dict] = {}
    for pm in root.iter(f"{KML_NS}Placemark"):
        d = {sd.get("name"): (sd.text or "").strip() for sd in pm.iter(f"{KML_NS}SimpleData")}
        name = d["clean_name"]      # some names carry a trailing space in the file ("Mons Mouton ")
        match = re.search(r"/Feature/(\d+)$", d["link"])
        if not match:
            raise SystemExit(f"{name}: no gazetteer id in its link {d['link']!r}")
        if name in features:
            raise SystemExit(f"{name}: two features with this name in the file")
        features[name] = {
            "gazetteer_id": int(match.group(1)),
            "type": d["type"],
            "lat": float(d["center_lat"]),
            "lon": wrap(float(d["center_lon"])),
            "diameter_km": float(d["diameter"]),
            "approval": d["approval"],
        }
    return features, made


def wrap(lon: float) -> float:
    """Longitude in -180..180, as the contract says."""
    lon = (lon + 180.0) % 360.0 - 180.0
    return 180.0 if lon == -180.0 else round(lon, 6)


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance on the 1737.4 km sphere (haversine)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * R_KM * math.asin(min(1.0, math.sqrt(h)))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--refresh", action="store_true", help="download the gazetteer file again")
    args = parser.parse_args()

    download(args.refresh)
    features, made = read_features()
    planned = [s for s in json.loads(SITES.read_text(encoding="utf-8")) if s["status"] == "planned"]

    checks: list[tuple[str, bool]] = [
        (f"{len(features)} features read from the file of {made}", len(features) > 1000),
        (f"{len(planned)} planned sites in sites.json, at most 5 (T36)", 0 < len(planned) <= 5),
    ]
    ids = {s["id"] for s in planned}
    for extra in sorted(set(TARGETS) - ids):
        checks.append((f"{extra}: in this script's list but not a planned site in sites.json", False))

    out: dict[str, dict] = {}
    for site in planned:
        target = TARGETS.get(site["id"])
        if target is None:
            checks.append((f"{site['id']}: no feature named for it in this script", False))
            continue
        if target["feature"] is None:
            out[site["id"]] = {"feature": None, "reason": target["reason"]}
            checks.append((f"{site['id']}: no IAU feature ({target['reason']}); QuickMap only", bool(target["reason"])))
            continue
        f = features.get(target["feature"])
        if f is None:
            checks.append((f"{site['id']}: {target['feature']!r} is not in the gazetteer file", False))
            continue
        entry = {"feature": target["feature"], **{k: f[k] for k in ("gazetteer_id", "type", "lat", "lon", "diameter_km")}}
        entry["page"] = f"https://planetarynames.wr.usgs.gov/Feature/{f['gazetteer_id']}"
        margin = 0.0
        if "margin_km" in target:
            margin = float(target["margin_km"])
            entry["margin_km"] = margin
            entry["margin_reason"] = target["margin_reason"]
        out[site["id"]] = entry
        d = distance_km(site["lat"], site["lon"], f["lat"], f["lon"])
        allowed = f["diameter_km"] / 2 + margin
        checks.append((f"{site['id']}: {d:.1f} km from the centre of {target['feature']} "
                       f"(gazetteer {f['gazetteer_id']}, {f['type']}, {f['diameter_km']:.1f} km across); "
                       f"allowed {allowed:.1f} km", d <= allowed))
        checks.append((f"{site['id']}: {target['feature']} is adopted by the IAU", f["approval"] == "Adopted by IAU"))

    fixture = {
        "source": "USGS Gazetteer of Planetary Nomenclature, MOON_nomenclature_center_pts.kmz",
        "url": KMZ_URL,
        "file_date": made,
        "frame": "east longitude (written here as -180..180), planetocentric latitude, LOLA 2011 control network",
        "radius_km": R_KM,
        "sites": out,
    }
    FIXTURE.write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {FIXTURE.relative_to(ROOT)}")

    failed = 0
    for text, ok in checks:
        print(("PASS " if ok else "FAIL ") + text)
        failed += not ok
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
