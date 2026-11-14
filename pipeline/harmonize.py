"""Back-cast 2003-2011, gap-fill VIIRS gaps with model b, append the live year; write outputs.

Model b (approved): log1p(VIIRS) = a + b*log1p(MODIS), national monthly daytime
active 0.1-degree cell-days, fitted 2012-2019 excluding gap-flagged months.
Refitted here from the same inputs and checked against Task 2's parameters.

harmonized (day):  2003-2011 back-cast; VIIRS-gap months gap-filled; else raw_viirs.
Live year (2026, FIRMS area API, see live.py): complete months only, `nrt` marks
months containing NRT data. A live VIIRS-gap month is gap-filled only when every
gap day is confirmed as missing S-NPP coverage (zero S-NPP rows worldwide while
NOAA-20 has rows; pipeline/ref/snpp_coverage_<year>.csv), else harmonized = observed.
Model months are distributed to cells pro rata to MODIS cell-days.
80% interval: leave-one-year-out residuals on 2012-2019.

Writes out/harmonized.parquet, out/national_monthly.parquet, out/validation.json,
out/chart_national_series.png. Usage: .venv/bin/python pipeline/harmonize.py
"""
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent))
from calibration import (BASE, GAP_DAYS_MAX, GRID, INK, INK2, MODIS_C, MUTED, PI, SURFACE,  # noqa: E402
                         VIIRS_C, cell, complete_months, load_year, score, style)
import live  # noqa: E402
from live import ARCHIVE_END, LIVE_YEAR  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out"
T2 = OUT / "task2"
MODIS_YEARS = range(2003, LIVE_YEAR + 1)
VIIRS_YEARS = range(2012, LIVE_YEAR + 1)
BACKCAST_END, TRAIN = 2011, (2012, 2019)
TEST = (2020, 2025)
TASK2_PARAMS = (1.662, 0.9141)
CALIBRATION = "model_b_v1"
CONTRACT = "harmonized_schema v0.4.1"

SCHEMA = pa.schema([("lat", pa.float64(), False), ("lon", pa.float64(), False),
                    ("year", pa.int16(), False), ("month", pa.int8(), False),
                    ("daynight", pa.string(), False), ("raw_modis", pa.float64()),
                    ("raw_viirs", pa.float64()), ("harmonized", pa.float64()),
                    ("source", pa.string(), False), ("gap_flag", pa.bool_(), False),
                    ("nrt", pa.bool_(), False)])


def cell_days(sensor, years, spans):
    parts = []
    for y in years:
        df = live.load_live(sensor) if y == LIVE_YEAR else load_year(sensor, y)
        if df is None:
            raise FileNotFoundError(f"{sensor} {y} not on disk")
        spans[(sensor, y)] = (df.date.min(), df.date.max())
        keep = (pd.to_numeric(df.confidence) >= 30) if sensor == "MODIS" else (df.confidence.str.lower() != "l")
        d = df[keep & (df.type == 0)].copy()
        d["lat"], d["lon"] = cell(d.latitude), cell(d.longitude)
        d = d.drop_duplicates(["date", "daynight", "lat", "lon"])
        d["year"], d["month"] = d.date.dt.year, d.date.dt.month
        parts.append(d.groupby(["lat", "lon", "year", "month", "daynight"]).size().rename(sensor))
    return pd.concat(parts)


def early_aqua_gaps():
    """Aqua zero-row days 2003-2011 while Terra has rows (same rule as Task 2, Terra as reference)."""
    rows = []
    for y in range(2003, BACKCAST_END + 1):
        df = pd.read_csv(ROOT / f"modis/{y}/modis_{y}_Argentina.csv", usecols=["acq_date", "satellite"])
        w = df.groupby(["acq_date", "satellite"]).size().unstack(fill_value=0)
        w = w.reindex(pd.date_range(f"{y}-01-01", f"{y}-12-31").strftime("%Y-%m-%d"), fill_value=0)
        g = w[(w["Aqua"] == 0) & (w["Terra"] > 0)]
        rows += [{"date": d, "terra_rows": int(t)} for d, t in zip(g.index, g["Terra"])]
    g = pd.DataFrame(rows)
    g["year"], g["month"] = g.date.str[:4].astype(int), g.date.str[5:7].astype(int)
    pm = (g.groupby(["year", "month"]).agg(gap_days=("date", "size"), median_terra_rows=("terra_rows", "median"),
                                           dates=("date", list)).reset_index())
    return g, pm


def hhmm(minutes):
    return f"{int(minutes) // 60:02d}:{int(minutes) % 60:02d}"


def sensor_diagnostics():
    """Version field and daytime overpass time by year, 2003+ (S-NPP from 2012). Diagnostic only."""
    rows = []
    for sensor, sat in [("MODIS", "Aqua"), ("VIIRS", "N")]:
        name = f"{sensor} {'Aqua' if sensor == 'MODIS' else 'S-NPP'}"
        for y in range(MODIS_YEARS[0], ARCHIVE_END + 1):
            if sensor == "VIIRS" and y < VIIRS_YEARS[0]:
                rows.append({"sensor": name, "year": y, "version": None, "median_day_acq_time_utc": None,
                             "median_day_local_solar_time": None, "median_day_local_solar_min": None,
                             "iqr_day_local_solar_time": None,
                             "note": "no data: S-NPP launched Oct 2011; FIRMS record starts 2012-01-20"})
                continue
            p = (ROOT / f"modis/{y}/modis_{y}_Argentina.csv" if sensor == "MODIS"
                 else ROOT / f"viirs-snpp/{y}/viirs-snpp_{y}_Argentina.csv")
            d = pd.read_csv(p, usecols=["longitude", "acq_time", "satellite", "version", "daynight"],
                            dtype={"acq_time": str, "version": str})
            d = d[d.satellite == sat]
            dd = d[d.daynight == "D"]
            utc = dd.acq_time.str[:2].astype(int) * 60 + dd.acq_time.str[2:].astype(int)
            lst = (utc + dd.longitude * 4) % 1440          # local solar time removes fire-location shifts
            rows.append({"sensor": name, "year": y,
                         "version": {k: int(v) for k, v in d.version.value_counts().items()},
                         "median_day_acq_time_utc": hhmm(utc.median()),
                         "median_day_local_solar_time": hhmm(lst.median()),
                         "median_day_local_solar_min": float(lst.median()),
                         "iqr_day_local_solar_time": [hhmm(lst.quantile(0.25)), hhmm(lst.quantile(0.75))]})
    return rows


def backcast_overpass_check(diag):
    """Does Aqua's 2003-2011 overpass time match the 2012-2019 training years?"""
    aq = {r["year"]: r["median_day_local_solar_min"] for r in diag if r["sensor"] == "MODIS Aqua"}
    tr = [aq[y] for y in range(TRAIN[0], TRAIN[1] + 1)]
    bc = [aq[y] for y in range(MODIS_YEARS[0], BACKCAST_END + 1)]
    ref = float(np.mean(tr))
    tr_dev = max(abs(v - ref) for v in tr)
    bc_dev = {y: round(aq[y] - ref, 1) for y in range(MODIS_YEARS[0], BACKCAST_END + 1)}
    tol = max(5.0, tr_dev)                              # minutes
    ok = max(abs(v) for v in bc_dev.values()) <= tol
    return {"training_2012_2019_mean": hhmm(ref), "training_year_range": [hhmm(min(tr)), hhmm(max(tr))],
            "backcast_2003_2011_range": [hhmm(min(bc)), hhmm(max(bc))],
            "backcast_minus_training_minutes_by_year": bc_dev,
            "tolerance_minutes": tol, "drift_2025_minus_training_minutes": round(aq[2025] - ref, 1),
            "verdict": "confirmed" if ok else "refuted"}


def known_limitations(nat, q_lo, live_info):
    diag = sensor_diagnostics()
    bchk = backcast_overpass_check(diag)
    ann = nat[nat.year.between(*TEST)].groupby("year")[["VIIRS", "pred"]].sum()
    err = {int(y): round(float((r.pred - r.VIIRS) / r.VIIRS * 100), 1) for y, r in ann.iterrows()}
    return [
        {"id": "aqua_overpass_drift",
         "finding": "MODIS Aqua's median daytime overpass is stable at ~13:52-13:57 local solar time through "
                    "2022, then moves later: 14:09 (2023), 14:31 (2024), 15:02 (2025). VIIRS S-NPP stays at "
                    "13:46-13:54 throughout. No change around 2020; the drift begins in 2023 and accelerates "
                    "through 2024-2025.",
         "impact": "Model b was fitted with both sensors at ~13:50. From 2023 MODIS samples a later part of "
                   "the diurnal fire cycle, so the MODIS-VIIRS relation is not the trained one. This is "
                   "consistent with (not proven to cause) model b over-predicting 2024 and 2025 "
                   "(annual error % by year, scored months: " + json.dumps(err) + "). Affects gap-filled "
                   "months from 2023 (2024-07, 2026-07). Does not affect the 2003-2011 back-cast or 2012-2022 values.",
         "action": "None taken (diagnostic only, no refit)."},
        {"id": "modis_version_change",
         "finding": "MODIS version field: 6.2 (2012-2017), 6.03 (2018-2022), 61.03 (2023-2025). VIIRS "
                    "version is 2 in every year 2012-2025. No version change around 2020 or 2024; the MODIS "
                    "change in 2023 coincides with the start of the overpass drift, so the two cannot be "
                    "separated with this data.",
         "action": "None taken."},
        {"id": "backcast_overpass_assumption",
         "finding": (f"Aqua's median daytime overpass in 2003-2011 ranges {bchk['backcast_2003_2011_range'][0]}-"
                     f"{bchk['backcast_2003_2011_range'][1]} local solar time vs "
                     f"{bchk['training_year_range'][0]}-{bchk['training_year_range'][1]} in the 2012-2019 "
                     f"training years (mean {bchk['training_2012_2019_mean']}). Largest yearly difference "
                     f"{max(abs(v) for v in bchk['backcast_minus_training_minutes_by_year'].values()):.0f} min, "
                     f"tolerance {bchk['tolerance_minutes']:.0f} min; for scale the 2025 drift is "
                     f"{bchk['drift_2025_minus_training_minutes']:+.0f} min. Assumption "
                     f"{bchk['verdict'].upper()}."),
         "check": bchk},
        {"id": "gapfill_2024_07",
         "finding": "Gap-filled month 2024-07 (harmonized 6,533 vs raw VIIRS 3,773 over an 11-day outage) "
                    "is likely high, drift period: model b over-predicts the surrounding 2024 months "
                    "(Jun +32%, Aug +23%, Sep +25%) while Aqua's overpass has drifted to ~14:31.",
         "status": "likely high, drift period", "action": "None taken (no refit)."},
        *live_limitations(nat, q_lo, live_info),
        {"id": "cell_boundary_straddling",
         "finding": "A fire or burn scar that straddles a 0.1 deg cell boundary counts once in each cell it "
                    "touches, so one event can add more than one cell-day per day. Pixel footprints differ "
                    "(MODIS ~1 km, VIIRS 375 m), so the chance of straddling differs by sensor; model b absorbs "
                    "the average effect nationally but not event by event.",
         "action": "None taken; inherent to the gridded unit."},
        {"id": "diagnostic_table", "rows": diag},
    ]


def live_limitations(nat, q_lo, live_info):
    out = []
    by = nat.set_index(["year", "month"])
    for mstr in live_info["gap_filled"]:
        y, mo = map(int, mstr.split("-"))
        r = by.loc[(y, mo)]
        out.append({"id": f"gapfill_{y}_{mo:02d}",
                    "finding": f"Gap-filled live-year month {mstr} (harmonized {r.harmonized:,.0f}, 80% "
                               f"{r.lo80:,.0f}-{r.hi80:,.0f}, vs raw VIIRS {r.VIIRS:,.0f}). S-NPP coverage missing "
                               f"on {', '.join(live_info['confirmed_days'][mstr])} (zero S-NPP rows worldwide, "
                               f"NOAA-20 present). This is a drift-period estimate, model b runs high since 2023.",
                    "status": "drift-period estimate, model b runs high since 2023",
                    "action": "None taken (no refit)."})
    for g in live_info["under_threshold"]:
        y, mo = map(int, g["month"].split("-"))
        r = by.loc[(y, mo)]
        out.append({"id": f"live_{y}_{mo:02d}_missing_viirs_days",
                    "finding": f"{g['month']} has {g['gap_days']} days without S-NPP data "
                               f"({', '.join(g['dates'])}; confirmed missing coverage: {g['confirmed']}), under "
                               f"the >{GAP_DAYS_MAX}-day threshold, so it is not gap-flagged or filled. raw VIIRS "
                               f"{r.VIIRS:,.0f} is under-counted by roughly the activity on those days "
                               f"(model b from MODIS: {r.pred:,.0f}, which itself runs high since 2023).",
                    "action": "None taken (below threshold)."})
    return out


def fit_b(df):
    X = np.column_stack([np.ones(len(df)), np.log1p(df.MODIS)])
    return np.linalg.lstsq(X, np.log1p(df.VIIRS), rcond=None)[0]


def predict_b(coef, modis):
    return np.expm1(coef[0] + coef[1] * np.log1p(modis))


def main():
    # ---------------- gap flags ------------------------------------------
    t2g = pd.read_csv(T2 / "gap_days_per_month.csv")
    t2g = t2g[t2g.gap_days > GAP_DAYS_MAX]
    early_days, early = early_aqua_gaps()
    early_fl = early[early.gap_days > GAP_DAYS_MAX]
    flag_list = ([{"year": int(r.year), "month": int(r.month), "sensor_missing": r.sensor_missing,
                   "reference": "VIIRS" if r.sensor_missing == "MODIS" else "MODIS Aqua", "gap_days": int(r.gap_days)}
                  for r in t2g.itertuples()]
                 + [{"year": int(r.year), "month": int(r.month), "sensor_missing": "MODIS",
                     "reference": "MODIS Terra", "gap_days": int(r.gap_days)} for r in early_fl.itertuples()])
    flagged = {(f["year"], f["month"]) for f in flag_list}
    viirs_gap = {(f["year"], f["month"]) for f in flag_list if f["sensor_missing"] == "VIIRS"}
    train_excl = set(map(tuple, t2g[["year", "month"]].values))   # Task 2 exclusions, unchanged

    spans = {}
    m = cell_days("MODIS", MODIS_YEARS, spans)
    v = cell_days("VIIRS", VIIRS_YEARS, spans)
    comp = complete_months(spans, VIIRS_YEARS)
    c = pd.concat([m, v], axis=1).reset_index()

    # live year: keep complete months only; Task 2 gap rule; no gap-fill (harmonized = observed VIIRS)
    live_comp = {k for k in comp if k[0] == LIVE_YEAR}
    held_back = sorted({(y, mo) for y, mo in zip(c.year, c.month) if y == LIVE_YEAR} - live_comp)
    c = c[(c.year != LIVE_YEAR) | pd.Series([k in live_comp for k in zip(c.year, c.month)], index=c.index)]
    lg = live.live_gaps(live_comp)
    lg_fl = lg[lg.gap_days > GAP_DAYS_MAX]
    flag_list += [{"year": int(r.year), "month": int(r.month), "sensor_missing": r.sensor_missing,
                   "reference": "VIIRS" if r.sensor_missing == "MODIS" else "MODIS Aqua",
                   "gap_days": int(r.gap_days), "live": True} for r in lg_fl.itertuples()]
    flagged = {(f["year"], f["month"]) for f in flag_list}
    nrt_set = (live.nrt_months("MODIS") | live.nrt_months("VIIRS")) & live_comp
    cov = live.snpp_coverage()
    missing_days = set(cov.date[cov.snpp_missing.astype(bool)])
    lv = lg[lg.sensor_missing == "VIIRS"]
    live_info = {"gap_filled": [], "flagged_not_filled": [], "confirmed_days": {}, "under_threshold": []}
    live_fill = set()
    for r in lv.itertuples():
        mstr, ok = f"{r.year}-{r.month:02d}", all(d in missing_days for d in r.dates)
        if r.gap_days > GAP_DAYS_MAX:
            if ok:
                live_fill.add((r.year, r.month))
                live_info["gap_filled"].append(mstr)
                live_info["confirmed_days"][mstr] = list(r.dates)
            else:
                live_info["flagged_not_filled"].append(mstr)
        elif r.gap_days == GAP_DAYS_MAX:
            live_info["under_threshold"].append({"month": mstr, "gap_days": int(r.gap_days),
                                                 "dates": list(r.dates), "confirmed": bool(ok)})

    # ---------------- national daytime monthly ---------------------------
    nat = c[c.daynight == "D"].groupby(["year", "month"])[["MODIS", "VIIRS"]].sum(min_count=1)
    idx = [(y, mo) for y in MODIS_YEARS for mo in range(1, 13) if y != LIVE_YEAR or (y, mo) in live_comp]
    nat = nat.reindex(pd.MultiIndex.from_tuples(idx, names=["year", "month"])).reset_index()
    nat["MODIS"] = nat.MODIS.fillna(0)
    nat.loc[nat.year >= VIIRS_YEARS[0], "VIIRS"] = nat.VIIRS[nat.year >= VIIRS_YEARS[0]].fillna(0)
    ym = list(zip(nat.year, nat.month))
    nat["gap_flag"] = [k in flagged for k in ym]
    nat["excluded"] = [k in train_excl for k in ym]
    nat["complete"] = [k in comp or y <= BACKCAST_END for k, y in zip(ym, nat.year)]
    nat["nrt"] = [k in nrt_set for k in ym]

    t2 = pd.read_csv(T2 / "monthly_celldays_day.csv")
    chk = nat.merge(t2, on=["year", "month"])
    assert (chk.MODIS == chk.modis_celldays_D).all() and (chk.VIIRS == chk.viirs_celldays_D).all(), \
        "national daytime totals differ from Task 2"

    # ---------------- model b + intervals --------------------------------
    trm = nat.year.between(*TRAIN) & ~nat.excluded
    coef = fit_b(nat[trm])
    a, b = coef
    assert abs(a - TASK2_PARAMS[0]) < 1e-3 and abs(b - TASK2_PARAMS[1]) < 1e-4, (a, b)
    nat["pred"] = predict_b(coef, nat.MODIS)
    lres = np.log1p(nat.VIIRS) - np.log1p(nat.pred)

    q_in = np.quantile(lres[trm], PI)
    loyo = pd.Series(np.nan, index=nat.index)
    for y in range(TRAIN[0], TRAIN[1] + 1):
        held = trm & (nat.year == y)
        cy = fit_b(nat[trm & (nat.year != y)])
        loyo[held] = np.log1p(nat.VIIRS[held]) - np.log1p(predict_b(cy, nat.MODIS[held]))
        nat.loc[held, "pred_loyo"] = predict_b(cy, nat.MODIS[held])
    q_lo = np.quantile(loyo[trm], PI)
    ann_tr = nat[trm].groupby("year")[["VIIRS", "pred", "pred_loyo"]].sum()
    aq_in = np.quantile(np.log(ann_tr.VIIRS / ann_tr.pred), PI)
    aq_lo = np.quantile(np.log(ann_tr.VIIRS / ann_tr.pred_loyo), PI)

    tem = nat.year.between(*TEST) & ~nat.gap_flag & nat.complete
    te = nat[tem]
    ann_te = te.groupby("year")[["VIIRS", "MODIS", "pred"]].sum()

    def cov_m(q):
        return float(((lres[tem] >= q[0]) & (lres[tem] <= q[1])).mean())

    def cov_a(q):
        r = np.log(ann_te.VIIRS / ann_te.pred)
        return float(((r >= q[0]) & (r <= q[1])).mean())

    intervals = {
        "in_sample": {"monthly_log_q10_q90": list(map(float, q_in)), "monthly_test_coverage": cov_m(q_in),
                      "annual_log_q10_q90": list(map(float, aq_in)), "annual_test_coverage": cov_a(aq_in)},
        "leave_one_year_out": {"monthly_log_q10_q90": list(map(float, q_lo)), "monthly_test_coverage": cov_m(q_lo),
                               "annual_log_q10_q90": list(map(float, aq_lo)), "annual_test_coverage": cov_a(aq_lo)},
        "nominal": 0.80, "test_months_n": int(tem.sum()), "test_years_n": len(ann_te)}

    # ---------------- harmonized national --------------------------------
    back = nat.year <= BACKCAST_END
    fill = pd.Series([(k in viirs_gap and k[0] != LIVE_YEAR) or k in live_fill for k in ym])
    model = back | fill
    nat["source"] = np.select([back, fill], ["backcast", "gapfill"], "observed")
    nat["harmonized"] = np.where(model, nat.pred, nat.VIIRS)
    lp = np.log1p(nat.pred)
    nat["lo80"] = np.where(model, np.expm1(lp + q_lo[0]), np.nan)
    nat["hi80"] = np.where(model, np.expm1(lp + q_lo[1]), np.nan)
    nat["factor"] = np.where(model, nat.pred / nat.MODIS.where(nat.MODIS > 0), np.nan)
    assert nat.factor[model].notna().all()

    # ---------------- cell table -----------------------------------------
    c = c.merge(nat[["year", "month", "factor", "source"]].rename(columns={"source": "msrc"}),
                on=["year", "month"], how="left")
    pre, isday = c.year <= BACKCAST_END, c.daynight == "D"
    modelled = isday & c.msrc.isin(["backcast", "gapfill"])
    c["raw_modis"] = c.MODIS.fillna(0).astype(float)
    c["raw_viirs"] = np.where(pre, np.nan, c.VIIRS.fillna(0))
    c["harmonized"] = np.where(modelled, c.raw_modis * c.factor, np.where(pre, np.nan, c.raw_viirs))
    c["source"] = np.where(modelled, c.msrc, "observed")
    c["gap_flag"] = [k in flagged for k in zip(c.year, c.month)]
    c["nrt"] = [k in nrt_set for k in zip(c.year, c.month)]
    c = c[(c.raw_modis > 0) | (c.raw_viirs.fillna(0) > 0)]
    c = c.astype({"year": "int16", "month": "int8"}).sort_values(["year", "month", "daynight", "lat", "lon"])
    assert not c.duplicated(["lat", "lon", "year", "month", "daynight"]).any()

    meta = {"unit": "active_cell_days_0.1deg", "calibration": CALIBRATION, "synthetic": "false",
            "calibration_detail": json.dumps({
                "model": "log1p(viirs) = a + b*log1p(modis)", "a": round(a, 6), "b": round(b, 6),
                "scope": "national monthly daytime cell-days, Argentina",
                "train": "2012-2019 excluding Task 2 gap-flagged months",
                "pi80": "leave-one-year-out residuals 2012-2019",
                "pi80_log_residual_q10_q90": [round(q_lo[0], 6), round(q_lo[1], 6)],
                "validation": "out/validation.json"}),
            "filters": "MODIS Aqua conf>=30; VIIRS S-NPP conf!=l; type==0 (NRT: type inferred from SP "
                       "static-source locations)", "country": "Argentina",
            "coverage": f"2003-01..{LIVE_YEAR}-{max(live_comp)[1]:02d}" if live_comp else f"2003-01..{ARCHIVE_END}-12",
            "contract": CONTRACT}
    tbl = pa.Table.from_pandas(c[SCHEMA.names], schema=SCHEMA, preserve_index=False)
    tbl = tbl.replace_schema_metadata({k.encode(): v.encode() for k, v in meta.items()})
    pq.write_table(tbl, OUT / "harmonized.parquet", compression="snappy")

    nm = nat.rename(columns={"MODIS": "raw_modis", "VIIRS": "raw_viirs"})[
        ["year", "month", "raw_modis", "raw_viirs", "harmonized", "lo80", "hi80", "source", "gap_flag", "nrt"]]
    nschema = pa.schema([("year", pa.int16(), False), ("month", pa.int8(), False), ("raw_modis", pa.float64()),
                         ("raw_viirs", pa.float64()), ("harmonized", pa.float64()), ("lo80", pa.float64()),
                         ("hi80", pa.float64()), ("source", pa.string(), False), ("gap_flag", pa.bool_(), False),
                         ("nrt", pa.bool_(), False)])
    nt = pa.Table.from_pandas(nm.astype({"year": "int16", "month": "int8"}), schema=nschema, preserve_index=False)
    nt = nt.replace_schema_metadata({**{k.encode(): v.encode() for k, v in meta.items()}, b"daynight": b"D"})
    pq.write_table(nt, OUT / "national_monthly.parquet", compression="snappy")

    # ---------------- checks ---------------------------------------------
    print(f"model b refit: a={a:.4f} b={b:.4f}")
    print(f"harmonized.parquet: {tbl.num_rows:,} rows; years {c.year.min()}-{c.year.max()}")
    print(c.groupby(["source", "daynight"]).size().to_frame("rows").to_markdown())

    rt = pq.read_table(OUT / "harmonized.parquet").to_pandas()
    s = rt[rt.daynight == "D"].groupby(["year", "month"]).harmonized.sum()
    n = nat.set_index(["year", "month"]).harmonized
    diff = (s.reindex(n.index).fillna(0) - n).abs()
    print(f"\nCHECK cell sum == national (day), all {len(n)} months: max |diff| = {diff.max():.2e}")
    assert diff.max() < 1e-6
    nn = rt[(rt.daynight == "N") & (rt.year <= BACKCAST_END)].harmonized
    assert nn.isna().all()
    ng = rt[(rt.daynight == "N") & (rt.source != "observed")]
    assert ng.empty, "night rows must stay observed"
    print("CHECK night: harmonized null pre-2012, never modelled: OK")

    # Task 2 scores reproduced
    t2s = pd.read_csv(T2 / "model_comparison.csv")
    t2s = t2s[t2s.split == "test"].set_index("model")
    scores = {}
    for name, col in [("raw_modis", "MODIS"), ("model_b", "pred")]:
        mo, an = score(te.VIIRS, te[col]), score(ann_te.VIIRS, ann_te[col])
        scores[name] = {"monthly": {"MAPE_pct": mo["MAPE_%"], "R2": mo["R2"], "bias_pct": mo["bias_%"]},
                        "annual": {"MAPE_pct": an["MAPE_%"], "R2": an["R2"], "bias_pct": an["bias_%"]}}
        ref = t2s.loc["raw_modis" if name == "raw_modis" else "b_power"]
        assert abs(ref["monthly_MAPE_%"] - mo["MAPE_%"]) < 1e-2 and abs(ref["annual_MAPE_%"] - an["MAPE_%"]) < 1e-2

    # model a (constant ratio, Task 2 definition) and model b, by orbit period; no refit
    r_a = float(nat.VIIRS[trm].sum() / nat.MODIS[trm].sum())
    assert abs(r_a - 2.754) < 1e-3, r_a
    nat["pred_a"] = r_a * nat.MODIS
    scores_by_period = {"definition": "test months only (complete, not gap-flagged); no refit",
                        "model_a_ratio": r_a}
    for label, (y0, y1), note in [("2020-2022", (2020, 2022), "stable Aqua orbit"),
                                  ("2023-2025", (2023, 2025), "Aqua overpass drift"),
                                  ("2020-2025", TEST, "all test years")]:
        pm = tem & nat.year.between(y0, y1)
        sub = nat[pm]
        an_ = sub.groupby("year")[["VIIRS", "pred_a", "pred"]].sum()
        block = {"note": note, "months_n": int(pm.sum()), "years_n": len(an_)}
        for mname, col in [("model_a", "pred_a"), ("model_b", "pred")]:
            mo, an = score(sub.VIIRS, sub[col]), score(an_.VIIRS, an_[col])
            block[mname] = {"monthly": {"MAPE_pct": mo["MAPE_%"], "R2": mo["R2"], "bias_pct": mo["bias_%"]},
                            "annual": {"MAPE_pct": an["MAPE_%"], "R2": an["R2"], "bias_pct": an["bias_%"]}}
        scores_by_period[label] = block
    allp = scores_by_period["2020-2025"]
    ra = t2s.loc["a_ratio"]
    assert abs(ra["monthly_MAPE_%"] - allp["model_a"]["monthly"]["MAPE_pct"]) < 1e-2
    assert abs(allp["model_b"]["monthly"]["MAPE_pct"] - scores["model_b"]["monthly"]["MAPE_pct"]) < 1e-9

    # join check 2012: observed (non-gap months) vs model b; annual LOYO band
    y12 = nat[(nat.year == 2012) & ~nat.gap_flag]
    step = float(np.log(y12.VIIRS.sum() / y12.pred.sum()))
    j = nat[nat.year.isin([2011, 2012])][["year", "month", "MODIS", "VIIRS", "pred", "harmonized", "lo80", "hi80",
                                          "source", "gap_flag"]]
    join = {"months_compared": [f"2012-{mo:02d}" for mo in y12.month],
            "observed_viirs": float(y12.VIIRS.sum()), "model_b": float(y12.pred.sum()),
            "difference_pct": float(np.expm1(step) * 100),
            "annual_band_pct": [float(np.expm1(aq_lo[0]) * 100), float(np.expm1(aq_lo[1]) * 100)],
            "band": "annual 80% leave-one-year-out", "pass": bool(aq_lo[0] <= step <= aq_lo[1]),
            "harmonized_annual_2011": float(nat[nat.year == 2011].harmonized.sum()),
            "harmonized_annual_2012": float(nat[nat.year == 2012].harmonized.sum())}

    filled = nat[nat.source == "gapfill"]
    validation = {
        "calibration": CALIBRATION, "contract": CONTRACT, "unit": meta["unit"], "daynight": "D",
        "model": {"form": "log1p(viirs) = a + b*log1p(modis)", "a": float(a), "b": float(b),
                  "train_years": list(range(TRAIN[0], TRAIN[1] + 1)),
                  "train_excluded_months": sorted(f"{y}-{mo:02d}" for y, mo in train_excl if TRAIN[0] <= y <= TRAIN[1])},
        "test_years": list(range(TEST[0], TEST[1] + 1)),
        "test_excluded_months": sorted(f"{y}-{mo:02d}" for y, mo in flagged if TEST[0] <= y <= TEST[1]),
        "test_complete_month_rule": "month lies within both sensors' first..last acq_date for the year",
        "acq_date_spans": {f"{s} {y}": [str(a.date()), str(b.date())] for (s, y), (a, b) in sorted(spans.items())},
        "incomplete_months": [f"{y}-{mo:02d}" for (y, mo) in sorted(set(ym) - comp) if y >= VIIRS_YEARS[0]],
        "live_year": {
            "year": LIVE_YEAR, "api": "FIRMS area API, bbox -74,-56,-53,-21, 5-day chunks; source per sensor "
                                      "from /api/data_availability (SP to its max_date, NRT after)",
            "fetch": live.fetch_summary(),
            "months_appended": [f"{y}-{mo:02d}" for y, mo in sorted(live_comp)],
            "months_held_back_incomplete": [f"{y}-{mo:02d}" for y, mo in held_back],
            "last_date_covered": f"{LIVE_YEAR}-{max(live_comp)[1]:02d}-"
                                 f"{pd.Period(f'{LIVE_YEAR}-{max(live_comp)[1]:02d}').days_in_month:02d}",
            "nrt_months": [f"{y}-{mo:02d}" for y, mo in sorted(nrt_set)],
            "nrt_months_by_sensor": {s: [f"{y}-{mo:02d}" for y, mo in sorted(live.nrt_months(s) & live_comp)]
                                     for s in ("MODIS", "VIIRS")},
            "gap_days_by_month": [{**{k: (int(v) if k != "dates" and k != "sensor_missing" else v)
                                      for k, v in r.items()}} for r in lg.to_dict("records")],
            "gap_filled": live_info["gap_filled"],
            "gap_flagged_not_filled": live_info["flagged_not_filled"],
            "missing_viirs_days_under_threshold": live_info["under_threshold"],
            "snpp_coverage_check": {
                "rule": "a live VIIRS-gap month is gap-filled only if every gap day has zero S-NPP rows worldwide "
                        "while NOAA-20 has rows (missing coverage, not a quiet day). /api/data_availability gives "
                        "only a min..max date per source (VIIRS_SNPP_SP 2012-01-20..2026-07-31), so it cannot show "
                        "days missing inside the range.",
                "file": f"pipeline/ref/snpp_coverage_{LIVE_YEAR}.csv",
                "days": cov.to_dict("records")},
            "clip": {"method": "point in Natural Earth 10m Argentina polygon (pipeline/ref/argentina_ne10m.geojson)",
                     "validation_2019_vs_country_archive": {"MODIS_annual_celldays_pct": 0.0,
                                                            "VIIRS_annual_celldays_pct": -0.01,
                                                            "VIIRS_worst_month_pct": -0.12,
                                                            "unclipped_bbox_pct": {"MODIS": 90.6, "VIIRS": 99.4}}},
            "static_sources": {
                "SP_rows": "FIRMS type field, type==0 kept (same as archive)",
                "NRT_rows": "no type field; type=2 assigned when the detection falls on a grid cell where SP data "
                            "recorded type 1/2/3 (archive + 2026 SP); grid 0.005 deg VIIRS, 0.01 deg MODIS",
                "validation_residual_celldays_pct": {"VIIRS": {"2025": -0.14, "2026_SP": 0.78},
                                                     "MODIS": {"2025": 0.59, "2026_SP": 1.06}},
                "no_filter_celldays_pct": {"VIIRS": {"2025": 1.65, "2026_SP": 3.87},
                                           "MODIS": {"2025": 2.83, "2026_SP": 5.36}}},
            "not_in_scoring": "Live-year months are not part of the test set."},
        "latest_complete_month": f"{LIVE_YEAR}-{max(live_comp)[1]:02d}",
        "scores_test": scores,
        "scores_by_period": scores_by_period,
        "interval_80": intervals,
        "join_check_2012": join,
        "gap_flagged_months": sorted(({**f, "month_str": f"{f['year']}-{f['month']:02d}"} for f in flag_list),
                                     key=lambda f: (f["year"], f["month"])),
        "gap_filled_months": [{"month": f"{r.year}-{r.month:02d}", "raw_viirs": float(r.VIIRS),
                               "harmonized": float(r.harmonized), "lo80": float(r.lo80), "hi80": float(r.hi80)}
                              for r in filled.itertuples()],
        "notes": ["Scores exclude all gap-flagged months.",
                  "Back-cast and gap-fill lo80/hi80 use the leave-one-year-out interval.",
                  "Training (2012-2019) and model b coefficients unchanged when 2025 was added; back-cast values identical.",
                  "Live year: harmonized = observed VIIRS, except VIIRS-gap months whose missing days are "
                  "confirmed as missing S-NPP coverage, which are gap-filled with model b."],
        "known_limitations": known_limitations(nat, q_lo, live_info)}
    (OUT / "validation.json").write_text(json.dumps(validation, indent=2))

    print("\nEARLY AQUA GAP CHECK 2003-2011 (Aqua zero rows, Terra has rows), all months with >=1 day\n")
    print(early.drop(columns="dates").to_markdown(index=False))
    print("\nflagged:", early_fl[["year", "month", "gap_days", "dates"]].to_dict("records"))
    print("\nINTERVALS\n" + json.dumps(intervals, indent=1))
    print("\nJOIN YEARS\n\n" + j.round(0).to_markdown(index=False))
    print("\nJOIN CHECK\n" + json.dumps(join, indent=1))
    print("\nGAP-FILLED\n" + json.dumps(validation["gap_filled_months"], indent=1))
    print("\nSCORES\n" + json.dumps(scores, indent=1))
    print("\nSCORES BY PERIOD\n" + json.dumps(scores_by_period, indent=1))

    chart(nat)


def chart(nat):
    x = pd.to_datetime(dict(year=nat.year, month=nat.month, day=15))
    fig, ax = plt.subplots(figsize=(14, 5.2), facecolor=SURFACE)
    style(ax)
    back, fill = nat.source == "backcast", nat.source == "gapfill"
    ax.axvspan(x[back].min() - pd.Timedelta(days=15), x[back].max() + pd.Timedelta(days=16),
               color=GRID, alpha=0.35, lw=0)
    ax.fill_between(x[back], nat.lo80[back], nat.hi80[back], color=VIIRS_C, alpha=0.18, lw=0,
                    label="80% prediction interval (modelled months)")
    for xi, lo, hi in zip(x[fill], nat.lo80[fill], nat.hi80[fill]):
        ax.vlines(xi, lo, hi, color=VIIRS_C, alpha=0.35, lw=6)
    ax.plot(x, nat.harmonized, color=VIIRS_C, lw=2, label="Harmonized (VIIRS-equivalent)")
    ax.plot(x, nat.VIIRS, color=INK, lw=0, marker="o", ms=3, label="Raw VIIRS S-NPP")
    ax.plot(x, nat.MODIS, color=MODIS_C, lw=1.5, label="Raw MODIS Aqua")
    nr = nat.nrt
    if nr.any():
        ax.axvspan(x[nr].min() - pd.Timedelta(days=15), x[nr].max() + pd.Timedelta(days=16),
                   color=MODIS_C, alpha=0.10, lw=0, label="NRT (provisional) months")
    g = nat.gap_flag
    ax.plot(x[g], nat.harmonized[g], "o", mfc="none", mec=MUTED, ms=9, mew=1.5, label="Gap-flagged month")
    ax.plot(x[fill], nat.harmonized[fill], "D", color=VIIRS_C, mec=SURFACE, mew=1.5, ms=7,
            label="Gap-filled (model b)")
    ax.text(x[back].min(), ax.get_ylim()[1] * 0.97, "  back-cast from MODIS", va="top", fontsize=9, color=INK2)
    ax.text(x[~back].min(), ax.get_ylim()[1] * 0.97, "  observed VIIRS", va="top", fontsize=9, color=INK2)
    ax.axvline(pd.Timestamp("2012-01-01"), color=BASE, lw=1)
    ax.set_ylabel("daytime active 0.1° cell-days per month", color=INK2)
    ax.set_xlim(x.min() - pd.Timedelta(days=60), x.max() + pd.Timedelta(days=60))
    ax.legend(frameon=False, fontsize=9, loc="upper center", labelcolor=INK, bbox_to_anchor=(0.5, -0.07), ncol=4)
    ax.set_title(f"Argentina national daytime fire activity, 2003–{nat.year.max()}-{nat.month[nat.year == nat.year.max()].max():02d} (model b, calibration model_b_v1)",
                 loc="left", fontsize=12, color=INK)
    fig.tight_layout()
    fig.savefig(OUT / "chart_national_series.png", dpi=150, facecolor=SURFACE)
    plt.close(fig)


if __name__ == "__main__":
    main()
