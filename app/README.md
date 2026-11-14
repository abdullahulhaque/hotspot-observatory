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

The API prefers `out/harmonized.parquet` if present, otherwise
`fixtures/synthetic_harmonized.parquet`. Set `DATA_PATH` explicitly to override;
an invalid explicit path returns 503 and does not fall back to synthetic data.
Paths default relative to the repository, independent of the launch directory.
For synthetic development, launch with `DATA_PATH=fixtures/synthetic_harmonized.parquet`
instead. The banner follows the selected dataset’s provenance.

Restart the API after replacing the main dataset; its coverage inventory is
cached. The app does not write anything into `out/`.

The main dataset accepts a Parquet file or Hive dataset with the exact Arrow
types in `contracts/harmonized_schema.md`, including `source` and `gap_flag`.
It supports v0.2 sources (`backcast`, `observed`) and v0.3 `gapfill`. Source
flags are preserved in aggregates (modelled takes precedence over observed),
and any flagged month remains flagged in every selection. Nighttime harmonized
and raw VIIRS are always null before 2012.

`out/national_monthly.parquet` supplies `year`, `month`, `harmonized`, `lo80`
and `hi80`, with daytime rows. For a selected region, the national endpoints
are multiplied by selected harmonized / national harmonized. The band is
therefore a proportional national interval, **not an independently validated
regional interval**. For all Argentina it reproduces the national endpoints.
Only modelled daytime months have bands. An absent file produces explicitly
labelled synthetic ±20% bands; an invalid file produces no band and a message.
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

The initial date range is 2003-01 through the latest month in the dataset.
The comparison chart displays all three monthly series and the 2012 VIIRS
start marker. Its keyboard-operable month slider is synchronized with the
heatmap and anomaly panel. Both the chart and heatmap use dots for back-casts, diamonds for gap-fills,
and triangles for sensor gaps. Source and gap markers are independent, so a
flagged modelled month shows both. Hatching marks unavailable heatmap values.
Isolated gap-filled months have visible vertical interval bars. The legend is a
linear cividis scale for the current region, metric and window. Raw sensors
have different sensitivities; their totals are not interchangeable.

The previous fixture and region presets were outside Argentina. The old API
also assigned zero to every empty selection in a covered year, hiding the
geographic mismatch. Now an area with no source records in any available year
returns `has_data: false`, null metrics and “No data in this area”. Within an
area with records, absent sparse months can still be zero in a covered sensor
year. That inference cannot distinguish completely inactive cells from cells
never observed without a separate coverage manifest. Unrepresented years and
partially null aggregates remain unavailable. Day and night are never combined.

## API

- `GET /meta`: provenance, dates, bounds, Argentina coverage geometry.
- `GET /series?bbox=-64,-28,-59,-24&start=2003-01&end=2024-12&daynight=D`:
  monthly sums, `source`, `gap_flag`, `lo80`, `hi80`, area availability,
  interval provenance.
- `GET /anomaly?bbox=-64,-28,-59,-24&month=2024-08&daynight=D`:
  same-month prior-year median, difference, percent change, baseline years.
- `GET /export.csv`: same parameters as series; exports aggregates, flags
  and provenance. Nulls remain blank. Not a source-row export.
- `GET /validation`: normalized held-out scores or pending/invalid state.

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
app/.venv/bin/python -m pytest app/api/test_api.py -q
cd app/web
npm run build
npm run test:install
npm run test:e2e
```

Browser tests use the running API when available; otherwise start both servers.
They cover the map, chart, flags, availability, CSV, validation placeholders
and mobile layout. Screenshots are written to ignored `app/web/test-results/`.
