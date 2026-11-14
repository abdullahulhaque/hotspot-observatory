"""Tasks 3-4: back-cast 2003-2011 and gap-fill VIIRS gaps with model b; write outputs.

Model b (approved): log1p(VIIRS) = a + b*log1p(MODIS), national monthly daytime
active 0.1-degree cell-days, fitted 2012-2019 excluding gap-flagged months.
Refitted here from the same inputs and checked against Task 2's parameters.

harmonized (day):  2003-2011 back-cast; VIIRS-gap months gap-filled; else raw_viirs.
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
                         VIIRS_C, cell, load_year, score, style)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out"
T2 = OUT / "task2"
MODIS_YEARS = range(2003, 2025)
VIIRS_YEARS = range(2012, 2025)
BACKCAST_END, TRAIN = 2011, (2012, 2019)
TEST = (2020, 2024)
TASK2_PARAMS = (1.662, 0.9141)
CALIBRATION = "model_b_v1"
CONTRACT = "harmonized_schema v0.3"

SCHEMA = pa.schema([("lat", pa.float64(), False), ("lon", pa.float64(), False),
                    ("year", pa.int16(), False), ("month", pa.int8(), False),
                    ("daynight", pa.string(), False), ("raw_modis", pa.float64()),
                    ("raw_viirs", pa.float64()), ("harmonized", pa.float64()),
                    ("source", pa.string(), False), ("gap_flag", pa.bool_(), False)])


def cell_days(sensor, years):
    parts = []
    for y in years:
        df = load_year(sensor, y)
        if df is None:
            raise FileNotFoundError(f"{sensor} {y} not on disk")
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

    m = cell_days("MODIS", MODIS_YEARS)
    v = cell_days("VIIRS", VIIRS_YEARS)
    c = pd.concat([m, v], axis=1).reset_index()

    # ---------------- national daytime monthly ---------------------------
    nat = c[c.daynight == "D"].groupby(["year", "month"])[["MODIS", "VIIRS"]].sum(min_count=1)
    nat = nat.reindex(pd.MultiIndex.from_product([MODIS_YEARS, range(1, 13)], names=["year", "month"])).reset_index()
    nat["MODIS"] = nat.MODIS.fillna(0)
    nat.loc[nat.year >= VIIRS_YEARS[0], "VIIRS"] = nat.VIIRS[nat.year >= VIIRS_YEARS[0]].fillna(0)
    ym = list(zip(nat.year, nat.month))
    nat["gap_flag"] = [k in flagged for k in ym]
    nat["excluded"] = [k in train_excl for k in ym]

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

    tem = nat.year.between(*TEST) & ~nat.gap_flag
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
    fill = pd.Series([k in viirs_gap for k in ym])
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
            "filters": "MODIS Aqua conf>=30; VIIRS S-NPP conf!=l; type==0", "country": "Argentina",
            "contract": CONTRACT}
    tbl = pa.Table.from_pandas(c[SCHEMA.names], schema=SCHEMA, preserve_index=False)
    tbl = tbl.replace_schema_metadata({k.encode(): v.encode() for k, v in meta.items()})
    pq.write_table(tbl, OUT / "harmonized.parquet", compression="snappy")

    nm = nat.rename(columns={"MODIS": "raw_modis", "VIIRS": "raw_viirs"})[
        ["year", "month", "raw_modis", "raw_viirs", "harmonized", "lo80", "hi80", "source", "gap_flag"]]
    nschema = pa.schema([("year", pa.int16(), False), ("month", pa.int8(), False), ("raw_modis", pa.float64()),
                         ("raw_viirs", pa.float64()), ("harmonized", pa.float64()), ("lo80", pa.float64()),
                         ("hi80", pa.float64()), ("source", pa.string(), False), ("gap_flag", pa.bool_(), False)])
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
        "scores_test": scores,
        "interval_80": intervals,
        "join_check_2012": join,
        "gap_flagged_months": sorted(({**f, "month_str": f"{f['year']}-{f['month']:02d}"} for f in flag_list),
                                     key=lambda f: (f["year"], f["month"])),
        "gap_filled_months": [{"month": f"{r.year}-{r.month:02d}", "raw_viirs": float(r.VIIRS),
                               "harmonized": float(r.harmonized), "lo80": float(r.lo80), "hi80": float(r.hi80)}
                              for r in filled.itertuples()],
        "notes": ["Scores exclude all gap-flagged months.",
                  "Back-cast and gap-fill lo80/hi80 use the leave-one-year-out interval.",
                  "VIIRS 2025 not on disk; test years end 2024."]}
    (OUT / "validation.json").write_text(json.dumps(validation, indent=2))

    print("\nEARLY AQUA GAP CHECK 2003-2011 (Aqua zero rows, Terra has rows), all months with >=1 day\n")
    print(early.drop(columns="dates").to_markdown(index=False))
    print("\nflagged:", early_fl[["year", "month", "gap_days", "dates"]].to_dict("records"))
    print("\nINTERVALS\n" + json.dumps(intervals, indent=1))
    print("\nJOIN YEARS\n\n" + j.round(0).to_markdown(index=False))
    print("\nJOIN CHECK\n" + json.dumps(join, indent=1))
    print("\nGAP-FILLED\n" + json.dumps(validation["gap_filled_months"], indent=1))
    print("\nSCORES\n" + json.dumps(scores, indent=1))

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
    g = nat.gap_flag
    ax.plot(x[g], nat.harmonized[g], "o", mfc="none", mec=MUTED, ms=9, mew=1.5, label="Gap-flagged month")
    ax.plot(x[fill], nat.harmonized[fill], "D", color=VIIRS_C, mec=SURFACE, mew=1.5, ms=7,
            label="Gap-filled (model b)")
    ax.text(x[back].min(), ax.get_ylim()[1] * 0.97, "  back-cast from MODIS", va="top", fontsize=9, color=INK2)
    ax.text(x[~back].min(), ax.get_ylim()[1] * 0.97, "  observed VIIRS", va="top", fontsize=9, color=INK2)
    ax.axvline(pd.Timestamp("2012-01-01"), color=BASE, lw=1)
    ax.set_ylabel("daytime active 0.1° cell-days per month", color=INK2)
    ax.set_xlim(x.min() - pd.Timedelta(days=60), x.max() + pd.Timedelta(days=60))
    ax.legend(frameon=False, fontsize=9, loc="upper center", labelcolor=INK, bbox_to_anchor=(0.5, -0.07), ncol=6)
    ax.set_title("Argentina national daytime fire activity, 2003–2024 (model b, calibration model_b_v1)",
                 loc="left", fontsize=12, color=INK)
    fig.tight_layout()
    fig.savefig(OUT / "chart_national_series.png", dpi=150, facecolor=SURFACE)
    plt.close(fig)


if __name__ == "__main__":
    main()
