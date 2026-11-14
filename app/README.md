# Hotspot Observatory — Argentina

Read-only FastAPI + React/Vite/MapLibre explorer. Units throughout are
**active cell-days**: UTC days with hotspot detections in each 0.1° cell,
summed over the selected area. These are not individual fires or burned area.

## Run locally

From the repository root (Python 3.10+ and Node 22.11+):

```sh
python3 -m venv app/.venv
app/.venv/bin/python -m pip install -r app/api/requirements.txt
DATA_PATH=out/harmonized.parquet app/.venv/bin/python -m uvicorn app.api.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```sh
cd app/web
npm ci
npm run dev
```

Open http://127.0.0.1:5173. API docs: http://127.0.0.1:8000/docs.
Vite proxies `/api/*` to port 8000; set `API_URL` to change the backend target.
For production, serve `app/web/dist` with a reverse proxy routing `/api/*`
to FastAPI and stripping `/api`, or configure `VITE_API_BASE` at build time.

## Inputs (read-only)

The API defaults only to `out/harmonized.parquet`. Missing or invalid production
data returns 503; there is no automatic synthetic fallback. Set `DATA_PATH`
explicitly to override.
Paths default relative to the repository, independent of the launch directory.
For synthetic development, launch with `DATA_PATH=fixtures/synthetic_harmonized.parquet`
instead. The banner follows the selected dataset’s provenance.

Single-file inventory refreshes when file size or modification time changes;
reload the page to pick up the latest end date. Restart the API after changing
a Hive dataset directory. The app does not write anything into `out/`.

The main dataset accepts a Parquet file or Hive dataset with the exact Arrow
types in `contracts/harmonized_schema.md`, including `source`, `gap_flag` and v0.4.1 `nrt`.
The explicit legacy development fixture remains readable with `nrt=false`. Source
flags are preserved in aggregates (modelled takes precedence over observed),
and any flagged month remains flagged in every selection. Nighttime harmonized
and raw VIIRS are always null before 2012.

`out/national_monthly.parquet` supplies `year`, `month`, `harmonized`, `lo80`
and `hi80`, with daytime rows. For a selected region, the national endpoints
are multiplied by selected harmonized / national harmonized. The band is
therefore a proportional national interval, **not an independently validated
regional interval**. For all Argentina it reproduces the national endpoints.
Only modelled daytime months have bands. An absent or invalid file produces no interval and an explicit message for real
data. Only explicit synthetic development can use illustrative ±20% intervals.
Intervals attached to synthetic activity are labelled illustrative.

`out/validation.json` is read on each `/validation` request. The frontend
loads it on page load/retry. Missing files show placeholders; malformed files
show an error without invented scores. The pipeline's v0.3 format is supported:
`scores_test.raw_modis` and `scores_test.model_b`, each with `monthly`/`annual`
objects containing `MAPE_pct`, `bias_pct`, `R2`; `test_years` identifies the
held-out period. Leave-one-year-out monthly interval coverage and notes are
also displayed. A simpler interchange format is accepted:

```json
{
  "held_out": "2020–2024",
  "metrics": [
    {"name": "Monthly MAPE", "unit": "%", "raw_modis": 66.6, "harmonized": 11.6}
  ]
}
```

The example values illustrate the schema; the UI never uses embedded scores.

## Map, chart and availability

The map starts at longitude −63.6, latitude −38.4, zoom 4. The default selection
is all Argentina; presets select Gran Chaco, Pampas and Patagonia. A local
Natural Earth country geometry outlines the coverage domain and dims the
outside. This country mask is not a per-cell observation completeness map.
Selection works by rectangle, coordinates or preset. Escape cancels drawing.

The initial date range is 2003-01 through the latest month in the dataset
(current real file: 2026-10, also the initially selected month). Harmonized is the default heatmap, headline total
and CSV series; Raw remains available through the toggle.
The page has four sections on one document scroll, with a single shared region:

1. Select a Region: the map, coordinates and presets.
2. Compare the Satellites: separate monthly raw MODIS and raw VIIRS charts,
   always daytime and full-record. They share the y-axis maximum and pointer
   hover month; a keyboard slider controls both. Sensor history is distinguished
   from the dates actually present in this Argentina dataset.
3. Understand Harmonization: the full-width annual daytime naive-splice comparison,
   validation by every reported period, and known limitations. National model
   validation is labelled as national and does not change with the region.
4. Explore Fire History: date/acquisition controls, calendar and harmonized anomaly side by
   side, followed by rankings, peak month and CSV export.

Harmonized heatmap cells use dots for back-casts, diamonds for gap-fills and
triangles for gaps. Raw view hides model-source markers. Hatching indicates
unavailable values. The cividis colour position is sqrt(value / maximum);
legend ticks invert that mapping (0%, 6.25%, 25%, 56.25%, 100% of the maximum).
Cell hover titles give values in active cell-days.

The previous fixture and region presets were outside Argentina. The old API
also assigned zero to every empty selection in a covered year, hiding the
geographic mismatch. Now an area with no source records in any available year
returns `has_data: false`, null metrics and “No data in this area”. Within an
area with records, absent sparse months can still be zero in a covered sensor
year. That inference cannot distinguish completely inactive cells from cells
never observed without a separate coverage manifest. Unrepresented years and
partially null aggregates remain unavailable. Day and night are never combined.

The anomaly panel always uses harmonized activity for both the selected month
and the prior-year median, independent of the Raw toggle. It labels the series,
source and gap status. Rank is descending (1 = highest), comparing the selected
month with earlier same-calendar-month values; equal values share a rank.
Future years never enter this rank or the median. Missing nighttime harmonized values remain unavailable.

“Why harmonize?” uses annual daytime totals for the full record, independently
of the date window and day/night selector. It compares a naive splice (MODIS
through 2011, VIIRS from 2012) with harmonized activity and annotates the sensor
switch. An expandable table provides exact annual values.

The area summary follows the day/night selector and uses the full record.
Top years rank annual harmonized sums; the peak month is the largest calendar-
month average across those years, with ties displayed. Only years with twelve
available harmonized months are used; partial years are excluded. Gap-flagged
months are retained and noted. Twelve available values do not imply sensors
had complete acquisition coverage on every day.

## API

- `GET /meta`: provenance, dates, bounds, Argentina coverage geometry.
- `GET /series?bbox=-64,-28,-59,-24&start=2003-01&end=2024-12&daynight=D`:
  monthly sums, `source`, `gap_flag`, `lo80`, `hi80`, area availability,
  interval provenance.
- `GET /anomaly?bbox=-64,-28,-59,-24&month=2024-08&daynight=D`:
  harmonized default, same-month prior-year medians, differences, percent
  changes, baseline years, selected month source/gap flag, rank, rank count
  and tie indicator. Per-sensor
  statistics remain in the response for API consumers.
- `GET /area-summary?bbox=-64,-28,-59,-24&daynight=D`: full-record annual
  daytime comparison, top five harmonized years for the chosen acquisition,
  peak calendar-month average and number of eligible years.
- `GET /export.csv`: same parameters as series plus `metric`, default
  `harmonized`. Use `raw_modis`, `raw_viirs`, or `all` explicitly. The UI sends
  its selected metric. Exports monthly aggregates, source/gap flags and
  provenance; nulls remain blank. Not a source-row export.
- `GET /validation`: normalized held-out scores, all `scores_by_period`
  reports and `known_limitations`, or pending/invalid state. Missing subperiod
  raw-MODIS scores remain null; ratio-model scores are never labelled raw.

Bounds are west,south,east,north, inclusive of cell centres. West > east
selects across the antimeridian. Dates are inclusive UTC months, maximum 1,200
months. Omitted `daynight` returns separate D/N records. Synthetic provenance
is retained even when a fixture is copied and appears in the UI and CSV.

Basemap tiles (OpenStreetMap) and fonts (Google Fonts) require internet.
Country outlines and rectangle selection work with the local map style when
tiles are offline. If WebGL is unavailable, coordinate and preset controls
remain available. No map token is required.

## Validate

```sh
app/.venv/bin/python -m pytest app/api -q
cd app/web
npm run build
npm run test:unit
npm run test:install
npm run test:e2e
```

Browser tests use the running API when available; otherwise start both servers.
They cover the map, chart, flags, availability, CSV, validation placeholders
and mobile layout. Screenshots are written to ignored `app/web/test-results/`.

## Live-year observation quality

NRT is an independent, provisional-processing flag, not a fourth source value.
The calendar marks it with N; orange chart points and ! calendar markers identify
incomplete observations. Confirmed missing S-NPP days come from generated
`live_year.snpp_coverage_check.days`, including March, April and June 2026 even
though their `gap_flag` is false. Unconfirmed absences are not relabelled outages.
Archived flagged months use `sensor_missing` to identify the affected series.
Harmonized quality follows VIIRS for observed months and MODIS for modelled months.

Incomplete selected values remain visible, but anomaly percentage, difference
and rank are withheld. Known incomplete prior observations are excluded from the
same-month median/rank. Model estimates remain included and are identified as such.
Missing coverage metadata also withholds anomaly interpretation. July 2026 day
is gap-filled; its unfilled night observations remain incomplete. The month panel
reads July's drift-period limitation and interval coverage from generated metadata.
NRT values may change on refresh. Live-year months are outside the validation set.

CSV exports include source, nrt, incomplete (for the exported metric), affected
metrics, missing-day dates, quality availability, harmonized lo80/hi80, interval
caveats and national limitations. Interval endpoints always describe harmonized
activity even when exporting a raw metric. No endpoints are invented in real mode.

The integration tests require the regenerated production files and check the
finalized October 2026 coverage. App-owned current-contract fixtures are generated
in pytest temporary directories; the scientific fixture and outputs are untouched.

## Seasonal comparison

Explore switches between the existing Fire calendar and Compare seasons. Seasonal
bars sum three harmonized months for the shared region and chosen day/night period,
using the full record rather than the calendar's date or raw-sensor filters.
Summer is named for its December year (December 2025–February 2026 = Summer 2025–26).
The last 3, 5 or 10 complete seasons define the displayed median, including the
selected season when complete. Incomplete seasons within that span are additional
grey bars with explicitly partial totals, excluded from comparisons. Null or absent
months, incomplete harmonized coverage, and unavailable quality metadata make a
season incomplete. Missing months are never filled with zero; future seasons are
not created. Source, gap, NRT and missing-day information stays visible in each
monthly breakdown. No seasonal prediction interval or regional validation is inferred.

Navigation highlights the section at the upper viewport and defaults to Section 01.
Anchor links scroll smoothly, respecting the reduced-motion preference. The hero's
measurement explanation is available through a keyboard-accessible disclosure.
