"""Read-only spatial/monthly aggregation of the harmonized Parquet contract."""
from __future__ import annotations

import csv
import io
import json
import math
import os
import re
from functools import lru_cache
from pathlib import Path
from statistics import median

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.dataset as ds
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from .quality import annotate, read_metadata

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "fixtures/synthetic_harmonized.parquet"
PRODUCTION = ROOT / "out/harmonized.parquet"
NATIONAL = ROOT / "out/national_monthly.parquet"
VALIDATION = ROOT / "out/validation.json"
METRICS = ("raw_modis", "raw_viirs", "harmonized")
TYPES = {"lat": pa.float64(), "lon": pa.float64(), "year": pa.int16(),
         "month": pa.int8(), "daynight": pa.string(),
         **{key: pa.float64() for key in METRICS}, "source": pa.string(), "gap_flag": pa.bool_()}


def parse_month(value: str) -> tuple[int, int]:
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value) or int(value[:4]) == 0:
        raise HTTPException(422, "Month must be YYYY-MM, with a year from 0001 to 9999.")
    return int(value[:4]), int(value[5:])


def parse_bbox(value: str) -> tuple[float, float, float, float]:
    try:
        w, s, e, n = (float(v) for v in value.split(","))
    except ValueError:
        raise HTTPException(422, "bbox must contain west,south,east,north.") from None
    if not all(math.isfinite(v) for v in (w, s, e, n)):
        raise HTTPException(422, "bbox coordinates must be finite.")
    if not (-180 <= w <= 180 and -180 <= e <= 180 and -90 <= s < n <= 90) or w == e:
        raise HTTPException(422, "Invalid bounds: longitudes ±180, latitudes ±90, south < north.")
    return w, s, e, n


def month_range(start: str, end: str) -> list[tuple[int, int]]:
    sy, sm = parse_month(start)
    ey, em = parse_month(end)
    first, last = sy * 12 + sm - 1, ey * 12 + em - 1
    if last < first or last - first >= 1200:
        raise HTTPException(422, "Use an ordered date range of at most 100 years.")
    return [(index // 12, index % 12 + 1) for index in range(first, last + 1)]


def periods(daynight: str) -> tuple[str, ...]:
    if daynight not in ("", "D", "N"):
        raise HTTPException(422, "daynight must be D, N, or empty (separate results for both).")
    return (daynight,) if daynight else ("D", "N")


def annual_records(rows):
    """Do not rank or join partial annual totals as if they covered twelve months."""
    groups = {}
    for row in rows:
        groups.setdefault(row["year"], []).append(row)
    result = []
    for year, months in sorted(groups.items()):
        complete = len(months) == 12 and {r["month"] for r in months} == set(range(1, 13))
        def total(metric):
            return sum(r[metric] for r in months) if complete and all(r[metric] is not None for r in months) else None
        result.append({"year": year, "harmonized": total("harmonized"),
                       "naive_splice": total("raw_modis" if year < 2012 else "raw_viirs"),
                       "complete": complete, "gap_flag": any(r["gap_flag"] for r in months)})
    return result


def summarize_area(rows):
    annual = annual_records(rows)
    eligible = [r for r in annual if r["harmonized"] is not None]
    years = {r["year"] for r in eligible}
    monthly = []
    for month in range(1, 13):
        values = [r["harmonized"] for r in rows if r["year"] in years and r["month"] == month]
        if values:
            monthly.append({"month": month, "mean": sum(values) / len(values), "years": len(values)})
    peak = max(monthly, key=lambda r: r["mean"]) if monthly else None
    return {"top_years": sorted(eligible, key=lambda r: (-r["harmonized"], r["year"]))[:5],
            "peak_month": peak, "complete_years": len(years),
            "peak_ties": [r["month"] for r in monthly if peak and r["mean"] == peak["mean"]]}


class DataStore:
    def __init__(self, path: Path):
        self.path = path.resolve()
        # Explicit Hive type avoids int16/int32 conflicts between partition and file schemas.
        self.dataset = ds.dataset(str(self.path), format="parquet",
                                  partitioning=ds.partitioning(pa.schema([("year", pa.int16())]), flavor="hive"))
        for key, dtype in TYPES.items():
            if key not in self.dataset.schema.names or self.dataset.schema.field(key).type != dtype:
                raise ValueError(f"Schema mismatch for {key}; expected {dtype}.")
        metadata = [fragment.physical_schema.metadata or {} for fragment in self.dataset.get_fragments()]
        self.synthetic = self.path == FIXTURE.resolve() or any(
            m.get(b"synthetic", b"").lower() == b"true" for m in metadata)
        self.has_nrt = "nrt" in self.dataset.schema.names
        if self.has_nrt and self.dataset.schema.field("nrt").type != pa.bool_():
            raise ValueError("nrt must be boolean.")
        if self.path == PRODUCTION.resolve() and (not self.has_nrt or self.synthetic):
            raise ValueError("Production requires real data with current-contract nrt provenance.")
        self.contract = self.metadata_value(metadata, b"contract", "unspecified")
        self.unit = "active cell-days"
        self.calibration = self.metadata_value(metadata, b"calibration", "unapproved / unspecified")
        self.coverage: dict[tuple[int, str], bool] = {}
        self.months: set[tuple[int, int]] = set()
        self.bounds = [180.0, 90.0, -180.0, -90.0]
        self.has_harmonized = False
        self.flags = {}
        self.sources = {}
        self.nrt = {}
        # Bounded-memory inventory. Never load the full production dataset into Python rows.
        for batch in self.dataset.scanner(batch_size=65536).to_batches():
            if not batch.num_rows:
                continue
            table = pa.Table.from_batches([batch])
            if self.has_nrt and table["nrt"].null_count:
                raise ValueError("nrt must be non-null.")
            if table["source"].null_count or table["gap_flag"].null_count or not pc.all(pc.is_in(table["source"], value_set=pa.array(["backcast", "observed", "gapfill"])) ).as_py():
                raise ValueError("source must be backcast/observed/gapfill and gap_flag must be non-null.")
            for key, lo, hi in (("lon", 0, 2), ("lat", 1, 3)):
                self.bounds[lo] = min(self.bounds[lo], pc.min(table[key]).as_py())
                self.bounds[hi] = max(self.bounds[hi], pc.max(table[key]).as_py())
            grouped = table.group_by(["year", "month", "daynight", "source"]).aggregate(
                [(metric, "count") for metric in METRICS] + [("gap_flag", "any")] + ([("nrt", "any")] if self.has_nrt else []))
            for row in grouped.to_pylist():
                self.months.add((row["year"], row["month"]))
                flag_key = (row["year"], row["month"], row["daynight"])
                self.nrt[flag_key] = self.nrt.get(flag_key, False) or row.get("nrt_any", False)
                self.flags[flag_key] = self.flags.get(flag_key, False) or row["gap_flag_any"]
                if flag_key not in self.sources or row["source"] != "observed":
                    self.sources[flag_key] = row["source"]
                for metric in METRICS:
                    # Coverage is a sensor/year property, even if one period has no activity.
                    key = (row["year"], metric)
                    self.coverage[key] = self.coverage.get(key, False) or row[f"{metric}_count"] > 0
                    if metric == "harmonized" and row[f"{metric}_count"]:
                        self.has_harmonized = True
        self.years = sorted({year for year, _ in self.months})

    @staticmethod
    def metadata_value(metadata, key, fallback):
        values = sorted({m.get(key, fallback.encode()).decode("utf-8", errors="replace") for m in metadata})
        return "; ".join(values) or fallback

    def provenance(self):
        return {"synthetic": self.synthetic, "unit": self.unit, "calibration": self.calibration}

    @staticmethod
    def spatial_filter(bbox):
        w, s, e, n = bbox
        longitude = ((ds.field("lon") >= w) & (ds.field("lon") <= e)) if w < e else (
            (ds.field("lon") >= w) | (ds.field("lon") <= e))
        return longitude & (ds.field("lat") >= s) & (ds.field("lat") <= n)

    @lru_cache(maxsize=128)
    def has_area(self, bbox):
        return self.dataset.count_rows(filter=self.spatial_filter(bbox)) > 0

    def series(self, bbox, dates, daynight):
        has_area = self.has_area(tuple(bbox))
        sy, sm = dates[0]
        ey, em = dates[-1]
        selection = (self.spatial_filter(bbox)
                     & (ds.field("year") >= sy) & (ds.field("year") <= ey)
                     & ((ds.field("year") > sy) | (ds.field("month") >= sm))
                     & ((ds.field("year") < ey) | (ds.field("month") <= em))
                     & ds.field("month").isin(sorted({month for _, month in dates}))
                     & ds.field("daynight").isin(daynight))
        totals = {}
        scanner = self.dataset.scanner(columns=["year", "month", "daynight", *METRICS, "source", "gap_flag"], filter=selection)
        for batch in scanner.to_batches():
            table = pa.Table.from_batches([batch])
            table = table.append_column("backcast", pc.equal(table["source"], "backcast"))
            table = table.append_column("gapfill", pc.equal(table["source"], "gapfill"))
            groups = table.group_by(["year", "month", "daynight"]).aggregate(
                [("year", "count"), ("backcast", "any"), ("gapfill", "any"), ("gap_flag", "any")] + [(metric, op) for metric in METRICS for op in ("sum", "count")])
            for row in groups.to_pylist():
                key = (row["year"], row["month"], row["daynight"])
                target = totals.setdefault(key, {"rows": 0, "backcast": False, "gapfill": False, "gap_flag": False, **{m: [0.0, 0] for m in METRICS}})
                target["rows"] += row["year_count"]
                target["backcast"] |= row["backcast_any"]
                target["gapfill"] |= row["gapfill_any"]
                target["gap_flag"] |= row["gap_flag_any"]
                for metric in METRICS:
                    target[metric][0] += row[f"{metric}_sum"] or 0.0
                    target[metric][1] += row[f"{metric}_count"]
        records = []
        for year, month in dates:
            for period in daynight:
                row = {"year": year, "month": month, "daynight": period}
                aggregate = totals.get((year, month, period))
                row["source"] = ("backcast" if aggregate["backcast"] else "gapfill" if aggregate["gapfill"] else "observed") if aggregate else self.sources.get((year, month, period), "backcast" if year < 2012 and period == "D" else "observed")
                row["nrt"] = self.nrt.get((year, month, period), False)
                row["gap_flag"] = self.flags.get((year, month, period), False) or bool(aggregate and aggregate["gap_flag"])
                for metric in METRICS:
                    if aggregate:
                        total, count = aggregate[metric]
                        # A partially missing aggregate is unknown, not a misleading partial sum.
                        row[metric] = total if count == aggregate["rows"] else None
                    else:
                        row[metric] = 0.0 if has_area and (year, month) in self.months and self.coverage.get((year, metric), False) else None
                    if year < 2012 and (metric == "raw_viirs" or (metric == "harmonized" and period == "N")):
                        row[metric] = None
                records.append(row)
        return records


def create_app(data_path: str | Path | None = None, national_path: Path = NATIONAL, validation_path: Path = VALIDATION) -> FastAPI:
    api = FastAPI(title="Hotspot Observatory", version="0.4.1")
    path = Path(data_path or os.environ.get("DATA_PATH") or PRODUCTION)

    @lru_cache(maxsize=1)
    def cached_store(signature):
        return DataStore(path)

    def store():
        try:
            # Refresh the inventory when a single-file dataset is regenerated.
            stat = path.stat()
            signature = (stat.st_mtime_ns, stat.st_size) if path.is_file() else None
            return cached_store(signature)
        except (OSError, ValueError, pa.ArrowException) as exc:
            raise HTTPException(503, f"Cannot read DATA_PATH: {exc}") from exc

    @api.get("/meta")
    def meta():
        data = store()
        months = sorted(data.months)
        return {**data.provenance(), "years": data.years, "contract": data.contract,
                "latest_complete_month": read_metadata(validation_path).get("latest_complete_month") if not data.synthetic else None,
                "start": f"{months[0][0]:04}-{months[0][1]:02}" if months else None,
                "end": f"{months[-1][0]:04}-{months[-1][1]:02}" if months else None,
                "bbox": data.bounds if months else None, "has_harmonized": data.has_harmonized,
                "coverage": json.loads((ROOT / "fixtures/argentina.geojson").read_text()),
                "country": "Argentina"}

    @api.get("/validation")
    def validation():
        if not validation_path.exists():
            return {"status": "pending", "message": "Awaiting out/validation.json", "metrics": []}
        try:
            payload = json.loads(validation_path.read_text())
            # Explicit, documented schema: never invent or silently relabel scores.
            if "scores_test" in payload:
                scores = payload["scores_test"]
                metrics = [{"name": f"{period.title()} {label}", "unit": unit,
                            "raw_modis": scores["raw_modis"][period][key],
                            "harmonized": scores["model_b"][period][key]}
                           for period in ("monthly", "annual")
                           for key, label, unit in (("MAPE_pct", "MAPE", "%"), ("bias_pct", "bias", "%"), ("R2", "R²", "unitless"))]
                held_out = ", ".join(map(str, payload["test_years"]))
            else:
                metrics = payload["metrics"]
                held_out = str(payload.get("held_out", "Unspecified"))
            if not isinstance(metrics, list) or not metrics:
                raise ValueError("metrics must be a nonempty list")
            for metric in metrics:
                if not isinstance(metric["name"], str) or not isinstance(metric["unit"], str):
                    raise ValueError("metric name and unit must be strings")
                for key in ("raw_modis", "harmonized"):
                    if isinstance(metric[key], bool) or not isinstance(metric[key], (int, float)) or not math.isfinite(metric[key]):
                        raise ValueError(f"{key} must be a finite number")
            coverage = payload.get("interval_80", {}).get("leave_one_year_out", {}).get("monthly_test_coverage")
            if coverage is not None and (not isinstance(coverage, (int, float)) or not math.isfinite(coverage) or not 0 <= coverage <= 1):
                raise ValueError("Invalid interval coverage")
            # Period reports may omit raw MODIS; model_a is a correction, never a raw substitute.
            years = payload.get("test_years", [])
            overall = f"{min(years)}-{max(years)}" if years else held_out
            period_reports = []
            for label, report in payload.get("scores_by_period", {}).items():
                if not isinstance(report, dict) or "model_b" not in report:
                    continue
                raw = report.get("raw_modis", payload.get("scores_test", {}).get("raw_modis", {}) if label == overall else {})
                period_metrics = []
                for frequency in ("monthly", "annual"):
                    for key, name, unit in (("MAPE_pct", "MAPE", "%"), ("bias_pct", "bias", "%"), ("R2", "R²", "unitless")):
                        values = {"raw_modis": raw.get(frequency, {}).get(key), "harmonized": report["model_b"].get(frequency, {}).get(key)}
                        if any(v is not None and (isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v)) for v in values.values()):
                            raise ValueError("Period scores must be finite numbers or null")
                        period_metrics.append({"name": f"{frequency.title()} {name}", "unit": unit, **values})
                period_reports.append({"label": label, "note": str(report.get("note", "")), "metrics": period_metrics})
            if not any(report["label"] == overall for report in period_reports):
                period_reports.append({"label": overall, "note": "All held-out years", "metrics": metrics})
            return {"status": "ready", "metrics": metrics, "held_out": held_out,
                    "periods": period_reports, "known_limitations": payload.get("known_limitations", []),
                    "monthly_interval_coverage": coverage, "nominal_interval_coverage": payload.get("interval_80", {}).get("nominal"),
                    "live_year": payload.get("live_year", {}),
                    "notes": [str(note) for note in payload.get("notes", [])]}
        except (OSError, ValueError, KeyError, TypeError) as exc:
            return {"status": "invalid", "message": f"Cannot read validation scores: {exc}", "metrics": []}

    def intervals(data, rows):
        national = {}
        status = "synthetic" if data.synthetic else "unavailable"
        if national_path.exists():
            try:
                table = ds.dataset(str(national_path), format="parquet").to_table()
                required = {"year", "month", "harmonized", "lo80", "hi80"}
                if not required.issubset(table.column_names):
                    raise ValueError("Missing national interval columns")
                if not data.synthetic and (table.schema.metadata or {}).get(b"synthetic", b"").lower() == b"true":
                    raise ValueError("Synthetic intervals cannot accompany real activity.")
                national = {(r["year"], r["month"]): r for r in table.to_pylist() if r.get("daynight", "D") == "D"}
                status = "national_scaled"
            except (OSError, ValueError, pa.ArrowException):
                status = "unavailable"
        for row in rows:
            row["lo80"] = row["hi80"] = None
            if row["source"] not in ("backcast", "gapfill") or row["daynight"] != "D" or row["harmonized"] is None:
                continue
            if status == "synthetic":
                row["lo80"], row["hi80"] = row["harmonized"] * .8, row["harmonized"] * 1.2
            elif status == "national_scaled":
                reference = national.get((row["year"], row["month"]))
                if reference and reference["harmonized"] and reference["lo80"] is not None and reference["hi80"] is not None:
                    lo, hi, total = reference["lo80"], reference["hi80"], reference["harmonized"]
                    if all(math.isfinite(v) for v in (lo, hi, total)) and 0 <= lo <= total <= hi:
                        row["lo80"] = row["harmonized"] * lo / total
                        row["hi80"] = row["harmonized"] * hi / total
        metadata = read_metadata(validation_path) if not data.synthetic else {}
        return {"source": status, "synthetic": status == "synthetic" or data.synthetic,
                "monthly_coverage": metadata.get("interval_80", {}).get("leave_one_year_out", {}).get("monthly_test_coverage"),
                "nominal_coverage": metadata.get("interval_80", {}).get("nominal"),
                "test_years": metadata.get("test_years", []),
                "note": {"synthetic": "Illustrative synthetic 80% band (±20%); national interval file is absent.",
                         "national_scaled": "National 80% prediction interval, scaled in proportion to selected-area activity. Regional coverage has not been independently validated.",
                         "unavailable": "National interval file is missing or invalid; prediction interval unavailable."}[status]}

    @api.get("/series")
    def series(bbox: str, start: str, end: str, daynight: str = ""):
        bounds, dates, selected = parse_bbox(bbox), month_range(start, end), periods(daynight)
        data = store()
        rows = annotate(data.series(bounds, dates, selected), read_metadata(validation_path), data.synthetic)
        band = intervals(data, rows)
        return {**data.provenance(), "bbox": bounds, "start": start, "end": end,
                "has_data": data.has_area(tuple(bounds)), "interval": band, "data": rows}

    @api.get("/anomaly")
    def anomaly(bbox: str, month: str, daynight: str = ""):
        bounds, (year, selected_month), selected = parse_bbox(bbox), parse_month(month), periods(daynight)
        data = store()
        years = [y for y in data.years if y < year]
        dates = [(y, selected_month) for y in years] + [(year, selected_month)]
        records = annotate(data.series(bounds, dates, selected), read_metadata(validation_path), data.synthetic)
        band = intervals(data, records)
        result = []
        for period in selected:
            current = next(r for r in records if r["year"] == year and r["daynight"] == period)
            metrics = {}
            for metric in METRICS:
                history = [r for r in records if r["year"] < year and r["daynight"] == period and r[metric] is not None and metric not in r["incomplete_metrics"]]
                baseline = median(r[metric] for r in history) if history else None
                value = current[metric]
                eligible = value is not None and metric not in current["incomplete_metrics"] and current["quality_available"]
                difference = value - baseline if eligible and baseline is not None else None
                metrics[metric] = {"value": value, "historical_median": baseline, "difference": difference,
                                   "percent_change": 100 * difference / baseline if difference is not None and baseline else None,
                                   "baseline_years": [r["year"] for r in history], "sample_size": len(history),
                                   "rank": 1 + sum(r[metric] > value for r in history) if eligible else None,
                                   "rank_count": len(history) + 1 if eligible else 0,
                                   "rank_tied": any(r[metric] == value for r in history) if eligible else False,
                                   "comparison_status": "incomplete" if metric in current["incomplete_metrics"] else "quality_unavailable" if not current["quality_available"] else "available"}
            result.append({**{key: value for key, value in current.items() if key not in METRICS}, "metrics": metrics})
        return {**data.provenance(), "bbox": bounds, "month": month,
                "metric": "harmonized", "interval": band,
                "baseline": "Same calendar month in available earlier years; incomplete observations and target year excluded.", "data": result}

    @api.get("/area-summary")
    def area_summary(bbox: str, daynight: str = "D"):
        bounds = parse_bbox(bbox)
        if daynight not in ("D", "N"):
            raise HTTPException(422, "Choose D or N for the area summary.")
        data = store()
        months = sorted(data.months)
        first = f"{months[0][0]:04}-{months[0][1]:02}" if months else None
        last = f"{months[-1][0]:04}-{months[-1][1]:02}" if months else None
        dates = month_range(first, last) if months else []
        daytime = data.series(bounds, dates, ("D",)) if dates else []
        selected = daytime if daynight == "D" else data.series(bounds, dates, ("N",)) if dates else []
        return {**data.provenance(), "has_data": data.has_area(tuple(bounds)),
                "start": first, "end": last, "daynight": daynight,
                "annual_daytime": annual_records(daytime), **summarize_area(selected)}

    @api.get("/export.csv")
    def export(bbox: str, start: str, end: str, daynight: str = "", metric: str = "harmonized"):
        if metric not in (*METRICS, "all"):
            raise HTTPException(422, "metric must be harmonized, raw_modis, raw_viirs, or all.")
        bounds, dates, selected = parse_bbox(bbox), month_range(start, end), periods(daynight)
        data = store()
        rows = annotate(data.series(bounds, dates, selected), read_metadata(validation_path), data.synthetic)
        band = intervals(data, rows)

        def chunks():
            stream = io.StringIO()
            chosen = METRICS if metric == "all" else (metric,)
            fields = ["year", "month", "daynight", *chosen, "source", "gap_flag", "nrt", "incomplete", "incomplete_metrics", "missing_snpp_days", "missing_snpp_dates", "quality_available", "lo80", "hi80", "interval_note", "interval_monthly_coverage", "limitations", "synthetic", "unit", "calibration"]
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            yield stream.getvalue()
            for row in rows:
                stream.seek(0)
                stream.truncate(0)
                # Prefix spreadsheet formula markers in metadata from external datasets.
                provenance = {k: ("'" + v if isinstance(v, str) and v.startswith(("=", "+", "-", "@", "\t", "\r")) else v)
                              for k, v in data.provenance().items()}
                exported = {**row, **provenance, "synthetic": str(data.synthetic).lower(),
                            "interval_note": band["note"], "interval_monthly_coverage": band["monthly_coverage"],
                            "limitations": "; ".join(item.get("finding", "") for item in row["limitations"]),
                            "incomplete": metric in row["incomplete_metrics"] if metric != "all" else bool(row["incomplete_metrics"]),
                            "incomplete_metrics": ";".join(row["incomplete_metrics"]), "missing_snpp_dates": ";".join(row["missing_snpp_dates"])}
                writer.writerow({key: exported[key] for key in fields})
                yield stream.getvalue()
        return StreamingResponse(chunks(), media_type="text/csv", headers={
            "Content-Disposition": f'attachment; filename="hotspots-{start}-{end}.csv"',
            "X-Synthetic-Data": str(data.synthetic).lower()})

    return api


app = create_app()
