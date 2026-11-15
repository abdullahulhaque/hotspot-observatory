# Hotspot Observatory

Hotspot Observatory is a NASA Space Apps Challenge 2026 application for exploring
satellite-detected burning activity across Argentina. Its single-page workspace
has four sections sharing one study area: **Study Area**, **Compare Satellites**,
**Harmonization and Scientific Validation**, and **Explore Fire History**.

## Quick start for collaborators

Prerequisites: Git, **Python 3.12**, and **Node.js 22.11+ with npm**. The commands
below use a macOS/Linux shell. Access to the private GitHub repository is required.

```sh
git clone https://github.com/abdullahulhaque/hotspot-observatory.git
cd hotspot-observatory
python3.12 -m venv app/.venv
app/.venv/bin/python -m pip install -r app/api/requirements.txt
npm --prefix app/web ci
```

Start the backend from the repository root:

```sh
DATA_PATH=out/harmonized.parquet app/.venv/bin/python -m uvicorn app.api.main:app --host 127.0.0.1 --port 8000
```

In a second terminal, from the repository root:

```sh
npm --prefix app/web run dev
```

Open **http://127.0.0.1:5173**. FastAPI documentation is at
http://127.0.0.1:8000/docs. Vite forwards `/api/*` to FastAPI on port 8000.
Check the connection and real-data metadata with:

```sh
curl --fail http://127.0.0.1:8000/meta
curl --fail http://127.0.0.1:5173/api/validation
```

`/meta` should report `synthetic: false`, country Argentina, and latest complete
month `2026-10` for the committed snapshot. No FIRMS key or raw downloads are
needed to run the app. The real processed datasets are included in this repository.
The API fails explicitly when production data is missing or invalid; it never
silently substitutes the synthetic fixture. To update an existing checkout,
save local work first, then use `git pull --ff-only origin main`.

## Technology and repository structure

- Frontend: React 19, Vite 6, MapLibre GL, SVG charts, and plain CSS.
- Backend: Python, FastAPI, Uvicorn, and PyArrow for read-only Parquet aggregation.
- Scientific pipeline: pandas, NumPy, PyArrow, Matplotlib, and tabulate.
- Tests: pytest/FastAPI TestClient, Node's test runner, and Playwright/Chromium.

```text
app/api/       Read-only API and backend tests
app/web/       Four-section frontend, lockfile and browser/unit tests
contracts/     Scientific data schema and provenance contract
fixtures/      Argentina map geometry and explicitly synthetic development fixture
pipeline/      Scientific calibration, diagnostics and harmonization scripts
out/           Versioned NASA-derived processed data and scientific results
out/task2/     Calibration reports and saved held-out predictions
get_rest.sh    Download yearly FIRMS country archives (optional regeneration)
```

## Configuration

No environment variables are required for the default local app setup.
Optional variables are listed here without credential values:

| Variable | Purpose |
|---|---|
| `DATA_PATH` | Override the API activity dataset; defaults to the repository's real `out/harmonized.parquet`. |
| `API_URL` | Override Vite's development API proxy target. |
| `VITE_API_BASE` | API base URL embedded at frontend build time; otherwise the frontend uses `/api`. A separate-origin API requires suitable proxy/CORS configuration. |
| `FIRMS_MAP_KEY` | Required only when fetching or refreshing NASA FIRMS data, not for running the committed app. |

Keep credentials in the local environment or ignored `.env` files. Never commit
keys, raw responses, virtual environments, dependency directories or build outputs.
The frontend needs network access for its basemap tiles and attribution sources;
data aggregation itself uses the local processed files.

## Processed data distribution

Keep these files together when cloning, packaging or deploying the application:

| Required asset | Purpose | Approximate size |
|---|---|---:|
| `out/harmonized.parquet` | Real cell-level activity, source and quality flags | 1.7 MB |
| `out/national_monthly.parquet` | National monthly series and modelled-month intervals | 11 KB |
| `out/validation.json` | Validation scores, model metadata and limitations | 45 KB |
| `out/task2/predictions_monthly.csv` | Saved national Model B predictions and held-out VIIRS observations | 17 KB |
| `fixtures/argentina.geojson` | Application coverage boundary | 3 KB |

These lightweight processed assets are stored in ordinary Git. Git LFS is not
needed for this snapshot. Raw NASA CSVs, ZIP downloads and FIRMS response caches
are excluded; processed CSV summaries in `out/` are intentionally retained.
Do not add a blanket `*.parquet` or `*.csv` ignore rule. If future processed
files grow large, establish Git LFS or a versioned, checksummed download before
committing them. The scientific regeneration commands below are optional for
app users and overwrite derived outputs only when explicitly run.

## Tests and production build

Run from the repository root after installation:

```sh
app/.venv/bin/python -m pytest app/api -q
npm --prefix app/web run test:unit
npm --prefix app/web run build
npm --prefix app/web run test:install
npm --prefix app/web run test:e2e
```

Playwright starts the local API and Vite servers if ports 8000/5173 are free;
otherwise it reuses running servers. Use the real dataset for integration tests.
On a minimal Linux host, install Chromium system dependencies if requested:
`cd app/web && npx playwright install-deps chromium` (may require sudo).
`test:install` stores Chromium in the ignored `app/web/.playwright/` directory.
The production build is generated in ignored `app/web/dist/`. Deployment must
serve it with a reverse proxy forwarding `/api/*` to FastAPI and stripping `/api`.

Current checks: 66 backend tests, 14 frontend unit tests and 24 end-to-end tests.
Existing non-blocking warnings concern the frontend bundle size and a
Starlette/httpx TestClient deprecation. See [application details](app/README.md)
for endpoint behavior, quality flags, exports and development fixtures.

## Scientific overview

This project builds one consistent monthly record of satellite fire hot-spot
activity over Argentina from **2003-01 to 2026-10**.

VIIRS S-NPP (from 2012) detects far more hot spots than MODIS Aqua (from 2002),
because its pixels are smaller and more sensitive. Joining the two raw series
would show a false jump in 2012. Instead, the pipeline calibrates MODIS to the
VIIRS scale on the years when both fly (2012–2019) and tests the calibration on
2020–2025. It then uses that calibration to:

- back-cast 2003–2011,
- fill months where VIIRS has outages,
- append the current year from the FIRMS API.

The unit is **active 0.1° cell-days**. These are neither fire counts nor burned
area.

Outputs, specified in [`contracts/harmonized_schema.md`](contracts/harmonized_schema.md) (v0.4.1):

| file | content |
|---|---|
| `out/harmonized.parquet` | One row per 0.1° cell × year × month × day/night: `raw_modis`, `raw_viirs`, `harmonized`, `source`, `gap_flag`, `nrt` |
| `out/national_monthly.parquet` | National daytime series with 80% intervals for modelled months |
| `out/validation.json` | Model, test scores, intervals, gap lists, live-year fetch details, `known_limitations` |
| `out/chart_national_series.png` | National series chart |
| `app/` | Read-only map and chart explorer for the Parquet output (see [`app/README.md`](app/README.md)) |

## Data sources

| source | product | used for |
|---|---|---|
| [FIRMS](https://firms.modaps.eosdis.nasa.gov/) yearly country archives (`data/country/zips`) | MODIS Collection 6.1 active fire (MCD14ML), standard processing | MODIS Aqua 2003–2025. MODIS Terra 2003–2011 serves only as a gap-check reference. |
| same | VIIRS S-NPP 375 m Collection 2 active fire (VNP14IMGML), standard processing | VIIRS 2012–2025 |
| [FIRMS area API](https://firms.modaps.eosdis.nasa.gov/api/area/) | `MODIS_SP` / `MODIS_NRT`, `VIIRS_SNPP_SP` / `VIIRS_SNPP_NRT` | Live year 2026, Argentina bbox `-74,-56,-53,-21` |
| FIRMS `/api/data_availability` | – | Picks the source: SP up to its last date, NRT after |
| [Natural Earth](https://www.naturalearthdata.com/) 10m admin-0 v5.1.2 (public domain) | Argentina polygon, `pipeline/ref/argentina_ne10m.geojson` | Clips API data to the border |

The API needs a FIRMS MAP_KEY. Set it in `FIRMS_MAP_KEY`, or as
`FIRMS_MAP_KEY=...` in `.env`. Both `.env` and the raw API responses
(`firms_api/`) are git-ignored, and the key is never printed or logged.

## Method

**Filters.**
- MODIS: `satellite == "Aqua"` and `confidence >= 30`.
- VIIRS: `satellite == "N"` (S-NPP) and `confidence != "l"` (low confidence dropped).
- Both: `type == 0` (presumed vegetation fire). This removes volcanoes, static
  land sources and offshore sources.

**Unit: active 0.1° cell-days.** Each detection is assigned to a 0.1° grid cell,
centred at `floor(x/0.1)*0.1 + 0.05`. A cell-day counts **one** if the cell had
at least one detection on that UTC day; monthly values are the number of such
days. This removes duplicate counting:
- One fire usually triggers several adjacent pixels, especially at VIIRS's
  375 m.
- Overlapping swaths can observe the same fire more than once a day.

Raw detection counts therefore depend mostly on pixel size and overpass
geometry, not on fire activity. Collapsing to one count per cell per day makes
the two sensors comparable.

**Day-only harmonization.** Only daytime (`daynight == "D"`) values are
calibrated. Night is reported as a VIIRS-only series from 2012 and is never
modelled. MODIS detects too few night fires to calibrate.

**Calibration: model b, a national power law.** Four models were fitted on
national monthly daytime cell-days for 2012–2019, excluding gap-flagged months:
- **a.** constant ratio;
- **b.** power law `log1p(V) = a + b·log1p(M)`;
- **c.** power law plus month-of-year terms;
- **d.** power law fitted per 2° block.

Each was scored on 2020–2025, using complete, non-gap months only. Model b was
chosen as the most accurate monthly model that stays simple and stable:

```
log1p(VIIRS) = 1.6622 + 0.91414 · log1p(MODIS)
```

The 80% prediction interval comes from leave-one-year-out residuals on
2012–2019. The monthly interval is ×exp(−0.181) to ×exp(+0.178), i.e. about
−17% / +20%.

**Back-cast 2003–2011.** For each month, the national model b prediction is
computed from national MODIS. It is spread to cells in proportion to MODIS
cell-days, using `factor = prediction / national MODIS`, so cells sum exactly
to the national value. `source = "backcast"`.

**Gap detection and gap fill.** A day is a gap day for a sensor when that
sensor has zero national rows while the reference sensor has rows. The
references are Aqua ↔ S-NPP from 2012, and Aqua vs Terra for 2003–2011. A month
is flagged (`gap_flag`) when it has more than 3 gap days.

- **Months flagged for VIIRS** are gap-filled with model b, distributed as in
  the back-cast (`source = "gapfill"`), and `raw_viirs` is kept as observed.
  These are 2012-01, 2022-07, 2022-08, 2024-07 and 2026-07.
- **Months flagged for MODIS** are flagged but not filled.

For the live year, `/api/data_availability` gives only a min..max date range,
so it cannot show missing days inside the range. Before filling a 2026 month,
`fetch_firms.py --coverage-check` confirms that each missing day has zero S-NPP
rows **worldwide** while NOAA-20 has rows. This shows a real outage rather than
a day without detections. Jul 11–16, 2026 passes: 0 S-NPP rows worldwide
against 45k–112k NOAA-20 rows per day.

**Live year and border clipping.** 2026 comes from the FIRMS area API in 5-day
chunks:
- SP data through 2026-07-31 (VIIRS) and 2026-08-31 (MODIS);
- NRT after that, flagged with `nrt = true`.

The API bbox also covers Chile, Bolivia, Paraguay, Brazil, Uruguay, the
Falklands and the sea; unclipped, it would nearly double the counts (+91% MODIS,
+99% VIIRS). Points are therefore kept inside the Natural Earth Argentina
polygon. On 2019 this reproduces the FIRMS country archive: MODIS exactly,
VIIRS within −0.01% of annual cell-days. Only complete months are written, so
2026-11 is held back. S-NPP NRT ends on 2026-11-02 (zero S-NPP rows worldwide
from Nov 3).

**NRT static-source handling.** NRT rows have no `type` field. A detection is
treated as static (type 2) when it falls on a location where SP data recorded
type 1/2/3 sources, using the archive plus 2026 SP. Locations are matched on a
0.005° grid for VIIRS and 0.01° for MODIS. This was tested on 2025 and 2026 SP
data, where the true type is known:

| | residual cell-day error with mask | with no filter |
|---|---|---|
| VIIRS | −0.1% / +0.8% | +1.7% / +3.9% |
| MODIS | +0.6% / +1.1% | +2.8% / +5.4% |

## Results

**Model comparison** (Task 2; national monthly daytime cell-days; train 2012–2019,
test 2020–2025 complete non-gap months, 67 months / 6 years):

| model | split | monthly MAPE % | monthly R² | monthly bias % | annual MAPE % | annual R² | annual bias % |
|---|---|---:|---:|---:|---:|---:|---:|
| raw MODIS (baseline) | train | 65.28 | 0.126 | −63.68 | 63.79 | −20.82 | −63.68 |
| a. ratio | train | 14.23 | 0.971 | 0.00 | 3.73 | 0.912 | 0.00 |
| **b. power law** | train | 11.28 | 0.988 | −0.42 | 2.90 | 0.943 | −0.42 |
| c. power law + month | train | 9.49 | 0.990 | −0.06 | 2.90 | 0.944 | −0.06 |
| d. power law per 2° block | train | 9.88 | 0.984 | −4.11 | 4.14 | 0.892 | −4.11 |
| raw MODIS (baseline) | test | 65.74 | 0.097 | −62.64 | 62.52 | −1.95 | −62.64 |
| a. ratio | test | 16.00 | 0.923 | 2.88 | 6.48 | 0.970 | 2.88 |
| **b. power law** | test | **12.39** | **0.967** | **1.26** | **6.41** | **0.974** | **1.26** |
| c. power law + month | test | 14.52 | 0.959 | 2.31 | 6.87 | 0.971 | 2.31 |
| d. power law per 2° block | test | 11.93 | 0.972 | −0.59 | 7.84 | 0.956 | −0.59 |

Model d has a slightly lower monthly MAPE, but it is worse on annual totals and
needs many more parameters. Model b was approved.

**Test scores by period** (`scores_by_period` in `validation.json`; no refit):

| period | months / years | model | monthly MAPE % | monthly R² | monthly bias % | annual MAPE % | annual R² | annual bias % |
|---|---|---|---:|---:|---:|---:|---:|---:|
| 2020–2022 (stable Aqua orbit) | 33 / 3 | a | 14.93 | 0.95 | −0.22 | 4.50 | 0.98 | −0.22 |
| | | b | 10.16 | 0.99 | −3.41 | 3.92 | 0.99 | −3.41 |
| 2023–2025 (Aqua overpass drift) | 34 / 3 | a | 17.04 | 0.81 | +7.96 | 8.45 | −0.37 | +7.96 |
| | | b | 14.56 | 0.88 | +8.93 | 8.91 | −0.40 | +8.93 |
| 2020–2025 (all test years) | 67 / 6 | a | 16.00 | 0.92 | +2.88 | 6.48 | 0.97 | +2.88 |
| | | b | 12.39 | 0.97 | +1.26 | 6.41 | 0.97 | +1.26 |

**Interval coverage.** The leave-one-year-out 80% interval covers 70% of test
months and 3 of 6 test years, so it is somewhat too narrow. The 2012 join is
smooth: observed 2012 VIIRS differs from model b by +0.04%, inside the annual
band (−5.3% / +5.0%).

## Limitations

These are listed under `known_limitations` in `out/validation.json`.

- **National validation only.** Held-out scores measure national monthly
  agreement with VIIRS, not independent wildfire ground truth or the accuracy
  of arbitrary regional selections. Regional interval scaling is not
  independently validated.
- **Measured interval coverage.** The nominal 80% monthly prediction interval
  covered about 70.15% of held-out months. It undercovers; monthly intervals
  must not be added into an annual confidence band.
- **Recent-period performance.** Model B monthly MAPE increased from 10.16%
  in 2020–2022 to 14.56% in 2023–2025. Timing drift and version changes coincide
  with this deterioration; the diagnostics do not establish a causal attribution.
- **Missing observations.** March, April and June 2026 have confirmed missing
  S-NPP days; July 2026 is a modelled gap fill. The app labels incomplete,
  estimated and provisional observations and withholds misleading comparisons.

- **Aqua overpass drift (`aqua_overpass_drift`).** Aqua's median daytime
  overpass holds at about 13:52–13:57 local solar time through 2022, then moves
  later: 14:09 in 2023, 14:31 in 2024, 15:02 in 2025. S-NPP stays near 13:50.
  Model b was trained before the drift and over-predicts 2024 (+12.8%) and 2025
  (+11.7%). Modelled values from 2023 on carry this bias. It does not affect
  2012–2022 or the back-cast.
- **MODIS version change (`modis_version_change`).** The MODIS version field
  goes 6.2 (2012–2017) → 6.03 (2018–2022) → 61.03 (2023–2025); VIIRS is 2
  throughout. The 2023 change coincides with the start of the drift, so the two
  effects can't be separated.
- **Back-cast overpass assumption (`backcast_overpass_assumption`), confirmed.**
  Aqua's 2003–2011 overpass (13:50–13:56) matches the 2012–2019 training years
  (13:52–13:55). The largest yearly difference is 3 min, within a 5 min
  tolerance, against +69 min of drift in 2025.
- **Gap-fill 2024-07 (`gapfill_2024_07`), "likely high, drift period".** It
  shows 6,533 cell-days against 3,773 raw over an 11-day outage, while model b
  over-predicts the neighbouring months by 23–32%.
- **Gap-fill 2026-07 (`gapfill_2026_07`), "drift-period estimate, model b runs
  high since 2023".** It shows 3,053 cell-days (80% interval 2,547–3,648)
  against 2,359 raw. S-NPP had no coverage on Jul 11–16.
- **April 2026 (`live_2026_04_missing_viirs_days`).** S-NPP has no coverage on
  Apr 28–30, which is confirmed worldwide. That is 3 days, under the >3-day
  threshold, so the month is neither flagged nor filled. Raw VIIRS (691) is
  under-counted.
- **Fires straddling cell boundaries (`cell_boundary_straddling`).** A fire on
  a 0.1° cell boundary counts once in every cell it touches, so one event can
  add more than one cell-day per day. The chance differs with pixel size (MODIS
  about 1 km, VIIRS 375 m). Model b absorbs the average effect nationally, but
  not event by event.
- **Other caveats.** These are documented in the contract rather than in
  `known_limitations`:
  - **Unfilled MODIS-gap months.** These are 2005-06, 2014-05, 2016-05,
    2019-05, 2022-04 and 2024-04; the 2005-06 back-cast is built from
    under-counted MODIS.
  - **Under-counted night values** in VIIRS-gap months.
  - **NRT months (2026-08 to 2026-10) are provisional** until FIRMS reprocesses
    them as SP.
  - **Live-year months are not scored.**
  - **Modelled-month footprint.** The spatial pattern of modelled months is the
    MODIS footprint scaled up.
- **Diagnostic table (`diagnostic_table`).** The full version and overpass-time
  table by year, 2003–2025.

## How to run

**Pipeline** (Python 3.12, with pandas, numpy, pyarrow, matplotlib and tabulate):

```sh
python3 -m venv .venv
.venv/bin/python -m pip install pandas numpy pyarrow matplotlib tabulate

# 1. Archive: FIRMS yearly country zips -> modis/<year>/, viirs-snpp/<year>/
bash get_rest.sh Argentina

# 2. Calibration and validation (Task 2): writes out/task2/
.venv/bin/python pipeline/calibration.py

# 3. Live year from the FIRMS API (needs FIRMS_MAP_KEY in env or .env)
.venv/bin/python pipeline/fetch_firms.py                  # fetch missing chunks
.venv/bin/python pipeline/fetch_firms.py --coverage-check # confirm S-NPP outages
# later: --refresh-nrt re-fetches NRT chunks

# 4. Harmonize: writes out/harmonized.parquet, out/national_monthly.parquet,
#    out/validation.json, out/chart_national_series.png
.venv/bin/python pipeline/harmonize.py
```

`harmonize.py` checks its own output and stops on failure:
- cells sum to the national value in every month;
- night is never modelled;
- the model b refit and the Task 2 scores are reproduced.

`pipeline/diagnostics.py [year]` is the one-year Task 1 comparison.

**App** (FastAPI and React/Vite/MapLibre; Python 3.10+, Node 22.11+). For full
details see [`app/README.md`](app/README.md):

```sh
python3 -m venv app/.venv
app/.venv/bin/python -m pip install -r app/api/requirements.txt
DATA_PATH=out/harmonized.parquet app/.venv/bin/python -m uvicorn app.api.main:app --host 127.0.0.1 --port 8000

# second terminal
cd app/web && npm ci && npm run dev    # http://127.0.0.1:5173
```
