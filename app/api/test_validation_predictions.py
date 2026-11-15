import csv
from copy import deepcopy

import pytest

from app.api.validation_predictions import read_predictions


@pytest.fixture
def predictions(tmp_path):
    path = tmp_path / 'task2' / 'predictions_monthly.csv'
    path.parent.mkdir()
    rows = [{'yr': 2020, 'mo': month, 'raw_modis': 80, 'b_power': 110, 'actual_viirs': 100,
             'gap_flag': month == 7, 'complete': month != 3} for month in range(1, 13)]
    def write(records):
        with path.open('w', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(records)
    write(rows)
    metadata = {'test_years': [2020], 'model': {'train_years': [2018, 2019]},
                'test_excluded_months': ['2020-05'],
                'scores_test': {'raw_modis': {'monthly': {'MAPE_pct': 20}}, 'model_b': {'monthly': {'MAPE_pct': 10}}}}
    return tmp_path / 'validation.json', metadata, rows, write


def test_saved_predictions_keep_observed_values_and_excluded_months(predictions):
    path, metadata, _, _ = predictions
    result = read_predictions(path, metadata)
    assert result['status'] == 'ready'
    assert result['scope'] == 'national' and result['unit'] == 'active cell-days'
    assert len(result['data']) == 12
    assert [row['month'] for row in result['data'] if not row['included']] == [3, 5, 7]
    assert result['data'][6]['actual_viirs'] == 100 and result['data'][6]['model_b'] == 110


@pytest.mark.parametrize('change', ['missing_month', 'duplicate', 'invalid_number', 'bad_flag', 'stale_scores', 'training_overlap'])
def test_inconsistent_predictions_are_unavailable_without_fallback(predictions, change):
    path, metadata, rows, write = predictions
    records = deepcopy(rows)
    if change == 'missing_month': records.pop()
    if change == 'duplicate': records.append(records[0])
    if change == 'invalid_number': records[0]['b_power'] = 'nan'
    if change == 'bad_flag': records[0]['complete'] = 'unknown'
    if change == 'stale_scores': metadata['scores_test']['model_b']['monthly']['MAPE_pct'] = 5
    if change == 'training_overlap': metadata['model']['train_years'].append(2020)
    write(records)
    result = read_predictions(path, metadata)
    assert result['status'] == 'unavailable' and result['data'] == []


def test_missing_prediction_file_does_not_create_predictions(tmp_path):
    assert read_predictions(tmp_path / 'validation.json', {})['status'] == 'unavailable'
