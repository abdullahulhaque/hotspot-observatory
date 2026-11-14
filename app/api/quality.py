"""Present generated coverage metadata without changing the scientific series."""
import json


def read_metadata(path):
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def annotate(rows, metadata, synthetic=False):
    gaps, confirmed = {}, {}
    if not synthetic:
        for gap in metadata.get("gap_flagged_months", []):
            gaps.setdefault(gap["month_str"], set()).add(gap["sensor_missing"])
        for day in metadata.get("live_year", {}).get("snpp_coverage_check", {}).get("days", []):
            if day.get("snpp_missing") is True:
                confirmed.setdefault(day["date"][:7], set()).add(day["date"])
    limitations = metadata.get("known_limitations", []) if not synthetic else []
    for row in rows:
        key = f'{row["year"]:04}-{row["month"]:02}'
        missing = sorted(confirmed.get(key, set()))
        sensors = gaps.get(key, set())
        incomplete = []
        if "MODIS" in sensors:
            incomplete.append("raw_modis")
        if "VIIRS" in sensors or missing:
            incomplete.append("raw_viirs")
        driver = "raw_viirs" if row["source"] == "observed" else "raw_modis"
        if driver in incomplete:
            incomplete.append("harmonized")
        row.update(incomplete_metrics=incomplete, incomplete="harmonized" in incomplete,
                   missing_snpp_days=len(missing), missing_snpp_dates=missing,
                   limitations=[item for item in limitations if isinstance(item, dict)
                                and key.replace("-", "_") in item.get("id", "")])
        row["quality_available"] = synthetic or bool(metadata)
    return rows
