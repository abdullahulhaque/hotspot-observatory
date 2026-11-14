"""Task 2: calibration and validation, MODIS Aqua -> VIIRS S-NPP, Argentina.

Approved settings (Task 1): MODIS Aqua conf >= 30, VIIRS S-NPP conf != low,
type 0, unit = active 0.1-degree cell-days, daytime only. Night is not modelled.

Train 2012-2019, test 2020+ (whatever years are on disk). No back-cast.
Usage: .venv/bin/python pipeline/calibration.py
Writes to out/task2/.
"""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import BoundaryNorm, ListedColormap
from matplotlib.patches import Rectangle
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out" / "task2"
COUNTRY = "Argentina"
CELL, BLOCK = 0.1, 2.0
YEARS = range(2012, 2026)
TRAIN_END = 2019
GAP_DAYS_MAX = 3          # month flagged if > this many gap days
MIN_NONZERO_MONTHS = 12   # model d: per-block fit needs this many months with M>0 and V>0
PI = (0.10, 0.90)

VIIRS_C, MODIS_C = "#2a78d6", "#eb6834"
INK, INK2, MUTED, GRID, BASE, SURFACE = "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7", "#fcfcfb"
SEQ = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]
MODELS = ["a_ratio", "b_power", "c_power_month", "d_block_power"]
LABEL = {"raw_modis": "Raw MODIS (no correction)", "a_ratio": "a. Constant ratio",
         "b_power": "b. Power law (national)", "c_power_month": "c. Power law + month",
         "d_block_power": "d. Power law per 2° block"}


# ---------------------------------------------------------------- load ----
def cell(x):
    return (np.floor(x / CELL) * CELL + CELL / 2).round(2)


def block(x):
    return np.floor(x / BLOCK) * BLOCK


def load_year(sensor, year):
    p = (ROOT / f"modis/{year}/modis_{year}_{COUNTRY}.csv" if sensor == "MODIS"
         else ROOT / f"viirs-snpp/{year}/viirs-snpp_{year}_{COUNTRY}.csv")
    if not p.exists():
        return None
    df = pd.read_csv(p, usecols=["latitude", "longitude", "acq_date", "satellite",
                                 "confidence", "daynight", "type"],
                     dtype={"confidence": str, "satellite": str})
    df = df[df.satellite == ("Aqua" if sensor == "MODIS" else "N")]
    df["date"] = pd.to_datetime(df.acq_date)
    return df


def build():
    daily, cells, present, spans = [], [], {}, {}
    for sensor in ["MODIS", "VIIRS"]:
        present[sensor] = []
        for y in YEARS:
            df = load_year(sensor, y)
            if df is None:
                continue
            present[sensor].append(y)
            spans[(sensor, y)] = (df.date.min(), df.date.max())
            # any row of the satellite counts for outage detection
            daily.append(df.groupby("date").size().rename("rows").reset_index().assign(sensor=sensor))
            if sensor == "MODIS":
                keep = pd.to_numeric(df.confidence) >= 30
            else:
                keep = df.confidence.str.lower() != "l"
            d = df[keep & (df.type == 0) & (df.daynight == "D")].copy()
            d["clat"], d["clon"] = cell(d.latitude), cell(d.longitude)
            d = d.drop_duplicates(["date", "clat", "clon"])
            d["blat"], d["blon"] = block(d.latitude), block(d.longitude)
            d["year"], d["month"] = d.date.dt.year, d.date.dt.month
            cells.append(d.groupby(["year", "month", "blat", "blon"]).size()
                         .rename("cd").reset_index().assign(sensor=sensor))
    return pd.concat(daily), pd.concat(cells), present, spans


def complete_months(spans, years):
    """(year, month) pairs fully inside both sensors' first..last acq_date for that year."""
    out = set()
    for y in years:
        lo = max(spans[(s, y)][0] for s in ("MODIS", "VIIRS"))
        hi = min(spans[(s, y)][1] for s in ("MODIS", "VIIRS"))
        for m in range(1, 13):
            start = pd.Timestamp(y, m, 1)
            if start >= lo and start + pd.offsets.MonthEnd(0) <= hi:
                out.add((y, m))
    return out


# ---------------------------------------------------------------- gaps ----
def find_gaps(daily, present):
    w = daily.pivot_table(index="date", columns="sensor", values="rows", fill_value=0)
    both = sorted(set(present["MODIS"]) & set(present["VIIRS"]))
    idx = pd.date_range(f"{both[0]}-01-01", f"{both[-1]}-12-31")
    w = w.reindex(idx, fill_value=0).rename_axis("date")
    rows = []
    for s, o in [("MODIS", "VIIRS"), ("VIIRS", "MODIS")]:
        g = w[(w[s] == 0) & (w[o] > 0)]
        rows.append(pd.DataFrame({"date": g.index, "sensor_missing": s, "other_rows": g[o].values}))
    gaps = pd.concat(rows, ignore_index=True)
    gaps["year"], gaps["month"] = gaps.date.dt.year, gaps.date.dt.month
    per_month = gaps.groupby(["sensor_missing", "year", "month"]).size().rename("gap_days").reset_index()
    flagged = per_month[per_month.gap_days > GAP_DAYS_MAX]
    return gaps, per_month, flagged, w


# -------------------------------------------------------------- models ----
def ols(X, y):
    X1 = np.column_stack([np.ones(len(X)), X])
    beta, *_ = np.linalg.lstsq(X1, y, rcond=None)
    return beta


def month_dummies(m):
    return np.column_stack([(m == k).astype(float) for k in range(2, 13)])


def fit_predict(nat, blk, train_mask_nat):
    tr, te = nat[train_mask_nat], nat
    out = pd.DataFrame(index=nat.index)
    out["raw_modis"] = nat.modis

    r = tr.viirs.sum() / tr.modis.sum()
    out["a_ratio"] = r * nat.modis

    xb, yb = np.log1p(tr.modis.values), np.log1p(tr.viirs.values)
    bb = ols(xb, yb)
    out["b_power"] = np.expm1(bb[0] + bb[1] * np.log1p(nat.modis.values))

    Xc = np.column_stack([xb, month_dummies(tr.month.values)])
    bc = ols(Xc, yb)
    Xall = np.column_stack([np.log1p(nat.modis.values), month_dummies(nat.month.values)])
    out["c_power_month"] = np.expm1(bc[0] + Xall @ bc[1:])

    # d: per-block power law on the block x month panel
    btr = blk[blk.train]
    pooled = ols(np.log1p(btr.modis.values), np.log1p(btr.viirs.values))
    coefs, info = {}, []
    for key, g in btr.groupby(["blat", "blon"]):
        nz = int(((g.modis > 0) & (g.viirs > 0)).sum())
        if nz >= MIN_NONZERO_MONTHS:
            coefs[key] = ols(np.log1p(g.modis.values), np.log1p(g.viirs.values))
            src = "own"
        else:
            src = "fallback"
        info.append({"blat": key[0], "blon": key[1], "nonzero_months": nz, "fit": src,
                     "train_modis": g.modis.sum(), "train_viirs": g.viirs.sum()})
    keys = list(zip(blk.blat, blk.blon))
    a = np.array([coefs.get(k, pooled)[0] for k in keys])
    b = np.array([coefs.get(k, pooled)[1] for k in keys])
    blk = blk.assign(pred=np.expm1(a + b * np.log1p(blk.modis.values)))
    out["d_block_power"] = blk.groupby(["year", "month"]).pred.sum().reindex(list(zip(nat.year, nat.month))).values
    params = {"a_ratio": {"r": r}, "b_power": {"a": bb[0], "b": bb[1]},
              "c_power_month": {"a": bc[0], "b": bc[1], **{f"m{k}": v for k, v in zip(range(2, 13), bc[2:])}},
              "d_block_power": {"pooled_a": pooled[0], "pooled_b": pooled[1],
                                "blocks_own": len(coefs),
                                "blocks_fallback": sum(i["fit"] == "fallback" for i in info)}}
    return out, params, pd.DataFrame(info)


# ------------------------------------------------------------- scoring ----
def score(act, pred):
    act, pred = np.asarray(act, float), np.asarray(pred, float)
    return {"MAPE_%": np.mean(np.abs(pred - act) / act) * 100,
            "R2": 1 - np.sum((act - pred) ** 2) / np.sum((act - act.mean()) ** 2),
            "bias_%": (pred.sum() - act.sum()) / act.sum() * 100}


def evaluate(nat, preds, use):
    rows = []
    for split, mask in [("train 2012-2019", use & (nat.year <= TRAIN_END)),
                        ("test", use & (nat.year > TRAIN_END))]:
        sub, p = nat[mask], preds[mask]
        ann = sub.assign(**p).groupby("year")[["viirs", *p.columns]].sum()
        for m in p.columns:
            mo, an = score(sub.viirs, p[m]), score(ann.viirs, ann[m])
            rows.append({"split": split, "model": m,
                         "monthly_MAPE_%": mo["MAPE_%"], "monthly_R2": mo["R2"], "monthly_bias_%": mo["bias_%"],
                         "annual_MAPE_%": an["MAPE_%"], "annual_R2": an["R2"], "annual_bias_%": an["bias_%"]})
    return pd.DataFrame(rows)


def intervals(nat, preds, use, model):
    tr = use & (nat.year <= TRAIN_END)
    res = np.log1p(nat.viirs[tr]) - np.log1p(preds[model][tr])
    qlo, qhi = np.quantile(res, PI)
    lp = np.log1p(preds[model])
    mon = pd.DataFrame({"year": nat.year, "month": nat.month, "actual": nat.viirs, "used": use,
                        "pred": preds[model], "lo80": np.expm1(lp + qlo), "hi80": np.expm1(lp + qhi)})
    # annual: year-block residuals (keeps within-year correlation); 8 draws -> rough
    a = nat[use].assign(p=preds[model][use]).groupby("year")[["viirs", "p"]].sum()
    ares = np.log(a.viirs / a.p)
    aq = np.quantile(ares[a.index <= TRAIN_END], PI)
    ann = pd.DataFrame({"actual": a.viirs, "pred": a.p,
                        "lo80": a.p * np.exp(aq[0]), "hi80": a.p * np.exp(aq[1])})
    return mon, ann, (qlo, qhi), aq


# -------------------------------------------------------------- charts ----
def style(ax):
    ax.set_facecolor(SURFACE)
    ax.grid(axis="y", color=GRID, lw=0.8)
    ax.tick_params(colors=INK2, length=0)
    for k, sp in ax.spines.items():
        sp.set_visible(k == "bottom")
        sp.set_color(BASE)
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda x, _: f"{x:,.0f}"))


def chart_pred(mon, best, path, test_years):
    t = mon[mon.year > TRAIN_END].reset_index(drop=True)
    x = pd.to_datetime(dict(year=t.year, month=t.month, day=15))
    fig, (ax, ax2) = plt.subplots(1, 2, figsize=(13, 4.8), facecolor=SURFACE,
                                  gridspec_kw={"width_ratios": [2.3, 1]})
    style(ax)
    ax.fill_between(x, t.lo80, t.hi80, color=VIIRS_C, alpha=0.15, lw=0, label="80% prediction interval")
    ax.plot(x, t.pred, color=VIIRS_C, lw=2, label=f"Predicted ({LABEL[best]})")
    u = t.used
    ax.plot(x[u], t.actual[u], "o", color=INK, ms=4, label="Actual VIIRS")
    if (~u).any():
        ax.plot(x[~u], t.actual[~u], "o", mfc="none", mec=MUTED, ms=6, label="Actual, gap-flagged (not scored)")
    ax.set_ylabel("daytime cell-days per month", color=INK2)
    ax.legend(frameon=False, fontsize=9, loc="upper right", labelcolor=INK)
    ax.set_title(f"Held-out test {test_years}: predicted vs actual VIIRS", loc="left", fontsize=11, color=INK)
    style(ax2)
    ax2.grid(axis="x", color=GRID, lw=0.8)
    lim = [50, max(t.actual.max(), t.pred.max()) * 1.3]
    ax2.plot(lim, lim, color=BASE, lw=1)
    ax2.plot(t.pred[u], t.actual[u], "o", color=VIIRS_C, ms=5, mec=SURFACE, mew=1)
    ax2.set_xscale("log"); ax2.set_yscale("log")
    ax2.set_xlim(lim); ax2.set_ylim(lim)
    for a_ in (ax2.xaxis, ax2.yaxis):
        a_.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:,.0f}"))
    ax2.set_xlabel("predicted", color=INK2); ax2.set_ylabel("actual", color=INK2)
    ax2.set_title("Monthly, log scale (line = 1:1)", loc="left", fontsize=11, color=INK)
    fig.tight_layout(); fig.savefig(path, dpi=150, facecolor=SURFACE); plt.close(fig)


def chart_resid(nat, preds, use, path):
    fig, axes = plt.subplots(2, 2, figsize=(12, 7), sharey=True, sharex=True, facecolor=SURFACE)
    rng = np.random.default_rng(0)
    for ax, m in zip(axes.flat, MODELS):
        style(ax)
        ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:+.1f}"))
        res = np.log1p(nat.viirs) - np.log1p(preds[m])
        for split, col, off in [("train", MUTED, -0.18), ("test", VIIRS_C, 0.18)]:
            mk = use & ((nat.year <= TRAIN_END) if split == "train" else (nat.year > TRAIN_END))
            xm = nat.month[mk] + off + rng.uniform(-0.06, 0.06, mk.sum())
            ax.plot(xm, res[mk], "o", color=col, ms=4, alpha=0.8, label=split)
            med = res[mk].groupby(nat.month[mk]).median()
            ax.hlines(med.values, med.index + off - 0.14, med.index + off + 0.14, color=INK, lw=2)
        ax.axhline(0, color=BASE, lw=1)
        ax.set_title(LABEL[m], loc="left", fontsize=10.5, color=INK)
        ax.set_xticks(range(1, 13)); ax.set_xticklabels(list("JFMAMJJASOND"), color=INK2)
    axes[0, 0].legend(frameon=False, fontsize=9, labelcolor=INK, loc="lower left")
    for ax in axes[:, 0]:
        ax.set_ylabel("log residual (actual − pred)", color=INK2)
    fig.suptitle("Residuals by month of year (bar = median; +0.1 ≈ 10% under-prediction)",
                 x=0.06, ha="left", fontsize=12, color=INK)
    fig.tight_layout(); fig.savefig(path, dpi=150, facecolor=SURFACE); plt.close(fig)


def chart_blocks(btr, path):
    seasons = {"All months": range(1, 13), "Fire season Aug–Oct": [8, 9, 10],
               "Rest of year Nov–Jul": [11, 12, 1, 2, 3, 4, 5, 6, 7]}
    bounds = [0, 1.5, 2, 2.5, 3, 3.5, 4.5, 99]
    cmap, norm = ListedColormap(SEQ), BoundaryNorm(bounds, len(SEQ))
    fig, axes = plt.subplots(1, 3, figsize=(12, 7.2), facecolor=SURFACE)
    tabs = {}
    for ax, (name, months) in zip(axes, seasons.items()):
        ax.set_facecolor(SURFACE)
        g = btr[btr.month.isin(months)].groupby(["blat", "blon"])[["modis", "viirs"]].sum()
        g = g[g.modis >= 30]          # too few MODIS cell-days -> ratio is noise
        g["ratio"] = g.viirs / g.modis
        tabs[name] = g
        for (la, lo), rr in g.iterrows():
            ax.add_patch(Rectangle((lo, la), BLOCK, BLOCK, fc=cmap(norm(rr.ratio)), ec=SURFACE, lw=1.5))
            ax.text(lo + 1, la + 1, f"{rr.ratio:.1f}", ha="center", va="center", fontsize=6.5,
                    color="#ffffff" if rr.ratio >= 3 else INK)
        ax.set_xlim(-74, -52); ax.set_ylim(-56, -20); ax.set_aspect("equal")
        ax.set_title(name, loc="left", fontsize=10.5, color=INK)
        ax.tick_params(colors=INK2, length=0, labelsize=8)
        for sp in ax.spines.values():
            sp.set_visible(False)
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
    cb = fig.colorbar(sm, ax=axes, orientation="horizontal", fraction=0.035, pad=0.06,
                      ticks=bounds[:-1])
    cb.ax.set_xticklabels([f"{b:g}" for b in bounds[:-2]] + ["≥4.5"], color=INK2)
    cb.outline.set_visible(False)
    cb.set_label("VIIRS / MODIS daytime cell-day ratio, 2012–2019 (blocks with ≥30 MODIS cell-days)", color=INK2)
    fig.suptitle("Ratio by 2° block", x=0.06, ha="left", fontsize=12, color=INK)
    fig.savefig(path, dpi=150, facecolor=SURFACE, bbox_inches="tight"); plt.close(fig)
    return tabs


def mix_decomposition(btr, path):
    tot = btr.groupby(["blat", "blon"])[["modis", "viirs"]].sum()
    tot = tot[tot.modis > 0]
    rb = (tot.viirs / tot.modis).rename("rb")
    bm = btr.groupby(["month", "blat", "blon"])[["modis", "viirs"]].sum().reset_index()
    bm = bm.join(rb, on=["blat", "blon"])
    nat = bm.groupby("month")[["modis", "viirs"]].sum()
    actual = nat.viirs / nat.modis
    k = bm.dropna(subset=["rb"])
    mix = (k.rb * k.modis).groupby(k.month).sum() / k.modis.groupby(k.month).sum()
    flat = tot.viirs.sum() / tot.modis.sum()
    explained = 1 - np.var(actual - mix) / np.var(actual - flat)
    fig, ax = plt.subplots(figsize=(8, 4.2), facecolor=SURFACE)
    style(ax)
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:.1f}"))
    ax.axhline(flat, color=BASE, lw=1)
    ax.plot(actual.index, actual.values, color=VIIRS_C, lw=2, marker="o", ms=5, label="Actual national ratio")
    ax.plot(mix.index, mix.values, color=MODIS_C, lw=2, marker="s", ms=5, ls="--",
            label="Geography only (block ratios fixed, fire locations vary)")
    ax.annotate("Actual", (12, actual[12]), xytext=(6, 0), textcoords="offset points", va="center", fontsize=9, color=INK2)
    ax.annotate("Geography only", (12, mix[12]), xytext=(6, 0), textcoords="offset points", va="center", fontsize=9, color=INK2)
    ax.set_xticks(range(1, 13)); ax.set_xticklabels(list("JFMAMJJASOND"), color=INK2); ax.set_xlim(0.6, 13.6)
    ax.set_ylabel("VIIRS / MODIS cell-days", color=INK2)
    ax.set_ylim(2.3, 3.85)
    ax.legend(frameon=False, fontsize=9, loc="upper right", labelcolor=INK)
    ax.set_title(f"Seasonal ratio swing, 2012–2019: geography explains {explained:.0%} of it",
                 loc="left", fontsize=11, color=INK)
    fig.tight_layout(); fig.savefig(path, dpi=150, facecolor=SURFACE); plt.close(fig)
    return pd.DataFrame({"actual": actual, "geography_only": mix, "flat": flat}), explained


# ---------------------------------------------------------------- main ----
def main():
    OUT.mkdir(parents=True, exist_ok=True)
    daily, cells, present, spans = build()
    L = [f"# Task 2 — calibration and validation (daytime cell-days)\n\n"
         f"Years on disk: MODIS Aqua {present['MODIS'][0]}–{present['MODIS'][-1]} "
         f"({len(present['MODIS'])} yrs); VIIRS S-NPP {present['VIIRS']}\n\n"
         "acq_date span per file:\n\n"
         + pd.DataFrame([{"sensor": s, "year": y, "first": a.date(), "last": b.date()}
                         for (s, y), (a, b) in sorted(spans.items())]).to_markdown(index=False) + "\n"]
    missing = sorted(set(YEARS) - set(present["VIIRS"]))
    if missing:
        L.append(f"VIIRS missing: {missing}\n")

    gaps, per_month, flagged, w = find_gaps(daily, present)
    gaps.to_csv(OUT / "gap_days.csv", index=False)
    per_month.to_csv(OUT / "gap_days_per_month.csv", index=False)
    L.append("\n## Gap days per year (zero national rows while other sensor has rows)\n\n"
             + gaps.groupby(["year", "sensor_missing"]).size().unstack(fill_value=0).to_markdown() + "\n")
    L.append("\n## Gap days per month (all months with >=1)\n\n"
             + per_month.pivot_table(index=["year", "month"], columns="sensor_missing",
                                     values="gap_days", fill_value=0).to_markdown() + "\n")
    L.append(f"\n## Flagged months (> {GAP_DAYS_MAX} gap days)\n\n" + flagged.to_markdown(index=False) + "\n")
    aug_sep = gaps[(gaps.year == 2020) & gaps.month.isin([8, 9])]
    L.append("\n## Aug–Sep 2020 check\n\n" + (aug_sep.to_markdown(index=False) if len(aug_sep) else "No gap days.")
             + "\n\nDaily rows, Aug–Sep 2020 (min / median / max):\n\n"
             + w.loc["2020-08-01":"2020-09-30"].describe().loc[["min", "50%", "max"]].to_markdown() + "\n")

    # monthly tables
    both = sorted(set(present["MODIS"]) & set(present["VIIRS"]))
    nat = (cells.groupby(["year", "month", "sensor"]).cd.sum().unstack("sensor")
           .reindex(pd.MultiIndex.from_product([both, range(1, 13)], names=["year", "month"]), fill_value=0)
           .fillna(0).rename(columns={"MODIS": "modis", "VIIRS": "viirs"}).reset_index())
    fl = set(map(tuple, flagged[["year", "month"]].values))
    nat["gap_flag"] = [(y, m) in fl for y, m in zip(nat.year, nat.month)]
    full = (cells.groupby(["year", "month", "sensor"]).cd.sum().unstack("sensor").fillna(0)
            .rename(columns={"MODIS": "modis_celldays_D", "VIIRS": "viirs_celldays_D"}).astype(int))
    full.to_csv(OUT / "monthly_celldays_day.csv")
    comp = complete_months(spans, both)
    nat["complete"] = [(y, m) in comp for y, m in zip(nat.year, nat.month)]
    inc = sorted(set(nat.year[~nat.complete]))
    L.append("\n## Complete months\n\n" + (f"Incomplete months excluded: "
             f"{[f'{y}-{m:02d}' for y, m in zip(nat.year[~nat.complete], nat.month[~nat.complete])]}"
             if inc else "All months of every year are complete for both sensors.") + "\n")
    nat = nat.set_index(["year", "month"], drop=False).rename_axis(["yr", "mo"])
    use = ~nat.gap_flag & nat.complete

    blk = (cells[cells.year.isin(both)].pivot_table(index=["blat", "blon"], columns=["sensor"],
                                                    values="cd", aggfunc="sum").index)
    panel = pd.MultiIndex.from_tuples([(y, m, la, lo) for (y, m) in nat.index[use] for (la, lo) in blk],
                                      names=["year", "month", "blat", "blon"])
    bcd = (cells.pivot_table(index=["year", "month", "blat", "blon"], columns="sensor", values="cd",
                             aggfunc="sum").reindex(panel).fillna(0)
           .rename(columns={"MODIS": "modis", "VIIRS": "viirs"}).reset_index())
    bcd["train"] = bcd.year <= TRAIN_END

    preds, params, binfo = fit_predict(nat, bcd, use & (nat.year <= TRAIN_END))
    binfo.to_csv(OUT / "block_fits.csv", index=False)
    preds.assign(actual_viirs=nat.viirs, gap_flag=nat.gap_flag, complete=nat.complete).to_csv(
        OUT / "predictions_monthly.csv")
    res = evaluate(nat, preds, use)
    res.round(3).to_csv(OUT / "model_comparison.csv", index=False)
    best = "b_power"   # approved after Task 2 (lowest annual test MAPE, ~zero bias)

    L.append("\n## Parameters\n\n" + "\n".join(f"- {k}: " + ", ".join(f"{a}={v:.4g}" for a, v in p.items())
                                               for k, p in params.items()) + "\n")
    L.append("\n## Model comparison\n\n" + res.round(3).to_markdown(index=False) + "\n")

    yr = preds.assign(viirs=nat.viirs)[use].groupby(nat.year[use]).sum(numeric_only=True)
    yerr = yr[["raw_modis", *MODELS]].sub(yr.viirs, axis=0).div(yr.viirs, axis=0) * 100
    L.append("\n## Annual error by year, % (pred − actual)/actual, scored months only\n\n"
             + yerr.round(1).to_markdown() + "\n")

    mon, ann, q, aq = {}, {}, {}, {}
    for m in MODELS:
        mon[m], ann[m], q[m], aq[m] = intervals(nat, preds, use, m)
    cov = []
    for m in MODELS:
        t = mon[m][(mon[m].year > TRAIN_END) & mon[m].used]
        a = ann[m][ann[m].index > TRAIN_END]
        cov.append({"model": m, "monthly_q10": q[m][0], "monthly_q90": q[m][1],
                    "monthly_test_coverage": ((t.actual >= t.lo80) & (t.actual <= t.hi80)).mean(),
                    "annual_q10": aq[m][0], "annual_q90": aq[m][1],
                    "annual_test_coverage": ((a.actual >= a.lo80) & (a.actual <= a.hi80)).mean()})
    cov = pd.DataFrame(cov)
    L.append("\n## 80% prediction intervals (log-residual quantiles from training) and test coverage\n\n"
             + cov.round(3).to_markdown(index=False) + "\n")
    mon[best].to_csv(OUT / f"pi80_monthly_{best}.csv", index=False)
    ann[best].round(0).to_csv(OUT / f"pi80_annual_{best}.csv")
    L.append(f"\n## Annual totals with 80% PI, best model ({best})\n\n" + ann[best].round(0).to_markdown() + "\n")

    test_years = f"{nat.year[nat.year > TRAIN_END].min()}–{nat.year.max()}"
    chart_pred(mon[best], best, OUT / "chart1_pred_vs_actual.png", test_years)
    chart_resid(nat, preds, use, OUT / "chart2_residuals_by_month.png")
    btr = bcd[bcd.train]
    tabs = chart_blocks(btr, OUT / "chart3_ratio_by_block.png")
    bt = pd.concat({k: v for k, v in tabs.items()}, axis=1)
    bt.to_csv(OUT / "ratio_by_block.csv")
    dec, expl = mix_decomposition(btr, OUT / "chart3b_geography_test.png")
    dec.round(3).to_csv(OUT / "seasonal_ratio_decomposition.csv")
    L.append(f"\n## Is the seasonal swing geographic?\n\nShare of the monthly ratio swing reproduced by "
             f"fixed block ratios + shifting fire locations: {expl:.0%}\n\n" + dec.round(2).to_markdown() + "\n")
    L.append("\n## Block fits (model d)\n\n" + binfo.fit.value_counts().to_frame("blocks").to_markdown() + "\n")

    (OUT / "report.md").write_text("".join(L))
    print("".join(L))


if __name__ == "__main__":
    main()
