"""Fetch FIRMS area-API data for Argentina's bbox, 2026-01-01 to today, in 5-day chunks.

Per sensor, /api/data_availability decides the source: standard processing (SP)
up to its max_date, near-real-time (NRT) after. Raw responses are saved
unmodified under firms_api/<year>/ (git-ignored); this script does no filtering.

MAP_KEY comes from env FIRMS_MAP_KEY, else from .env. It is never printed.
Usage: .venv/bin/python pipeline/fetch_firms.py [--refresh-nrt]
"""
import io
import os
import sys
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "firms_api"
BASE = "https://firms.modaps.eosdis.nasa.gov/api"
BBOX = "-74,-56,-53,-21"
START = date(2026, 1, 1)
CHUNK = 5
SENSORS = {"MODIS": ("MODIS_SP", "MODIS_NRT"), "VIIRS": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT")}


def map_key():
    k = os.environ.get("FIRMS_MAP_KEY")
    if not k and (ROOT / ".env").exists():
        for line in (ROOT / ".env").read_text().splitlines():
            if line.startswith("FIRMS_MAP_KEY="):
                k = line.split("=", 1)[1].strip().strip("'\"")
    if not k:
        sys.exit("FIRMS_MAP_KEY not set (env or .env)")
    return k


def get(url, key, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read().decode("utf-8")
        except Exception as e:                       # noqa: BLE001
            msg = str(e).replace(key, "<key>")
            print(f"  retry {i + 1}/{tries}: {msg}")
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"failed: {url.replace(key, '<key>')}")


def availability(key):
    txt = get(f"{BASE}/data_availability/csv/{key}/ALL", key)
    df = pd.read_csv(io.StringIO(txt))
    return {r.data_id: (date.fromisoformat(r.min_date), date.fromisoformat(r.max_date)) for r in df.itertuples()}


def plan(avail, today):
    """List of (sensor, source, start, ndays) chunks; chunks never cross the SP/NRT boundary."""
    jobs = []
    for sensor, (sp, nrt) in SENSORS.items():
        sp_end = avail[sp][1]
        for src, lo, hi in [(sp, START, min(sp_end, today)), (nrt, max(START, sp_end + timedelta(days=1)), today)]:
            d = lo
            while d <= hi:
                n = min(CHUNK, (hi - d).days + 1)
                jobs.append((sensor, src, d, n))
                d += timedelta(days=n)
    return jobs


def main():
    refresh_nrt = "--refresh-nrt" in sys.argv
    key = map_key()
    today = date.today()
    avail = availability(key)
    out = DEST / str(START.year)
    out.mkdir(parents=True, exist_ok=True)
    jobs = plan(avail, today)
    print(f"{len(jobs)} chunks, {START}..{today}")
    for sensor, (sp, nrt) in SENSORS.items():
        print(f"  {sensor}: {sp} {avail[sp][0]}..{avail[sp][1]}; {nrt} {avail[nrt][0]}..{avail[nrt][1]}")
    log = []
    for sensor, src, d, n in jobs:
        f = out / f"{src}_{d.isoformat()}_{n}d.csv"
        if f.exists() and not (refresh_nrt and src.endswith("NRT")):
            txt = f.read_text()
        else:
            txt = get(f"{BASE}/area/csv/{key}/{src}/{BBOX}/{n}/{d.isoformat()}", key)
            if not txt.startswith("latitude"):
                raise RuntimeError(f"{src} {d}: unexpected response: {txt[:200].replace(key, '<key>')}")
            f.write_text(txt)
            time.sleep(0.5)
        rows = max(0, txt.count("\n") - 1)
        log.append({"sensor": sensor, "source": src, "start": d, "days": n, "rows": rows, "file": f.name})
    lg = pd.DataFrame(log)
    lg.to_csv(out / "_fetch_log.csv", index=False)
    print(lg.groupby(["sensor", "source"]).agg(chunks=("rows", "size"), rows=("rows", "sum"),
                                               first=("start", "min"), last=("start", "max")).to_string())


if __name__ == "__main__":
    main()
