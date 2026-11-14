"""Reproducible invented Argentina cell-days; writes only into fixtures/."""
from pathlib import Path
import calendar
import json
import math
import random
import pyarrow as pa
import pyarrow.parquet as pq

VIIRS_GAPS = {(2012, 1), (2022, 7), (2022, 8), (2024, 7)}
MODIS_GAPS = {(2005, 6), (2014, 5), (2016, 5), (2019, 5), (2022, 4), (2024, 4)}


def inside_ring(lon, lat, ring):
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def generate():
    rng = random.Random(20261114)
    geometry = json.loads(Path(__file__).with_name('argentina.geojson').read_text())['geometry']
    polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    cells = [(round(lat + .05, 2), round(lon + .05, 2))
             for lat in range(-55, -21) for lon in range(-74, -53)
             if any(inside_ring(lon + .05, lat + .05, p[0]) and not any(inside_ring(lon + .05, lat + .05, h) for h in p[1:]) for p in polygons)]
    schema = pa.schema([
        pa.field('lat', pa.float64(), nullable=False), pa.field('lon', pa.float64(), nullable=False),
        pa.field('year', pa.int16(), nullable=False), pa.field('month', pa.int8(), nullable=False),
        pa.field('daynight', pa.string(), nullable=False), pa.field('raw_modis', pa.float64()),
        pa.field('raw_viirs', pa.float64()), pa.field('harmonized', pa.float64()),
        pa.field('source', pa.string(), nullable=False), pa.field('gap_flag', pa.bool_(), nullable=False),
    ], metadata={b'unit': b'active_cell_days_0.1deg', b'calibration': b'synthetic demonstration only',
                 b'synthetic': b'true', b'schema_version': b'0.3', b'country': b'Argentina',
                 b'contract': b'harmonized_schema v0.3',
                 b'calibration_detail': b'{"factor": 1.8, "scope": "synthetic daytime modelled months only"}',
                 b'filters': b'Simulated activity; no observational inputs or filters applied',
                 b'description': b'Invented demonstration values; not NASA observations.'})
    rows = []
    for year in range(2003, 2025):
        for month in range(1, 13):
            days = calendar.monthrange(year, month)[1]
            gap = (year, month) in VIIRS_GAPS | MODIS_GAPS
            for period in ('D', 'N'):
                for lat, lon in cells:
                    if rng.random() < .18:
                        continue
                    peak = 9 if lat > -32 else 1
                    season = .2 + .8 * max(0, math.cos((month - peak) * math.pi / 6)) ** 2
                    base = (5 + (lat + 55) / 3) * season * (1 if period == 'D' else .5)
                    modis = float(min(days, max(1, round(base * rng.uniform(.5, 1.4) * (.5 if (year, month) in MODIS_GAPS else 1)))))
                    viirs = float(min(days, round(base * rng.uniform(1.3, 2.2) * (.5 if (year, month) in VIIRS_GAPS else 1)))) if year >= 2012 else None
                    if viirs and rng.random() < .08:
                        modis = 0.0  # VIIRS-only cells stay zero in modelled spatial footprints.
                    backcast = year < 2012 and period == 'D'
                    gapfill = period == 'D' and (year, month) in VIIRS_GAPS
                    harmonized = round(modis * 1.8, 2) if backcast or gapfill else viirs
                    rows.append(dict(lat=lat, lon=lon, year=year, month=month, daynight=period,
                                     raw_modis=modis, raw_viirs=viirs, harmonized=harmonized,
                                     source='backcast' if backcast else 'gapfill' if gapfill else 'observed', gap_flag=gap))
    destination = Path(__file__).with_name('synthetic_harmonized.parquet')
    pq.write_table(pa.Table.from_pylist(rows, schema=schema), destination, compression='snappy')
    print(f'Wrote {len(rows):,} synthetic rows across {len(cells)} Argentina cells to {destination}')


if __name__ == '__main__':
    generate()
