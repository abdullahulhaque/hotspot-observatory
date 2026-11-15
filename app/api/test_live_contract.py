"""Application integration checks against the finalized, read-only outputs."""
import csv
import io
import json
from statistics import median

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.parquet as pq
import pytest
from fastapi.testclient import TestClient

from app.api import main
from app.api.quality import annotate

BBOX = '-74,-56,-53,-21'


def test_held_out_prediction_api_matches_saved_scientific_output(live):
    validation = live.get('/validation').json()
    series = validation['prediction_series']
    assert series['status'] == 'ready' and series['scope'] == 'national'
    metadata = json.loads(main.VALIDATION.read_text())
    with (main.ROOT / 'out/task2/predictions_monthly.csv').open() as stream:
        saved = [row for row in csv.DictReader(stream) if int(row['yr']) in metadata['test_years']]
    assert len(series['data']) == len(saved) == 72
    assert sum(row['included'] for row in series['data']) == metadata['interval_80']['test_months_n']
    for row, original in zip(series['data'], saved):
        assert row['model_b'] == float(original['b_power'])
        assert row['actual_viirs'] == float(original['actual_viirs'])
        assert row['gap_flag'] == (original['gap_flag'] == 'True')
        assert row['complete'] == (original['complete'] == 'True')


@pytest.fixture(scope='module')
def live():
    assert main.PRODUCTION.exists(), 'Regenerated real data is required for integration tests'
    return TestClient(main.create_app(main.PRODUCTION))


def test_current_contract_real_complete_month_and_nrt(live):
    meta = live.get('/meta').json()
    assert meta['synthetic'] is False
    assert meta['contract'] == 'harmonized_schema v0.4.1'
    assert meta['end'] == meta['latest_complete_month'] == '2026-10'
    rows = live.get('/series', params=dict(bbox=BBOX, start='2026-08', end='2026-12', daynight='D')).json()['data']
    assert all(r['nrt'] and not r['incomplete'] for r in rows[:3])
    assert all(r['harmonized'] is None for r in rows[3:])


@pytest.mark.parametrize('month,days', [('03',2), ('04',3), ('06',2)])
def test_confirmed_missing_days_suppress_interpretation_despite_no_gap_flag(live, month, days):
    payload = live.get('/anomaly', params=dict(bbox=BBOX, month=f'2026-{month}', daynight='D')).json()
    row = payload['data'][0]
    assert row['source'] == 'observed' and row['gap_flag'] is False
    assert row['missing_snpp_days'] == days and row['incomplete']
    stats = row['metrics']['harmonized']
    assert stats['value'] > 0 and stats['historical_median'] > 0
    assert stats['difference'] is stats['percent_change'] is stats['rank'] is None
    assert stats['comparison_status'] == 'incomplete'


def test_july_gapfill_intervals_night_and_regional_caveat(live):
    params = dict(bbox=BBOX, month='2026-07', daynight='D')
    payload = live.get('/anomaly', params=params).json()
    row = payload['data'][0]
    national = next(r for r in pq.read_table(main.NATIONAL).to_pylist() if r['year']==2026 and r['month']==7 and r.get('daynight','D')=='D')
    assert row['source']=='gapfill' and row['gap_flag'] and not row['incomplete']
    assert row['missing_snpp_days']==6 and row['lo80'] == pytest.approx(national['lo80'])
    assert row['hi80']==pytest.approx(national['hi80'])
    assert row['metrics']['harmonized']['value']==pytest.approx(national['harmonized'])
    assert row['metrics']['raw_viirs']['rank'] is None
    assert any('drift-period' in item['finding'] for item in row['limitations'])
    generated = json.loads(main.VALIDATION.read_text())
    assert payload['interval']['monthly_coverage'] == generated['interval_80']['leave_one_year_out']['monthly_test_coverage']
    region = live.get('/anomaly', params={**params, 'bbox':'-64,-28,-59,-24'}).json()
    selected = region['data'][0]
    assert 0 < selected['metrics']['harmonized']['value'] < row['metrics']['harmonized']['value']
    assert selected['lo80']/selected['metrics']['harmonized']['value'] == pytest.approx(row['lo80']/row['metrics']['harmonized']['value'])
    assert 'not been independently validated' in region['interval']['note']
    night = live.get('/anomaly', params={**params,'daynight':'N'}).json()['data'][0]
    assert night['source']=='observed' and night['incomplete'] and night['lo80'] is None
    assert night['metrics']['harmonized']['rank'] is None


def test_download_preserves_quality_and_real_regional_values(live):
    params = dict(bbox='-64,-28,-59,-24', start='2026-03', end='2026-10', daynight='D')
    series = live.get('/series',params=params).json()['data']
    response = live.get('/export.csv',params=params)
    assert response.status_code==200 and response.headers['x-synthetic-data']=='false'
    assert 'attachment' in response.headers['content-disposition']
    exported = list(csv.DictReader(io.StringIO(response.text)))
    for row, original in zip(exported, series, strict=True):
        assert float(row['harmonized']) == original['harmonized']
        assert row['source']==original['source']
        assert row['nrt']==str(original['nrt']) and row['incomplete']==str(original['incomplete'])
        assert row['synthetic']=='false' and 'raw_modis' not in row
    assert exported[4]['limitations'] and exported[4]['lo80']


def test_real_harmonized_baselines_and_ranks_exclude_incomplete_and_unavailable_months(live):
    bbox = '-64,-28,-59,-24'
    records = live.get('/series', params=dict(bbox=bbox, start='2003-01', end='2026-10', daynight='D')).json()['data']
    excluded = []
    for month in range(1, 11):
        earlier = [r for r in records if r['year'] < 2026 and r['month'] == month]
        comparable = [r for r in earlier if r['harmonized'] is not None and 'harmonized' not in r['incomplete_metrics']]
        excluded.extend(r for r in earlier if r not in comparable)
        current = next(r for r in records if r['year'] == 2026 and r['month'] == month)
        stats = live.get('/anomaly', params=dict(bbox=bbox, month=f'2026-{month:02}', daynight='D')).json()['data'][0]['metrics']['harmonized']
        expected = median(r['harmonized'] for r in comparable)
        assert stats['historical_median'] == pytest.approx(expected)
        assert stats['baseline_years'] == [r['year'] for r in comparable]
        if current['incomplete']:
            assert stats['difference'] is stats['percent_change'] is stats['rank'] is None
        else:
            assert stats['difference'] == pytest.approx(current['harmonized'] - expected)
            assert stats['percent_change'] == pytest.approx(100 * (current['harmonized'] - expected) / expected)
            assert stats['rank'] == 1 + sum(r['harmonized'] > current['harmonized'] for r in comparable)
            assert stats['rank_count'] == len(comparable) + 1
    assert excluded, 'Real-data verification must exercise an excluded historical month'


def test_all_measurement_export_preserves_raw_values_and_metric_specific_completeness(live):
    params = dict(bbox='-64,-38,-59,-33', start='2026-03', end='2026-10', daynight='D')
    records = live.get('/series', params=params).json()['data']
    response = live.get('/export.csv', params={**params, 'metric': 'all'})
    exported = list(csv.DictReader(io.StringIO(response.text)))
    for actual, expected in zip(exported, records, strict=True):
        for metric in main.METRICS:
            assert actual[metric] == '' if expected[metric] is None else float(actual[metric]) == expected[metric]
        assert actual['source'] == expected['source']
        assert actual['incomplete'] == str(bool(expected['incomplete_metrics']))
        assert actual['incomplete_metrics'] == ';'.join(expected['incomplete_metrics'])


@pytest.mark.parametrize('bbox', [BBOX, '-64,-28,-59,-24', '-64,-38,-59,-33', '-71,-50,-67,-40', '-63,-27,-61,-25'])
def test_live_regional_values_match_direct_production_parquet(live, bbox):
    west, south, east, north = map(float, bbox.split(','))
    dataset = ds.dataset(main.PRODUCTION, format='parquet')
    for year, month in [(2011, 7), (2024, 7), (2026, 7)]:
        selection = ((ds.field('lon') >= west) & (ds.field('lon') <= east)
                     & (ds.field('lat') >= south) & (ds.field('lat') <= north)
                     & (ds.field('year') == year) & (ds.field('month') == month) & (ds.field('daynight') == 'D'))
        table = dataset.to_table(columns=list(main.METRICS), filter=selection)
        key = f'{year}-{month:02}'
        response = live.get('/series', params=dict(bbox=bbox, start=key, end=key, daynight='D'))
        assert response.status_code == 200
        payload = response.json()
        assert payload['synthetic'] is False and payload['unit'] == 'active cell-days'
        for metric in main.METRICS:
            if not table.num_rows:
                # The v0.4.1 contract omits covered cells with zero activity.
                # VIIRS before its record begins remains unavailable, never zero.
                expected = None if metric == 'raw_viirs' and year < 2012 else 0
                assert payload['data'][0][metric] == expected
            elif table[metric].null_count:
                assert payload['data'][0][metric] is None
            else:
                assert payload['data'][0][metric] == pytest.approx(pc.sum(table[metric]).as_py())


def test_missing_production_never_falls_back(monkeypatch, tmp_path):
    monkeypatch.delenv('DATA_PATH', raising=False)
    monkeypatch.setattr(main, 'PRODUCTION', tmp_path/'missing.parquet')
    assert TestClient(main.create_app()).get('/meta').status_code==503


def test_real_missing_intervals_never_invents_values(tmp_path):
    c = TestClient(main.create_app(main.PRODUCTION, national_path=tmp_path/'missing.parquet'))
    result = c.get('/series',params=dict(bbox=BBOX,start='2026-07',end='2026-07',daynight='D')).json()
    assert result['synthetic'] is result['interval']['synthetic'] is False
    assert result['interval']['source']=='unavailable' and result['data'][0]['lo80'] is None


def test_current_contract_development_fixture_and_bad_nrt(tmp_path):
    # App-owned temporary fixture; never rewrite the scientific outputs or legacy fixture.
    schema = pa.schema([*main.TYPES.items(), ('nrt',pa.bool_())], metadata={b'synthetic':b'true',b'contract':b'harmonized_schema v0.4.1'})
    row = dict(lat=-25.05,lon=-60.05,year=2026,month=10,daynight='D',raw_modis=3.,raw_viirs=5.,harmonized=5.,source='observed',gap_flag=False,nrt=True)
    path=tmp_path/'current_fixture.parquet'
    pq.write_table(pa.Table.from_pylist([row],schema=schema),path)
    c=TestClient(main.create_app(path))
    assert c.get('/meta').json()['synthetic'] is True
    result=c.get('/series',params=dict(bbox=BBOX,start='2026-10',end='2026-10',daynight='D')).json()
    assert result['data'][0]['nrt'] is True
    pq.write_table(pa.Table.from_pylist([{**row,'nrt':None}],schema=schema),path)
    assert c.get('/meta').status_code==503


def test_quality_uses_sensor_supplying_harmonized_value():
    metadata={'gap_flagged_months':[{'month_str':'2024-04','sensor_missing':'MODIS'}]}
    rows=[dict(year=2024,month=4,source='observed'),dict(year=2024,month=4,source='backcast')]
    result=annotate(rows,metadata)
    assert result[0]['incomplete_metrics']==['raw_modis']
    assert result[1]['incomplete_metrics']==['raw_modis','harmonized']


def test_missing_metadata_withholds_anomalies(tmp_path):
    c=TestClient(main.create_app(main.PRODUCTION,validation_path=tmp_path/'missing.json'))
    row=c.get('/anomaly',params=dict(bbox=BBOX,month='2026-03',daynight='D')).json()['data'][0]
    assert not row['quality_available']
    assert row['metrics']['harmonized']['percent_change'] is None
    assert row['metrics']['harmonized']['rank'] is None
