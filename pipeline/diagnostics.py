"""Task 1 diagnostics: MODIS Aqua vs VIIRS S-NPP, Argentina, one year.

No calibration here. Writes charts and tables to out/.
Usage: .venv/bin/python pipeline/diagnostics.py [year]
"""
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out"
COUNTRY = "Argentina"
CELL = 0.1

COLORS = {"MODIS": "#eb6834", "VIIRS": "#2a78d6"}
INK, INK2, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"


def load(year):
    m = pd.read_csv(ROOT / f"modis/{year}/modis_{year}_{COUNTRY}.csv",
                    dtype={"acq_time": str, "confidence": "Int64"})
    v = pd.read_csv(ROOT / f"viirs-snpp/{year}/viirs-snpp_{year}_{COUNTRY}.csv",
                    dtype={"acq_time": str, "confidence": str})
    return m, v


def describe(name, df, lines):
    lines.append(f"\n## {name}\n")
    lines.append(f"rows: {len(df):,}\n")
    info = pd.DataFrame({"dtype": df.dtypes.astype(str),
                         "missing": df.isna().sum(),
                         "n_unique": df.nunique()})
    lines.append(info.to_markdown() + "\n")
    for col in ["satellite", "daynight", "type", "version"]:
        vc = df[col].value_counts(dropna=False).sort_index()
        lines.append(f"\n**{col}**\n\n" + vc.to_frame("n").to_markdown() + "\n")
    c = df["confidence"]
    if pd.api.types.is_numeric_dtype(c):
        bins = pd.cut(c, [-1, 29, 79, 100], labels=["low 0-29", "nominal 30-79", "high 80-100"])
        lines.append("\n**confidence (MODIS 0-100, binned by FIRMS classes)**\n\n"
                     + bins.value_counts().sort_index().to_frame("n").to_markdown() + "\n")
        lines.append("\n" + c.describe().to_frame().to_markdown() + "\n")
    else:
        lines.append("\n**confidence**\n\n"
                     + c.value_counts(dropna=False).sort_index().to_frame("n").to_markdown() + "\n")


def conf_class(df, sensor):
    if sensor == "MODIS":
        return pd.cut(df["confidence"], [-1, 29, 79, 100], labels=["l", "n", "h"]).astype(str)
    return df["confidence"].str.lower()


def prep(df, sensor):
    d = df.copy()
    d["sensor"] = sensor
    d["date"] = pd.to_datetime(d["acq_date"])
    d["month"] = d["date"].dt.month
    d["conf"] = conf_class(d, sensor)
    d["clat"] = (np.floor(d["latitude"] / CELL) * CELL + CELL / 2).round(2)
    d["clon"] = (np.floor(d["longitude"] / CELL) * CELL + CELL / 2).round(2)
    return d[["sensor", "date", "month", "daynight", "conf", "clat", "clon", "frp"]]


def monthly(d):
    det = d.groupby(["sensor", "daynight", "month"]).size().rename("detections")
    cd = (d.drop_duplicates(["sensor", "daynight", "date", "clat", "clon"])
            .groupby(["sensor", "daynight", "month"]).size().rename("cell_days"))
    return pd.concat([det, cd], axis=1).fillna(0).astype(int).reset_index()


def chart(tab, unit, title, path, year):
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.6), sharey=True, facecolor=SURFACE)
    for ax, dn, label in zip(axes, ["D", "N"], ["Day", "Night"]):
        ax.set_facecolor(SURFACE)
        for sensor in ["VIIRS", "MODIS"]:
            s = (tab[(tab.sensor == sensor) & (tab.daynight == dn)]
                 .set_index("month")[unit].reindex(range(1, 13), fill_value=0))
            ax.plot(s.index, s.values, color=COLORS[sensor], lw=2, marker="o", ms=4,
                    label=f"{sensor} ({'S-NPP' if sensor == 'VIIRS' else 'Aqua'})")
            ax.annotate(sensor, (12, s.values[-1]), xytext=(6, 0), textcoords="offset points",
                        va="center", fontsize=9, color=INK2)
        ax.set_title(label, loc="left", fontsize=11, color=INK)
        ax.set_xticks(range(1, 13))
        ax.set_xticklabels(list("JFMAMJJASOND"), color=INK2)
        ax.set_xlim(0.6, 12.9)
        ax.grid(axis="y", color=GRID, lw=0.8)
        ax.tick_params(colors=INK2, length=0)
        for sp in ax.spines.values():
            sp.set_visible(False)
        ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda x, _: f"{x:,.0f}"))
    axes[0].set_ylabel(unit.replace("_", " ") + " per month", color=INK2)
    axes[0].legend(frameon=False, loc="upper left", fontsize=9, labelcolor=INK)
    fig.suptitle(f"{title} — Argentina {year}, type 0, no confidence filter",
                 x=0.06, ha="left", fontsize=12, color=INK)
    fig.tight_layout()
    fig.savefig(path, dpi=150, facecolor=SURFACE)
    plt.close(fig)


def main(year=2019):
    OUT.mkdir(exist_ok=True)
    m_raw, v_raw = load(year)
    lines = [f"# Task 1 diagnostics — Argentina {year}\n"]
    describe("MODIS (all rows)", m_raw, lines)
    describe("VIIRS S-NPP (all rows)", v_raw, lines)

    m = m_raw[(m_raw.satellite == "Aqua") & (m_raw.type == 0)]
    v = v_raw[(v_raw.satellite == "N") & (v_raw.type == 0)]
    lines.append(f"\n## After filter (Aqua / S-NPP, type 0)\n\nMODIS {len(m):,} rows, VIIRS {len(v):,} rows\n")

    d = pd.concat([prep(m, "MODIS"), prep(v, "VIIRS")], ignore_index=True)

    conf = (d.groupby(["sensor", "daynight", "conf"]).size().unstack("conf").fillna(0).astype(int))
    share = conf.div(conf.sum(axis=1), axis=0).round(3)
    lines.append("\n## Confidence class by sensor/daynight (counts)\n\n" + conf.to_markdown() + "\n")
    lines.append("\n## Confidence class share\n\n" + share.to_markdown() + "\n")
    frp = d.groupby(["sensor", "conf"])["frp"].median().unstack().round(2)
    lines.append("\n## Median FRP (MW) by confidence class\n\n" + frp.to_markdown() + "\n")
    hist = (m.assign(b=(m.confidence // 10) * 10).groupby(["daynight", "b"]).size()
              .unstack("daynight").fillna(0).astype(int))
    lines.append("\n## MODIS Aqua confidence histogram (10-pt bins)\n\n" + hist.to_markdown() + "\n")

    tab = monthly(d)
    tab.to_csv(OUT / f"monthly_counts_{year}.csv", index=False)
    chart(tab, "detections", "A · Raw detections per month", OUT / f"chartA_detections_{year}.png", year)
    chart(tab, "cell_days", "B · Active 0.1° cell-days per month", OUT / f"chartB_celldays_{year}.png", year)

    w = tab.pivot_table(index=["daynight", "month"], columns="sensor",
                        values=["detections", "cell_days"], fill_value=0)
    ratio = pd.DataFrame({
        "MODIS_det": w[("detections", "MODIS")], "VIIRS_det": w[("detections", "VIIRS")],
        "ratio_det": (w[("detections", "VIIRS")] / w[("detections", "MODIS")]).round(2),
        "MODIS_cd": w[("cell_days", "MODIS")], "VIIRS_cd": w[("cell_days", "VIIRS")],
        "ratio_cd": (w[("cell_days", "VIIRS")] / w[("cell_days", "MODIS")]).round(2),
    })
    ratio.to_csv(OUT / f"ratio_table_{year}.csv")
    lines.append("\n## VIIRS/MODIS ratio per month (det = detections, cd = cell-days)\n\n"
                 + ratio.to_markdown() + "\n")
    annual = tab.groupby(["daynight", "sensor"])[["detections", "cell_days"]].sum().unstack("sensor")
    for unit in ["detections", "cell_days"]:
        annual[(unit, "ratio")] = (annual[(unit, "VIIRS")] / annual[(unit, "MODIS")]).round(2)
    lines.append("\n## Annual totals and ratio\n\n" + annual.to_markdown() + "\n")
    # month-to-month stability of the ratio: a usable unit has a flat ratio
    stab = ratio.groupby(level="daynight")[["ratio_det", "ratio_cd"]].agg(
        lambda s: s.std() / s.mean()).round(3)
    lines.append("\n## Ratio coefficient of variation across months (lower = more stable)\n\n"
                 + stab.to_markdown() + "\n")

    (OUT / f"diagnostics_{year}.md").write_text("".join(lines))
    print("".join(lines))


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 2019)
