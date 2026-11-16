"""Checks for the redesign's scientific additions, against the real read-only outputs.

Every new number must trace back to the committed files: the map grid sums to the
regional series, the rebuilt interval reproduces the reported coverage, the model
comparison is the saved Task 2 table, and the anomaly baseline values reproduce
the reported median.
"""
import csv
import json
import math
from statistics import median

import pytest
from fastapi.testclient import TestClient

from app.api import main
from app.api.validation_predictions import attach_interval, read_model_comparison

ALL = '-74,-56,-53,-21'


@pytest.fixture(scope='module')
def client():
    return TestClient(main.create_app(main.PRODUCTION))


@pytest.mark.parametrize('month,daynight,metric', [
    ('2025-09', 'D', 'harmonized'), ('2005-08', 'D', 'harmonized'), ('2024-07', 'D', 'harmonized'),
    ('2019-09', 'N', 'raw_viirs'), ('2010-09', 'D', 'raw_modis')])
def test_grid_cells_sum_to_national_series(client, month, daynight, metric):
    grid = client.get(f'/grid?month={month}&daynight={daynight}&metric={metric}').json()
    series = client.get(f'/series?bbox={ALL}&start={month}&end={month}&daynight={daynight}').json()['data'][0]
    assert grid['available'] and grid['count'] > 0
    assert math.isclose(grid['total'], series[metric], rel_tol=1e-9)
    assert grid['max'] == max(cell[2] for cell in grid['cells'])
    assert grid['source'] == series['source'] or metric != 'harmonized'
    assert all(cell[2] > 0 for cell in grid['cells'])


def test_grid_never_invents_unavailable_months(client):
    assert client.get('/grid?month=2005-01&daynight=N&metric=harmonized').json()['available'] is False
    assert client.get('/grid?month=2008-01&daynight=D&metric=raw_viirs').json()['available'] is False
    held_back = client.get('/grid?month=2026-11&daynight=D').json()
    assert held_back['available'] is False and held_back['count'] == 0
    assert client.get('/grid?month=2025-13').status_code == 422
    assert client.get('/grid?month=2025-01&daynight=X').status_code == 422
    assert client.get('/grid?month=2025-01&metric=frp').status_code == 422


def test_rebuilt_interval_reproduces_reported_coverage(client):
    series = client.get('/validation').json()['prediction_series']
    metadata = json.loads(main.VALIDATION.read_text())
    loyo = metadata['interval_80']['leave_one_year_out']
    interval = series['interval']
    assert interval['status'] == 'ready'
    assert interval['coverage'] == loyo['monthly_test_coverage']
    assert interval['months_scored'] == metadata['interval_80']['test_months_n'] == 67
    included = [row for row in series['data'] if row['included']]
    assert sum(row['actual_viirs'] >= row['lo80'] and row['actual_viirs'] <= row['hi80'] for row in included) == interval['months_inside']
    for row in series['data']:
        assert row['lo80'] < row['model_b'] < row['hi80']


def test_interval_is_withheld_when_it_does_not_reproduce_coverage():
    rows = {(2020, 1): {'model_b': 100.0, 'actual_viirs': 100.0, 'included': True}}
    metadata = {'interval_80': {'nominal': .8, 'leave_one_year_out': {'monthly_log_q10_q90': [-.2, .2], 'monthly_test_coverage': .5}}}
    result = attach_interval(rows, metadata)
    assert result['status'] == 'unavailable' and rows[(2020, 1)]['lo80'] is None
    assert attach_interval(rows, {})['status'] == 'unavailable'


def test_model_comparison_is_the_saved_task2_table(client):
    comparison = client.get('/validation').json()['model_comparison']
    assert comparison['status'] == 'ready'
    with (main.ROOT / 'out/task2/model_comparison.csv').open() as stream:
        saved = list(csv.DictReader(stream))
    assert len(comparison['rows']) == len(saved) == 10
    for row, original in zip(comparison['rows'], saved):
        assert row['model'] == original['model']
        assert row['monthly_mape'] == float(original['monthly_MAPE_%'])
        assert row['annual_bias'] == float(original['annual_bias_%'])
    test_b = next(r for r in comparison['rows'] if r['split'] == 'test' and r['model'] == 'b_power')
    metadata = json.loads(main.VALIDATION.read_text())
    assert math.isclose(test_b['monthly_mape'], metadata['scores_test']['model_b']['monthly']['MAPE_pct'], abs_tol=1e-3)


def test_missing_model_comparison_is_unavailable(tmp_path):
    assert read_model_comparison(tmp_path / 'validation.json')['status'] == 'unavailable'


@pytest.mark.parametrize('bbox,month', [(ALL, '2025-09'), ('-64,-28,-59,-24', '2024-08'), ('-71,-50,-67,-40', '2026-02')])
def test_anomaly_history_reproduces_median_and_rank(client, bbox, month):
    stats = client.get(f'/anomaly?bbox={bbox}&month={month}&daynight=D').json()['data'][0]['metrics']['harmonized']
    values = [item['value'] for item in stats['history']]
    assert [item['year'] for item in stats['history']] == stats['baseline_years']
    assert median(values) == stats['historical_median']
    if stats['rank'] is not None:
        assert stats['rank'] == 1 + sum(value > stats['value'] for value in values)


def test_meta_reports_processing_parameters(client):
    parameters = client.get('/meta').json()['parameters']
    assert parameters['filters'].startswith('MODIS Aqua conf>=30')
    assert parameters['calibration'] == 'model_b_v1'
    assert parameters['coverage'] == '2003-01..2026-10'
    assert math.isclose(parameters['calibration_detail']['b'], 0.91414)


def test_modelled_cells_exceeding_days_in_month_are_counted_independently(client):
    import calendar
    import pyarrow.parquet as pq
    rows = pq.read_table(main.PRODUCTION, columns=['year', 'month', 'harmonized', 'source']).to_pylist()
    excess = [r for r in rows if r['source'] != 'observed' and r['harmonized'] is not None
              and r['harmonized'] > calendar.monthrange(r['year'], r['month'])[1]]
    reported = client.get('/meta').json()['modelled_cells_exceeding_days']
    assert reported['count'] == len(excess) > 0
    assert reported['max'] == max(r['harmonized'] for r in excess)
    assert reported['months'] == len({(r['year'], r['month']) for r in excess})


@pytest.mark.parametrize('bbox,month', [(ALL, '2025-08'), ('-64,-28,-59,-24', '2024-09'), (ALL, '2026-03')])
def test_recent_baseline_uses_the_n_most_recent_eligible_years(client, bbox, month):
    every = client.get(f'/anomaly?bbox={bbox}&month={month}&daynight=D').json()['data'][0]['metrics']['harmonized']
    recent = client.get(f'/anomaly?bbox={bbox}&month={month}&daynight=D&baseline=10').json()
    stats = recent['data'][0]['metrics']['harmonized']
    assert recent['baseline_window'] == 10
    assert stats['baseline_years'] == every['baseline_years'][-10:]
    assert stats['sample_size'] == min(10, every['sample_size'])
    values = [item['value'] for item in stats['history']]
    assert stats['historical_median'] == median(values)
    if stats['rank'] is not None:
        assert stats['rank'] == 1 + sum(v > stats['value'] for v in values)
        assert stats['rank_count'] == len(values) + 1
        assert math.isclose(stats['percent_change'], 100 * (stats['value'] - median(values)) / median(values))
    assert stats['comparison_status'] == every['comparison_status']


def test_same_month_series_matches_the_regional_series(client):
    anomaly = client.get(f'/anomaly?bbox={ALL}&month=2024-07&daynight=D').json()['data'][0]
    series = client.get(f'/series?bbox={ALL}&start=2003-01&end=2024-12&daynight=D').json()['data']
    july = [r for r in series if r['month'] == 7]
    assert [r['year'] for r in anomaly['same_month']] == [r['year'] for r in july]
    for item, row in zip(anomaly['same_month'], july):
        assert item['value'] == row['harmonized'] and item['source'] == row['source']
        assert item['incomplete'] == ('harmonized' in row['incomplete_metrics'])
    assert anomaly['same_month'][-1]['source'] == 'gapfill'


@pytest.mark.parametrize('value', ['0', '2', '51', 'ten', '-5'])
def test_invalid_baseline_is_rejected(client, value):
    assert client.get(f'/anomaly?bbox={ALL}&month=2024-07&daynight=D&baseline={value}').status_code == 422
