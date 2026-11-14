# Harmonized hot-spot schema (v0.4)

Output of `pipeline/harmonize.py`. One row per (grid cell, year, month,
daynight). Consumers: `app/` and anything downstream.

## Location

`out/harmonized.parquet` — a single Parquet file, Snappy compression.
(v0.1 specified a Hive dataset at `out/harmonized/`; that layout is retired.)

Companion files: `out/national_monthly.parquet` and `out/validation.json`
(see below).

Coverage: Argentina, 2003-01 to 2026-10. 2003–2025 come from the FIRMS yearly
country archives (standard processing). 2026 is the *live year*: it comes from
the FIRMS area API and only complete months are included (see *Live year* below).
The file metadata key `coverage` gives the current range.

## Columns

| column       | type     | nullable | description |
|--------------|----------|----------|-------------|
| `lat`        | float64  | no       | Latitude of the 0.1° cell **centre**, degrees north, WGS84. Values are `floor(latitude / 0.1) * 0.1 + 0.05`, rounded to 2 decimals (e.g. `-25.65`). |
| `lon`        | float64  | no       | Longitude of the 0.1° cell **centre**, degrees east, WGS84. Same rule as `lat`. |
| `year`       | int16    | no       | Calendar year of acquisition (UTC, from `acq_date`). |
| `month`      | int8     | no       | Calendar month 1–12 (UTC, from `acq_date`). |
| `daynight`   | string   | no       | `"D"` or `"N"`, taken from the FIRMS `daynight` flag. Day and night are never mixed. |
| `raw_modis`  | float64  | yes      | MODIS Aqua active cell-days in this cell/month/daynight, after filters. `0` = covered, no activity. Filled for every month in coverage. |
| `raw_viirs`  | float64  | yes      | VIIRS S-NPP active cell-days, same unit and filters. `null` for 2003–2011 (before VIIRS); filled from 2012, always as observed, including gap months. |
| `harmonized` | float64  | yes      | Activity on the VIIRS S-NPP scale across both eras. See *Harmonized values* below. |
| `source`     | string   | no       | How `harmonized` was produced: `"backcast"` (day, 2003–2011, modelled from MODIS), `"gapfill"` (day, VIIRS-gap months, modelled from MODIS; **new in v0.3**), `"observed"` (everything else). |
| `gap_flag`   | bool     | no       | `true` if the month (all cells, both day and night) is a flagged sensor data gap: more than 3 days with zero national rows from one sensor while the reference sensor had rows. References: 2012 onward (including the live year), MODIS Aqua ↔ VIIRS S-NPP; 2003–2011, Aqua vs MODIS Terra (**new in v0.3**). The sensor that was missing is listed in `validation.json`. |
| `nrt`        | bool     | no       | **New in v0.4.** `true` if the month (all cells, day and night) contains near-real-time (NRT) data for either sensor. NRT is provisional: FIRMS later replaces it with standard processing, and values may change on refresh. Currently 2026-08 to 2026-10 (VIIRS NRT from Aug, MODIS NRT from Sep). `false` for all archive years. |

### Harmonized values

| period                                   | `harmonized`  | `source` |
|------------------------------------------|---------------|----------|
| Day, 2003–2011                           | `raw_modis × f(year, month)` | backcast |
| Day, 2012–2025, month flagged for a VIIRS gap | `raw_modis × f(year, month)` | gapfill |
| Day, live year (2026), including gap-flagged months | `raw_viirs` | observed |
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

Gap-filled months: 2012-01, 2022-07, 2022-08, 2024-07. Live-year VIIRS-gap months
are flagged but **not** filled (currently 2026-07, with 6 VIIRS outage days).

## Live year (2026)

- **Fetch** (`pipeline/fetch_firms.py`): FIRMS area API, bbox `-74,-56,-53,-21`, in
  5-day chunks. For each sensor, `/api/data_availability` picks the source: SP up to
  its `max_date`, NRT after. Sources: `VIIRS_SNPP_SP`/`VIIRS_SNPP_NRT` and
  `MODIS_SP`/`MODIS_NRT`. The MAP_KEY is read from `FIRMS_MAP_KEY` (env or
  `.env`, which is git-ignored). Raw responses go in `firms_api/` (git-ignored).
- **Clip** (`pipeline/live.py`): the bbox also covers neighbouring countries and
  sea. Points are kept inside the Natural Earth 10m Argentina polygon
  (`pipeline/ref/argentina_ne10m.geojson`). On 2019 this reproduces the FIRMS
  country archive: MODIS exactly, VIIRS within −0.01% annual cell-days.
- **Static sources:** SP rows use the FIRMS `type` field (`type == 0`), as in the
  archive. NRT rows have no `type`. A detection is treated as static (type 2)
  when it falls on a grid cell where SP data recorded type 1/2/3 (archive plus
  2026 SP). The grid is 0.005° for VIIRS and 0.01° for MODIS. Residual bias on
  2025/2026 SP is ≤ ~1% of cell-days, against +2–5% with no filter.
- **Months:** only months inside both sensors' first..last `acq_date` are
  written. A partial month is held back until it is complete; currently
  2026-11, because S-NPP NRT ends on 2026-11-02.
- **Not scored:** live-year months are not in the test set.
- Refresh by re-running `fetch_firms.py --refresh-nrt` and then `harmonize.py`.

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
| `filters`, `country`, `contract` | as above; `contract` = `harmonized_schema v0.4` |
| `coverage`           | first..last month written, e.g. `2003-01..2026-10` |

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
(currently gap-fill 2024-07, marked "likely high, drift period") carry this bias.
The back-cast and 2012–2022 are not affected: Aqua's 2003–2011 overpass (13:50–13:56)
matches the 2012–2019 training years (13:52–13:55). Details under `known_limitations` in `validation.json`.

## `out/national_monthly.parquet`

National daytime series, one row per (year, month), for every month in coverage. Metadata as
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
| `nrt`        | bool    | no       | As above (**new in v0.4**). |

## `out/validation.json`

Test years (2020–2025; only complete months: inside both sensors' first..last
`acq_date`); the per-file `acq_date` spans; test scores for raw MODIS and model b (monthly and annual MAPE,
R², bias); in-sample and leave-one-year-out interval quantiles with test
coverage; the 2012 join check; the gap-flagged months, each with the missing
sensor, reference sensor and day count; the gap-filled months, each with
raw VIIRS, filled value and interval; `scores_by_period` (model a and model b test
metrics for 2020–2022 stable orbit, 2023–2025 Aqua drift, and 2020–2025); and
`known_limitations` (sensor version and overpass-time table 2003–2025, the
back-cast overpass check, and the Jul 2024 gap-fill caveat); and `live_year`
(sources and requested ranges, rows, first and last dates per sensor, months
appended and held back, last date covered, NRT months, gap days, and the clip
and static-source methods with their validation numbers).

## Changelog

- v0.4 — Live year 2026 appended from the FIRMS area API (SP, then NRT), clipped
  to Argentina, complete months only (to 2026-10). New column `nrt` in both
  Parquet files. Live-year VIIRS-gap months are flagged, not filled. New metadata
  key `coverage`. `validation.json` gains `live_year`.
- v0.3 (data refresh, no schema change) — VIIRS 2025 added; coverage 2003–2025;
  test set 2020–2025 (complete months only); `known_limitations` added to
  `validation.json`. Model b coefficients and back-cast values unchanged.
  Later: `scores_by_period` and the 2003–2011 overpass check added to
  `validation.json`. No data or schema change.
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
