# Harmonized hot-spot schema (v0.1, draft)

Output of `pipeline/`. One Parquet dataset, one row per
(grid cell, year, month, daynight). Consumers: `app/` and anything downstream.

## Location

`out/harmonized/` — Parquet, Hive-partitioned by `year`
(`out/harmonized/year=2019/part-*.parquet`). Snappy compression.

## Columns

| column       | type     | nullable | description |
|--------------|----------|----------|-------------|
| `lat`        | float64  | no       | Latitude of the 0.1° cell **centre**, degrees north, WGS84. Values are `floor(latitude / 0.1) * 0.1 + 0.05`, rounded to 2 decimals (e.g. `-25.65`). |
| `lon`        | float64  | no       | Longitude of the 0.1° cell **centre**, degrees east, WGS84. Same rule as `lat`. |
| `year`       | int16    | no       | Calendar year of acquisition (UTC, from `acq_date`). |
| `month`      | int8     | no       | Calendar month 1–12 (UTC, from `acq_date`). |
| `daynight`   | string   | no       | `"D"` or `"N"`, taken from the FIRMS `daynight` flag. Day and night are never mixed. |
| `raw_modis`  | float64  | yes      | MODIS Aqua (Collection 6.x) activity in this cell/month/daynight, in the pipeline's chosen unit (see below), after the agreed type and confidence filters. `null` = year not covered by MODIS input; `0` = covered, no activity. |
| `raw_viirs`  | float64  | yes      | VIIRS Suomi-NPP (375 m) activity, same unit and filters as `raw_modis`. `null` = year not covered by VIIRS (pre-2012). |
| `harmonized` | float64  | yes      | Activity expressed on a single consistent scale across the MODIS and VIIRS eras, after calibration. `null` until a calibration is approved. |

## Rules

- Primary key: (`lat`, `lon`, `year`, `month`, `daynight`). No duplicates.
- Rows are written only for cells where at least one sensor has activity > 0
  (sparse). An absent row means zero for both sensors.
- Input filters: MODIS `satellite == "Aqua"`, VIIRS `satellite == "N"`,
  `type == 0` (presumed vegetation fire). Confidence filter: **TBD**, set
  after Task 1 diagnostics.
- Unit: **TBD** (raw detections vs. active cell-days), set after Task 1.
  The unit chosen is recorded in the Parquet file metadata under the key
  `unit`, and the calibration version under `calibration`.
- Times are UTC; no local-time conversion.

## Changelog

- v0.1 — initial draft; unit, confidence filter and calibration open.
