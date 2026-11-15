import csv
import io
from statistics import median

import pyarrow as pa
import pyarrow.dataset as ds
import pyarrow.parquet as pq
import pytest
from fastapi.testclient import TestClient

from app.api.main import FIXTURE, METRICS, TYPES, PRODUCTION, NATIONAL, create_app, annual_records, summarize_area
from fixtures.generate import VIIRS_GAPS, MODIS_GAPS


@pytest.fixture(scope="module")
def client():
    return TestClient(create_app(FIXTURE))


def test_fixture_contract():
    table = pq.read_table(FIXTURE)
    assert table.schema.names == list(TYPES)
    for name, dtype in TYPES.items():
        assert table.schema.field(name).type == dtype
    rows = table.to_pylist()
    keys = [(r["lat"], r["lon"], r["year"], r["month"], r["daynight"]) for r in rows]
    assert len(keys) == len(set(keys))
    assert table.schema.metadata[b"synthetic"] == b"true"
    assert table.schema.metadata[b"calibration"] == b"synthetic demonstration only"
    assert table.schema.metadata[b"contract"] == b"harmonized_schema v0.3"
    assert table.schema.metadata[b"unit"] == b"active_cell_days_0.1deg"
    assert {r['source'] for r in rows} == {'backcast', 'gapfill', 'observed'}
    assert any(r['source'] == 'gapfill' and r['raw_modis'] == 0 and r['raw_viirs'] > 0 for r in rows)
    for row in rows:
        assert row["daynight"] in ("D", "N") and 1 <= row["month"] <= 12
        assert row["raw_modis"] > 0 or (row["raw_viirs"] or 0) > 0
        ym = (row['year'], row['month'])
        expected_source = 'backcast' if row['year'] < 2012 and row['daynight'] == 'D' else 'gapfill' if ym in VIIRS_GAPS and row['daynight'] == 'D' else 'observed'
        assert row['source'] == expected_source
        assert row['gap_flag'] == (ym in VIIRS_GAPS | MODIS_GAPS)
        if row['source'] in ('backcast', 'gapfill'):
            assert row['harmonized'] == pytest.approx(row['raw_modis'] * 1.8)
        else:
            assert row['harmonized'] == row['raw_viirs']
        assert isinstance(row['gap_flag'], bool)
        assert (row['harmonized'] is None) == (row['daynight'] == 'N' and row['year'] < 2012)
        assert row["year"] >= 2012 or row["raw_viirs"] is None
        for key in ("lat", "lon"):
            cell_index = (row[key] - 0.05) / 0.1
            assert cell_index == pytest.approx(round(cell_index), abs=1e-8)
    assert all(not table.schema.field(key).nullable for key in list(TYPES)[:5])
    assert all(not table.schema.field(key).nullable for key in ('source', 'gap_flag'))
    assert pq.ParquetFile(FIXTURE).metadata.row_group(0).column(0).compression == "SNAPPY"


def test_series_matches_direct_fixture_sum(client):
    result = client.get('/series', params=dict(bbox='-64,-28,-59,-24', start='2024-08', end='2024-08')).json()
    assert result['synthetic'] is True
    assert [r['daynight'] for r in result['data']] == ['D', 'N']
    rows = pq.read_table(FIXTURE).to_pylist()
    for period in ('D', 'N'):
        expected = sum(r['raw_modis'] for r in rows if -64 <= r['lon'] <= -59 and -28 <= r['lat'] <= -24
                       and r['year'] == 2024 and r['month'] == 8 and r['daynight'] == period)
        actual = next(r for r in result['data'] if r['daynight'] == period)
        assert actual['raw_modis'] == expected
        assert actual['harmonized'] == actual['raw_viirs']


def test_empty_region_is_not_reported_as_zero(client):
    result = client.get('/series', params=dict(bbox='0,0,1,1', start='2010-01', end='2010-02', daynight='D')).json()
    assert result['has_data'] is False
    assert len(result['data']) == 2
    for row in result['data']:
        assert row['raw_modis'] is None
        assert row['raw_viirs'] is None
        assert row['harmonized'] is None
    future = client.get('/series', params=dict(bbox='0,0,1,1', start='2030-01', end='2030-01')).json()
    assert all(row['raw_modis'] is None for row in future['data'])


def test_anomaly_prior_years_only(client):
    params = dict(bbox='-64,-28,-59,-24', month='2020-08', daynight='N')
    anomaly = client.get('/anomaly', params=params).json()
    assert anomaly['synthetic'] is True
    stats = anomaly['data'][0]['metrics']['raw_modis']
    assert stats['baseline_years'] == list(range(2003, 2020))
    series = client.get('/series', params=dict(bbox=params['bbox'], start='2003-08', end='2020-08', daynight='N')).json()['data']
    expected = median(r['raw_modis'] for r in series if r['month'] == 8 and r['year'] < 2020)
    assert stats['historical_median'] == expected
    assert stats['difference'] == stats['value'] - expected
    assert stats['percent_change'] == pytest.approx(100 * stats['difference'] / expected)


def test_anomaly_empty_baseline_and_zero_baseline(client):
    first = client.get('/anomaly', params=dict(bbox='-64,-28,-59,-24', month='2003-08')).json()
    stats = first['data'][0]['metrics']['raw_modis']
    assert stats['historical_median'] is None and stats['sample_size'] == 0
    empty = client.get('/anomaly', params=dict(bbox='0,0,1,1', month='2024-08')).json()
    stats = empty['data'][0]['metrics']['raw_modis']
    assert stats['historical_median'] is None and stats['difference'] is None and stats['percent_change'] is None


def test_csv_matches_series(client):
    params = dict(bbox='-64,-28,-59,-24', start='2011-12', end='2012-01', daynight='N')
    response = client.get('/export.csv', params={**params, 'metric': 'all'})
    assert response.status_code == 200
    assert response.headers['x-synthetic-data'] == 'true'
    exported = list(csv.DictReader(io.StringIO(response.text)))
    series = client.get('/series', params=params).json()['data']
    assert len(exported) == len(series)
    for actual, expected in zip(exported, series):
        assert actual['synthetic'] == 'true'
        assert actual['daynight'] == 'N'
        for metric in METRICS:
            assert actual[metric] == '' if expected[metric] is None else float(actual[metric]) == expected[metric]


@pytest.mark.parametrize('changes', [
    {'bbox': 'NaN,0,1,1'}, {'bbox': '0,0,1'}, {'bbox': '0,0,1,1,2'},
    {'bbox': '-181,0,1,1'}, {'bbox': '0,10,1,0'}, {'bbox': '0,0,0,1'},
    {'start': '2020-13'}, {'start': '0000-01'}, {'start': '2021-01'},
    {'end': '2020-2'}, {'daynight': 'day'}, {'start': '1800-01'},
])
def test_invalid_queries(client, changes):
    params = dict(bbox='0,0,1,1', start='2020-01', end='2020-12') | changes
    assert client.get('/series', params=params).status_code == 422
    assert client.get('/export.csv', params=params).status_code == 422


@pytest.fixture
def custom_table():
    rows = [dict(lat=0.05, lon=lon, year=year, month=8, daynight='D', raw_modis=value,
                 raw_viirs=value * 2, harmonized=harm, source='observed', gap_flag=False)
            for lon, year, value, harm in [(179.95, 2019, 2., 3.), (-179.95, 2019, 4., 5.),
                                            (0.05, 2019, 20., None), (179.95, 2020, 10., 11.)]]
    return pa.Table.from_pylist(rows, schema=pa.schema(list(TYPES.items()), metadata={b'unit': b'detections', b'calibration': b'test-only'}))


def test_env_path_hive_and_antimeridian(tmp_path, monkeypatch, custom_table):
    root = tmp_path / 'hive'
    ds.write_dataset(custom_table, root, format='parquet',
                     partitioning=ds.partitioning(pa.schema([('year', pa.int16())]), flavor='hive'))
    monkeypatch.setenv('DATA_PATH', str(root))
    client = TestClient(create_app())
    assert client.get('/meta').json()['synthetic'] is False
    data = client.get('/series', params=dict(bbox='170,-1,-170,1', start='2019-08', end='2019-08', daynight='D')).json()['data'][0]
    assert data['raw_modis'] == 6 and data['harmonized'] == 8
    night = client.get('/series', params=dict(bbox='170,-1,-170,1', start='2019-08', end='2019-08', daynight='N')).json()['data'][0]
    assert night['raw_modis'] == 0  # Covered year, but no nighttime activity anywhere.
    # Partial null aggregates must not masquerade as complete totals.
    data = client.get('/series', params=dict(bbox='-180,-1,180,1', start='2019-08', end='2019-08', daynight='D')).json()['data'][0]
    assert data['raw_modis'] == 26 and data['harmonized'] is None


def test_copied_fixture_remains_synthetic(tmp_path):
    path = tmp_path / 'copy.parquet'
    path.write_bytes(FIXTURE.read_bytes())
    assert TestClient(create_app(path)).get('/meta').json()['synthetic'] is True


def test_missing_data_does_not_fall_back_to_fixture(tmp_path):
    response = TestClient(create_app(tmp_path / 'missing')).get('/meta')
    assert response.status_code == 503


@pytest.mark.parametrize('bbox', ['-64,-28,-59,-24', '-64,-38,-59,-33', '-71,-50,-67,-40'])
def test_argentina_presets_have_activity(client, bbox):
    payload = client.get('/series', params=dict(bbox=bbox, start='2003-01', end='2024-12', daynight='D')).json()
    assert payload['has_data'] and payload['unit'] == 'active cell-days'
    assert sum(r['raw_modis'] for r in payload['data']) > 0
    assert payload['data'][0]['source'] == 'backcast'
    assert any(r['gap_flag'] for r in payload['data'])


def test_night_never_backcast(client):
    payload = client.get('/series', params=dict(bbox='-64,-28,-59,-24', start='2003-01', end='2012-01', daynight='N')).json()
    for row in payload['data'][:-1]:
        assert row['raw_modis'] is not None
        assert row['harmonized'] is row['raw_viirs'] is row['lo80'] is row['hi80'] is None
        assert row['source'] == 'observed'
    assert payload['data'][-1]['harmonized'] is not None


def test_interval_fallback_and_national_scaling(tmp_path):
    national = tmp_path / 'national.parquet'
    c = TestClient(create_app(FIXTURE, national_path=national))
    params = dict(bbox='-64,-28,-59,-24', start='2003-01', end='2003-01', daynight='D')
    payload = c.get('/series', params=params).json()
    r = payload['data'][0]
    assert payload['interval']['source'] == 'synthetic'
    assert r['lo80'] == pytest.approx(.8*r['harmonized'])
    pq.write_table(pa.Table.from_pylist([dict(year=2003,month=1,harmonized=100.,lo80=70.,hi80=140.)]), national)
    payload = c.get('/series', params=params).json()
    r = payload['data'][0]
    assert payload['interval']['source'] == 'national_scaled'
    assert r['lo80'] == pytest.approx(.7*r['harmonized'])
    assert r['hi80'] == pytest.approx(1.4*r['harmonized'])
    national.write_bytes(b'not parquet')
    payload = c.get('/series', params=params).json()
    assert payload['interval']['source'] == 'unavailable'
    assert payload['data'][0]['lo80'] is None


def test_validation_missing_ready_invalid_and_refresh(tmp_path):
    import json
    path = tmp_path / 'validation.json'
    c = TestClient(create_app(FIXTURE, validation_path=path))
    assert c.get('/validation').json()['status'] == 'pending'
    path.write_text(json.dumps({'held_out':'2020–2024', 'metrics':[{'name':'MAPE','unit':'%', 'raw_modis':66.5,'harmonized':11.6}]}))
    payload = c.get('/validation').json()
    assert payload['status'] == 'ready'
    assert payload['metrics'][0]['harmonized'] == 11.6
    scores = {sensor: {period: {'MAPE_pct': value, 'bias_pct': -value, 'R2': .8} for period in ('monthly','annual')} for sensor, value in [('raw_modis', 60), ('model_b', 12)]}
    path.write_text(json.dumps({'scores_test': scores, 'test_years':[2020,2021]}))
    assert c.get('/validation').json()['metrics'][0]['harmonized'] == 12
    path.write_text('{invalid')
    assert c.get('/validation').json()['status'] == 'invalid'


def test_gapfill_and_gap_flag_propagate(tmp_path, custom_table):
    rows = custom_table.to_pylist()
    rows[0]['source'] = 'gapfill'
    rows[0]['gap_flag'] = True
    path = tmp_path / 'gaps.parquet'
    pq.write_table(pa.Table.from_pylist(rows, schema=custom_table.schema), path)
    c = TestClient(create_app(path))
    params = dict(bbox='170,-1,-170,1',start='2019-08',end='2019-08',daynight='D')
    row = c.get('/series', params=params).json()['data'][0]
    assert row['source'] == 'gapfill' and row['gap_flag'] is True
    exported = list(csv.DictReader(io.StringIO(c.get('/export.csv',params=params).text)))[0]
    assert exported['source'] == 'gapfill' and exported['gap_flag'] == 'True'


def test_fixture_env_keeps_development_mode(monkeypatch):
    monkeypatch.setenv('DATA_PATH', 'fixtures/synthetic_harmonized.parquet')
    c = TestClient(create_app())
    assert c.get('/meta').json()['synthetic'] is True
    payload = c.get('/series', params=dict(bbox='-74,-56,-53,-21', start='2024-07', end='2024-07', daynight='D')).json()
    assert payload['synthetic'] is True
    row = payload['data'][0]
    assert row['source'] == 'gapfill' and row['gap_flag'] is True
    assert row['harmonized'] != row['raw_viirs']
    night = c.get('/series', params=dict(bbox='-74,-56,-53,-21', start='2024-07', end='2024-07', daynight='N')).json()['data'][0]
    assert night['source'] == 'observed' and night['gap_flag'] is True
    assert night['harmonized'] == night['raw_viirs']
    assert night['lo80'] is night['hi80'] is None


@pytest.mark.skipif(not PRODUCTION.exists() or not NATIONAL.exists(), reason='Real Argentina files not installed')
def test_real_env_and_national_intervals_match_contract(monkeypatch):
    monkeypatch.setenv('DATA_PATH', 'out/harmonized.parquet')
    c = TestClient(create_app())
    meta = c.get('/meta').json()
    assert meta['synthetic'] is False and meta['unit'] == 'active cell-days'
    payload = c.get('/series', params=dict(bbox='-74,-56,-53,-21', start=meta['start'], end=meta['end'], daynight='D')).json()
    assert payload['synthetic'] is False
    assert payload['interval']['source'] == 'national_scaled'
    assert payload['interval']['synthetic'] is False
    national = {(r['year'], r['month']): r for r in pq.read_table(NATIONAL).to_pylist()}
    for row in payload['data']:
        expected = national[(row['year'], row['month'])]
        assert row['source'] == expected['source']
        assert row['gap_flag'] == expected['gap_flag']
        for metric in (*METRICS, 'lo80', 'hi80'):
            if expected[metric] is None:
                assert row[metric] is None
            else:
                assert row[metric] == pytest.approx(expected[metric])


@pytest.mark.parametrize('month,source', [('2011-08','backcast'), ('2012-01','gapfill'), ('2024-08','observed')])
def test_harmonized_anomaly_same_series_for_value_and_baseline(client, month, source):
    bbox = '-64,-28,-59,-24'
    result = client.get('/anomaly', params=dict(bbox=bbox, month=month, daynight='D')).json()
    assert result['metric'] == 'harmonized'
    row = result['data'][0]
    assert row['source'] == source
    stats = row['metrics']['harmonized']
    series = client.get('/series', params=dict(bbox=bbox, start='2003-01', end=month, daynight='D')).json()['data']
    year, selected_month = map(int, month.split('-'))
    expected = median(r['harmonized'] for r in series if r['month'] == selected_month and r['year'] < year and r['harmonized'] is not None)
    assert stats['value'] == series[-1]['harmonized']
    assert stats['historical_median'] == expected
    assert stats['percent_change'] == pytest.approx(100*(stats['value']-expected)/expected)


def test_csv_defaults_to_harmonized_and_raw_is_explicit(client):
    params = dict(bbox='-64,-28,-59,-24', start='2011-01', end='2011-01', daynight='D')
    payload = client.get('/series', params=params).json()['data'][0]
    for requested in (None, 'raw_modis', 'raw_viirs'):
        response = client.get('/export.csv', params=params if requested is None else {**params, 'metric': requested})
        metric = requested or 'harmonized'
        row = list(csv.DictReader(io.StringIO(response.text)))[0]
        assert set(row) & set(METRICS) == {metric}
        assert row[metric] == '' if payload[metric] is None else float(row[metric]) == payload[metric]
    assert client.get('/export.csv', params={**params, 'metric': 'invalid'}).status_code == 422


def test_annual_splice_rankings_and_peak_exclude_partial_years():
    rows = [dict(year=year, month=month, raw_modis=float(month), raw_viirs=float(month*2) if year >= 2012 else None,
                 harmonized=float((year-2000)*month), gap_flag=(year == 2012 and month == 1))
            for year in range(2010, 2019) for month in range(1, 13) if year != 2018 or month <= 6]
    rows[next(i for i, r in enumerate(rows) if r['year'] == 2017 and r['month'] == 8)]['harmonized'] = None
    annual = {r['year']:r for r in annual_records(rows)}
    assert annual[2011]['naive_splice'] == 78
    assert annual[2012]['naive_splice'] == 156
    assert annual[2012]['harmonized'] == 12*78
    assert annual[2012]['gap_flag'] is True
    assert annual[2018]['harmonized'] is None and annual[2018]['complete'] is False
    assert annual[2017]['harmonized'] is None
    summary = summarize_area(rows)
    assert [r['year'] for r in summary['top_years']] == [2016, 2015, 2014, 2013, 2012]
    assert summary['peak_month'] == {'month': 12, 'mean': 13*12, 'years': 7}
    assert summarize_area([])['peak_month'] is None


def test_area_summary_matches_selected_area_full_record(client):
    params = dict(bbox='-71,-50,-67,-40', daynight='N')
    result = client.get('/area-summary', params=params).json()
    assert result['daynight'] == 'N'
    assert result['complete_years'] == 13  # 2012 through 2024, no nighttime back-casts.
    monthly = client.get('/series', params={**params, 'start':'2003-01', 'end':'2024-12'}).json()['data']
    assert result['top_years'] == summarize_area(monthly)['top_years']
    assert result['annual_daytime'][0]['harmonized'] > 0  # Chart stays daytime.
    empty = client.get('/area-summary', params=dict(bbox='0,0,1,1')).json()
    assert empty['has_data'] is False and empty['top_years'] == [] and empty['peak_month'] is None
    assert client.get('/area-summary', params={**params, 'daynight':''}).status_code == 422


def test_meta_refreshes_latest_month_when_file_changes(tmp_path, custom_table):
    path = tmp_path / 'updates.parquet'
    pq.write_table(custom_table, path)
    c = TestClient(create_app(path))
    assert c.get('/meta').json()['end'] == '2020-08'
    rows = custom_table.to_pylist()
    rows.append({**rows[-1], 'year': 2025, 'month': 12})
    pq.write_table(pa.Table.from_pylist(rows, schema=custom_table.schema), path)
    assert c.get('/meta').json()['end'] == '2025-12'


def test_anomaly_rank_uses_only_current_and_earlier_same_months(tmp_path, custom_table):
    rows = custom_table.to_pylist()
    rows.extend([{**rows[-1], 'year': 2021}, {**rows[-1], 'year': 2022, 'harmonized': 99.}])
    path = tmp_path / 'ranks.parquet'
    pq.write_table(pa.Table.from_pylist(rows, schema=custom_table.schema), path)
    c = TestClient(create_app(path))
    payload = c.get('/anomaly', params=dict(bbox='179,-1,180,1', month='2021-08', daynight='D')).json()
    stats = payload['data'][0]['metrics']['harmonized']
    assert stats['value'] == 11 and stats['historical_median'] == 7
    assert stats['rank'] == 1 and stats['rank_count'] == 3 and stats['rank_tied'] is True
    absent = c.get('/anomaly', params=dict(bbox='0,20,1,21', month='2021-08', daynight='D')).json()['data'][0]['metrics']['harmonized']
    assert absent['rank'] is None and absent['rank_count'] == 0


def test_validation_all_periods_and_limitations_without_invented_raw_scores(tmp_path):
    import json
    def scores(value):
        return {frequency: {'MAPE_pct': value, 'bias_pct': value-1, 'R2': .9} for frequency in ('monthly','annual')}
    payload = {'test_years': [2020,2021,2022,2023,2024,2025],
               'model': {'train_years': list(range(2012, 2020)), 'form': 'existing calibration'},
               'scores_test': {'raw_modis': scores(60), 'model_b': scores(12)},
               'scores_by_period': {'definition':'held-out only', '2020-2022': {'model_a':scores(20), 'model_b':scores(10)},
                                    '2023-2025': {'model_b':scores(14)}, '2020-2025': {'model_a':scores(16), 'model_b':scores(12)}},
               'known_limitations':[{'id':'aqua_overpass_drift', 'finding':'Aqua overpass drift since 2023', 'impact':'Model relation can change.'}]}
    path = tmp_path / 'validation.json'
    path.write_text(json.dumps(payload))
    result = TestClient(create_app(FIXTURE, validation_path=path)).get('/validation').json()
    assert result['status'] == 'ready'
    assert [p['label'] for p in result['periods']] == ['2020-2022','2023-2025','2020-2025']
    assert all(m['raw_modis'] is None for m in result['periods'][0]['metrics'])
    assert result['periods'][0]['metrics'][0]['harmonized'] == 10
    assert result['periods'][2]['metrics'][0]['raw_modis'] == 60
    assert result['metrics'][0]['model_a'] == 16
    assert result['periods'][0]['metrics'][0]['model_a'] == 20
    assert result['periods'][1]['metrics'][0]['model_a'] is None
    assert result['model'] == payload['model']
    assert result['test_years'] == payload['test_years']
    assert result['known_limitations'] == payload['known_limitations']
    payload['scores_by_period']['2020-2025']['model_a']['monthly']['MAPE_pct'] = 'invalid'
    path.write_text(json.dumps(payload))
    assert TestClient(create_app(FIXTURE, validation_path=path)).get('/validation').json()['status'] == 'invalid'
