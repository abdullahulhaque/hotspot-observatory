"""Live-year (2026) input from the FIRMS area API files written by fetch_firms.py.

Returns rows shaped like calibration.load_year: Argentina only, one satellite
(Aqua / S-NPP), with columns latitude, longitude, acq_date, satellite,
confidence, daynight, type, date, plus `proc` ("SP" or "NRT").

- Clip: the API bbox (-74,-56,-53,-21) also covers neighbouring countries and
  sea. Points are kept inside the Natural Earth 10m Argentina polygon
  (pipeline/ref/argentina_ne10m.geojson). Checked against the 2019 country
  archive: MODIS matches exactly; VIIRS annual cell-days are -0.01% off.
- Static sources: SP rows carry FIRMS `type`. NRT rows have no `type`, so it
  is inferred. A detection gets type=2 when it falls on a location where SP
  data recorded type 1/2/3 (archive 2003/2012-2025 + 2026 SP). Location grid:
  0.005 deg for VIIRS, 0.01 deg for MODIS. Checked on 2025 and 2026 SP: residual
  cell-day bias -0.1%/+0.8% (VIIRS), +0.6%/+1.1% (MODIS), vs +1.7%/+3.9% and
  +2.8%/+5.4% with no filter.
"""
import json
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
from matplotlib.path import Path as MPath

ROOT = Path(__file__).resolve().parents[1]
LIVE_YEAR = 2026
ARCHIVE_END = 2025
API_DIR = ROOT / "firms_api" / str(LIVE_YEAR)
SOURCES = {"MODIS": ("MODIS_SP", "MODIS_NRT"), "VIIRS": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT")}
SAT = {"MODIS": "Aqua", "VIIRS": "N"}
STATIC_RES = {"MODIS": 0.01, "VIIRS": 0.005}
COLS = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence", "daynight", "type"]


@lru_cache(maxsize=1)
def _paths():
    g = json.loads((ROOT / "pipeline/ref/argentina_ne10m.geojson").read_text())["features"][0]["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    return [MPath(p[0]) for p in polys]


def in_argentina(df):
    pts = np.column_stack([df.longitude.values, df.latitude.values])
    m = np.zeros(len(pts), bool)
    for p in _paths():
        m |= p.contains_points(pts)
    return m


def _read_api(src):
    fs = sorted(API_DIR.glob(f"{src}_*.csv"))
    if not fs:
        return pd.DataFrame(columns=COLS)
    parts = [pd.read_csv(f, dtype={"confidence": str, "acq_time": str}) for f in fs]
    df = pd.concat([p for p in parts if len(p)], ignore_index=True)
    if "type" not in df:
        df["type"] = np.nan
    return df[COLS]


def _key(lat, lon, res):
    return set(zip(np.floor(lat / res).astype(int), np.floor(lon / res).astype(int)))


@lru_cache(maxsize=2)
def static_locations(sensor):
    res, parts = STATIC_RES[sensor], []
    years = range(2003 if sensor == "MODIS" else 2012, ARCHIVE_END + 1)
    for y in years:
        p = (ROOT / f"modis/{y}/modis_{y}_Argentina.csv" if sensor == "MODIS"
             else ROOT / f"viirs-snpp/{y}/viirs-snpp_{y}_Argentina.csv")
        d = pd.read_csv(p, usecols=["latitude", "longitude", "type"])
        parts.append(d[d.type.isin([1, 2, 3])])
    sp = _read_api(SOURCES[sensor][0])
    sp = sp[in_argentina(sp)]
    parts.append(sp[sp.type.isin([1, 2, 3])][["latitude", "longitude", "type"]])
    s = pd.concat(parts)
    return frozenset(_key(s.latitude.values, s.longitude.values, res))


@lru_cache(maxsize=2)
def _load(sensor):
    sp_src, nrt_src = SOURCES[sensor]
    sp, nrt = _read_api(sp_src).assign(proc="SP"), _read_api(nrt_src).assign(proc="NRT")
    df = pd.concat([sp, nrt], ignore_index=True)
    df = df[in_argentina(df)]
    df = df[df.satellite == SAT[sensor]].copy()
    isn = df.proc == "NRT"
    if isn.any():
        loc = static_locations(sensor)
        res = STATIC_RES[sensor]
        ks = zip(np.floor(df.latitude[isn] / res).astype(int), np.floor(df.longitude[isn] / res).astype(int))
        df.loc[isn, "type"] = [2 if k in loc else 0 for k in ks]
    df["type"] = df.type.astype(int)
    df["date"] = pd.to_datetime(df.acq_date)
    return df


def load_live(sensor):
    return _load(sensor).copy()


def fetch_summary():
    log = pd.read_csv(API_DIR / "_fetch_log.csv", parse_dates=["start"])
    log["end"] = log.start + pd.to_timedelta(log.days - 1, unit="D")
    out = {}
    for sensor, (sp, nrt) in SOURCES.items():
        d = _load(sensor)
        out[sensor] = {
            "sources": {s: {"requested": [str(g.start.min().date()), str(g.end.max().date())],
                            "chunks": int(len(g)), "rows_bbox_all_satellites": int(g.rows.sum())}
                        for s, g in log[log.source.isin([sp, nrt])].groupby("source")},
            "rows_argentina_this_satellite": {k: int(v) for k, v in d.proc.value_counts().items()},
            "first_date": str(d.date.min().date()), "last_date": str(d.date.max().date()),
            "sp_last_requested": str(log[log.source == sp].end.max().date()),
            "nrt_rows_inferred_static": int(((d.proc == "NRT") & (d.type != 0)).sum()),
        }
    return out


def nrt_months(sensor):
    """Months of LIVE_YEAR whose data for this sensor is (partly) NRT, from the fetch plan."""
    log = pd.read_csv(API_DIR / "_fetch_log.csv", parse_dates=["start"])
    log["end"] = log.start + pd.to_timedelta(log.days - 1, unit="D")
    g = log[log.source == SOURCES[sensor][1]]
    months = set()
    for r in g.itertuples():
        for d in pd.date_range(r.start, r.end):
            months.add((d.year, d.month))
    return months


def live_gaps(complete):
    """Task 2 rule on the live year: national zero-row days for one sensor while the other has rows."""
    daily = {s: _load(s).groupby("acq_date").size() for s in SOURCES}
    days = pd.date_range(f"{LIVE_YEAR}-01-01", f"{LIVE_YEAR}-12-31").strftime("%Y-%m-%d")
    w = pd.DataFrame(daily).reindex(days).fillna(0)
    w = w[[(int(d[:4]), int(d[5:7])) in complete for d in w.index]]
    rows = []
    for s, o in [("MODIS", "VIIRS"), ("VIIRS", "MODIS")]:
        g = w[(w[s] == 0) & (w[o] > 0)]
        rows += [{"date": d, "sensor_missing": s, "year": int(d[:4]), "month": int(d[5:7])} for d in g.index]
    g = pd.DataFrame(rows, columns=["date", "sensor_missing", "year", "month"])
    pm = g.groupby(["sensor_missing", "year", "month"]).agg(gap_days=("date", "size"),
                                                           dates=("date", list)).reset_index()
    return pm
