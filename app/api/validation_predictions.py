"""Read saved national held-out predictions; never fit or reconstruct a model."""
import csv
import math
from statistics import mean


def read_predictions(validation_path, metadata):
    path = validation_path.parent / 'task2' / 'predictions_monthly.csv'
    unavailable = {'status': 'unavailable', 'data': [], 'scope': 'national'}
    if not path.exists():
        return {**unavailable, 'message': 'Saved held-out predictions are not available.'}
    try:
        years = set(metadata['test_years'])
        if not years or years.intersection(metadata['model']['train_years']):
            raise ValueError('Held-out years must be separate from training years')
        excluded = set(metadata.get('test_excluded_months', []))
        rows = {}
        with path.open(newline='') as stream:
            for record in csv.DictReader(stream):
                year, month = int(record['yr']), int(record['mo'])
                if year not in years:
                    continue
                key = (year, month)
                if not 1 <= month <= 12 or key in rows:
                    raise ValueError('Invalid or duplicate prediction month')
                if record['complete'] not in ('True', 'False') or record['gap_flag'] not in ('True', 'False'):
                    raise ValueError('Invalid observation quality flags')
                values = {name: float(record[column]) for name, column in (
                    ('actual_viirs', 'actual_viirs'), ('model_b', 'b_power'), ('raw_modis', 'raw_modis'))}
                if any(not math.isfinite(value) or value < 0 for value in values.values()):
                    raise ValueError('Invalid prediction or observed value')
                gap = record['gap_flag'] == 'True'
                complete = record['complete'] == 'True'
                included = complete and not gap and f'{year}-{month:02}' not in excluded
                rows[key] = {'year': year, 'month': month, **values, 'gap_flag': gap,
                             'complete': complete, 'included': included}
        if set(rows) != {(year, month) for year in years for month in range(1, 13)}:
            raise ValueError('Saved predictions do not cover all held-out months')
        scored = [row for row in rows.values() if row['included'] and row['actual_viirs'] > 0]
        # Reject stale/mismatched artifacts instead of displaying a different experiment.
        for column, model in (('raw_modis', 'raw_modis'), ('model_b', 'model_b')):
            actual_score = mean(100 * abs(row[column] - row['actual_viirs']) / row['actual_viirs'] for row in scored)
            expected_score = metadata['scores_test'][model]['monthly']['MAPE_pct']
            if not math.isclose(actual_score, expected_score, rel_tol=1e-8, abs_tol=1e-8):
                raise ValueError('Saved predictions do not match the validation scores')
        return {'status': 'ready', 'scope': 'national', 'unit': 'active cell-days',
                'source': 'out/task2/predictions_monthly.csv',
                'data': [rows[key] for key in sorted(rows)]}
    except (OSError, ValueError, KeyError, TypeError, csv.Error) as exc:
        return {**unavailable, 'message': f'Saved held-out predictions unavailable: {exc}'}
