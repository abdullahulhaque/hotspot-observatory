# Harmonized hot-spot schema (v0.3)

Output of `pipeline/harmonize.py`. One row per (grid cell, year, month,
daynight). Consumers: `app/` and anything downstream.

## Location

`out/harmonized.parquet` — a single Parquet file, Snappy compression.
(v0.1 specified a Hive dataset at `out/harmonized/`; that layout is retired.)

Companion files: `out/national_monthly.parquet` and `out/validation.json`
(see below).

Coverage: Argentina, 2003–2025 (2025 complete for both sensors, 1 Jan–31 Dec).

## Columns

| column       | type     | nullable | description |
|--------------|----------|----------|-------------|
| `lat`        | float64  | no       | Latitude of the 0.1° cell **centre**, degrees north, WGS84. Values are `floor(latitude / 0.1) * 0.1 + 0.05`, rounded to 2 decimals (e.g. `-25.65`). |
| `lon`        | float64  | no       | Longitude of the 0.1° cell **centre**, degrees east, WGS84. Same rule as `lat`. |
| `year`       | int16    | no       | Calendar year of acquisition (UTC, from `acq_date`). |
| `month`      | int8     | no       | Calendar month 1–12 (UTC, from `acq_date`). |
| `daynight`   | string   | no       | `"D"` or `"N"`, taken from the FIRMS `daynight` flag. Day and night are never mixed. |
| `raw_modis`  | float64  | yes      | MODIS Aqua active cell-days in this cell/month/daynight, after filters. `0` = covered, no activity. Filled for every year 2003–2025. |
| `raw_viirs`  | float64  | yes      | VIIRS S-NPP active cell-days, same unit and filters. `null` for 2003–2011 (before VIIRS); filled from 2012, always as observed, including gap months. |
| `harmonized` | float64  | yes      | Activity on the VIIRS S-NPP scale across both eras. See *Harmonized values* below. |
| `source`     | string   | no       | How `harmonized` was produced: `"backcast"` (day, 2003–2011, modelled from MODIS), `"gapfill"` (day, VIIRS-gap months, modelled from MODIS; **new in v0.3**), `"observed"` (everything else). |
| `gap_flag`   | bool     | no       | `true` if the month (all cells, both day and night) is a flagged sensor data gap: more than 3 days with zero national rows from one sensor while the reference sensor had rows. References: 2012–2025, MODIS Aqua ↔ VIIRS S-NPP; 2003–2011, Aqua vs MODIS Terra (**new in v0.3**). The sensor that was missing is listed in `validation.json`. |

### Harmonized values

| period                                   | `harmonized`  | `source` |
|------------------------------------------|---------------|----------|
| Day, 2003–2011                           | `raw_modis × f(year, month)` | backcast |
| Day, 2012+, month flagged for a VIIRS gap | `raw_modis × f(year, month)` | gapfill |
| Day, 2012+, all other months             | `raw_viirs`   | observed |
| Night, 2003–2011                         | null          | observed |
| Night, 2012+ (including VIIRS-gap months) | `raw_viirs`  | observed |

`f(year, month)` = national model-b prediction / national MODIS daytime
cell-days for that month. Cells therefore sum exactly to the national
prediction. In modelled months the spatial pattern is the MODIS footprint
scaled up: cells only VIIRS detected keep `harmonized = 0`, and values are
fractional.

Night is never modelled; it is a VIIRS-only series from 2012. In
gap-flagged months, night values and `raw_viirs` are under-counted.

Months flagged because **MODIS** was missing are not filled. From 2012,
`harmonized` comes from VIIRS anyway. In 2003–2011 (currently June 2005), the
back-cast is built from under-counted MODIS. Filter on `gap_flag` to exclude
these months.

Gap-filled months (v0.3): 2012-01, 2022-07, 2022-08, 2024-07.

## Rules

- Primary key: (`lat`, `lon`, `year`, `month`, `daynight`). No duplicates.
- Rows are written only for cells where at least one sensor has activity > 0
  (sparse). An absent row means zero for both sensors.
- Input filters: MODIS `satellite == "Aqua"` and `confidence >= 30`; VIIRS
  `satellite == "N"` and `confidence != "l"`; both `type == 0` (presumed
  vegetation fire).
- Unit: active 0.1° cell-days, i.e. the number of distinct UTC days in the month
  on which the cell had ≥1 detection (per sensor, per daynight).
- Times are UTC; no local-time conversion.

## File metadata (Parquet key/value)

| key                  | value |
|----------------------|-------|
| `unit`               | `active_cell_days_0.1deg` |
| `calibration`        | `model_b_v1` |
| `calibration_detail` | JSON: model form, coefficients, training window, 80% interval method and quantiles |
| `synthetic`          | `false` |
| `filters`, `country`, `contract` | as above; `contract` = `harmonized_schema v0.3` |

### Calibration `model_b_v1`

`log1p(VIIRS) = 1.6622 + 0.91414 · log1p(MODIS)`, fitted on national monthly
daytime cell-days, 2012–2019, with Task 2 gap-flagged months excluded.

80% prediction interval (v0.3): log-residual quantiles from leave-one-year-out
refits on 2012–2019. The monthly interval is ×exp(−0.181) to ×exp(+0.178).
Test coverage 2020–2025 is 70% of months and 3 of 6 years, against a nominal
80%. Full scores are in `validation.json`.

**Known limitation:** MODIS Aqua's daytime overpass drifts later from 2023
(≈13:54 local solar time through 2022; 14:09 in 2023, 14:31 in 2024, 15:02 in 2025),
while S-NPP stays at ≈13:50. Model b was trained before the drift, and it
over-predicts 2024 (+12.8%) and 2025 (+11.7%). Modelled values from 2023 on
(currently gap-fill 2024-07) carry this bias. The back-cast and 2012–2022 are not
affected. Details under `known_limitations` in `validation.json`.

## `out/national_monthly.parquet`

National daytime series, one row per (year, month), 2003–2025. Metadata as
above plus `daynight = D`.

| column       | type    | nullable | description |
|--------------|---------|----------|-------------|
| `year`       | int16   | no       | |
| `month`      | int8    | no       | |
| `raw_modis`  | float64 | yes      | National MODIS Aqua daytime cell-days. |
| `raw_viirs`  | float64 | yes      | National VIIRS daytime cell-days, as observed; null before 2012. |
| `harmonized` | float64 | yes      | Equals the sum of daytime `harmonized` over cells for the month. |
| `lo80`, `hi80` | float64 | yes    | 80% prediction interval (leave-one-year-out) for `backcast` and `gapfill` months; null when `observed`. |
| `source`     | string  | no       | `backcast` / `gapfill` / `observed`. |
| `gap_flag`   | bool    | no       | As above. |

## `out/validation.json`

Test years (2020–2025; only complete months: inside both sensors' first..last
`acq_date`); the per-file `acq_date` spans; test scores for raw MODIS and model b (monthly and annual MAPE,
R², bias); in-sample and leave-one-year-out interval quantiles with test
coverage; the 2012 join check; the gap-flagged months, each with the missing
sensor, reference sensor and day count; the gap-filled months, each with
raw VIIRS, filled value and interval; and `known_limitations` (sensor version
and Aqua overpass-time diagnostics by year).

## Changelog

- v0.3 (data refresh, no schema change) — VIIRS 2025 added; coverage 2003–2025;
  test set 2020–2025 (complete months only); `known_limitations` added to
  `validation.json`. Model b coefficients and back-cast values unchanged.
- v0.3 — `source` gains `"gapfill"`: VIIRS-gap months use the model b
  prediction, distributed by MODIS as in the back-cast (`raw_viirs` unchanged).
  `gap_flag` now also covers 2003–2011 (Aqua vs Terra; flags 2005-06, not
  filled). 80% interval switched to leave-one-year-out; `lo80`/`hi80` also
  populated for gap-filled months. Added `out/validation.json`.
- v0.2 — Single file `out/harmonized.parquet` replaces the Hive dataset. Filters
  and unit fixed (conf filter; active cell-days). Calibration `model_b_v1`
  approved; `harmonized` populated per the table above. Added columns `source`
  and `gap_flag`. Added companion `out/national_monthly.parquet`.
- v0.1 — initial draft; unit, confidence filter and calibration open.
