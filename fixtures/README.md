# Argentina synthetic fixture

`synthetic_harmonized.parquet` contains entirely invented monthly active
cell-days for 2003–2024, at 280 sampled 0.1° cell centres across Argentina.
It is not NASA/FIRMS observational data and is not suitable for scientific
conclusions or model validation. The API prefers `out/harmonized.parquet`
when present; use `DATA_PATH=fixtures/synthetic_harmonized.parquet` to select
this fixture explicitly.

The fixture follows v0.3 column types and source semantics, with unique
cell/month/daynight keys and Snappy compression. Daytime before 2012 is
`backcast`; daytime January 2012, July/August 2022 and July 2024 is `gapfill`;
all other rows are `observed`. The ten contract gap months are flagged in
both periods, including June 2005. Missing-sensor activity is synthetically
reduced, while raw VIIRS values remain separate from model estimates.

Modelled daytime months use the invented factor 1.8 × raw MODIS, including
zero in VIIRS-only cells. Other months use invented VIIRS. Nighttime and raw
VIIRS remain null before 2012; night is never back-cast or gap-filled. All
values and calibration metadata are explicitly synthetic, not fitted scores.
Metadata records `contract=harmonized_schema v0.3`,
`unit=active_cell_days_0.1deg` and `synthetic=true`.

Regenerate from the repository root:

```sh
app/.venv/bin/python fixtures/generate.py
```

The generator writes only `fixtures/synthetic_harmonized.parquet`. It reads
no observations and does not write to `out/`. Its random seed is fixed.

`argentina.geojson` is the Argentina geometry from Natural Earth's public-domain
[1:110m Admin 0 countries dataset](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson).
The simplified country boundary indicates the country coverage domain;
it does not imply every cell has an observation. The generator samples
only cell centres within that boundary.
