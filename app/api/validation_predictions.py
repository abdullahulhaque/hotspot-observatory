"""Read saved national held-out predictions; never fit or reconstruct a model."""
import csv
import math
from statistics import mean


def attach_interval(rows, metadata):
    """Rebuild the saved leave-one-year-out 80% band for each held-out month.

    The band is the log1p-space residual quantile interval reported in
    validation.json, applied to each saved Model B prediction. It is shown only
    if it reproduces the reported held-out coverage exactly; otherwise every
    row keeps null bounds and the reason is returned.
    """
    for row in rows.values():
        row['lo80'] = row['hi80'] = row['inside_interval'] = None
    try:
        loyo = metadata['interval_80']['leave_one_year_out']
        q_lo, q_hi = (float(v) for v in loyo['monthly_log_q10_q90'])
        expected = float(loyo['monthly_test_coverage'])
    except (KeyError, TypeError, ValueError):
        return {'status': 'unavailable', 'message': 'Leave-one-year-out interval quantiles are not reported.'}
    if not (math.isfinite(q_lo) and math.isfinite(q_hi) and q_lo < 0 < q_hi):
        return {'status': 'unavailable', 'message': 'Reported interval quantiles are invalid.'}
    for row in rows.values():
        centre = math.log1p(row['model_b'])
        row['lo80'], row['hi80'] = math.expm1(centre + q_lo), math.expm1(centre + q_hi)
        residual = math.log1p(row['actual_viirs']) - centre
        row['inside_interval'] = q_lo <= residual <= q_hi
    included = [row for row in rows.values() if row['included']]
    measured = sum(row['inside_interval'] for row in included) / len(included) if included else None
    if measured is None or not math.isclose(measured, expected, rel_tol=1e-9, abs_tol=1e-9):
        for row in rows.values():
            row['lo80'] = row['hi80'] = row['inside_interval'] = None
        return {'status': 'unavailable', 'message': 'Rebuilt interval does not reproduce the reported coverage.'}
    return {'status': 'ready', 'method': 'leave-one-year-out log1p residual quantiles, training years',
            'log_q10_q90': [q_lo, q_hi], 'nominal': metadata['interval_80'].get('nominal'),
            'coverage': measured, 'months_inside': sum(row['inside_interval'] for row in included),
            'months_scored': len(included)}


def read_model_comparison(validation_path):
    """Read the saved Task 2 comparison of four candidate calibration models."""
    path = validation_path.parent / 'task2' / 'model_comparison.csv'
    if not path.exists():
        return {'status': 'unavailable', 'message': 'Saved model comparison is not available.', 'rows': []}
    try:
        rows = []
        with path.open(newline='') as stream:
            for record in csv.DictReader(stream):
                split = 'train' if record['split'].startswith('train') else 'test' if record['split'] == 'test' else None
                if split is None or record['model'] not in MODELS:
                    raise ValueError('Unknown split or model')
                values = {key: float(record[column]) for key, column in COMPARISON_COLUMNS}
                if not all(math.isfinite(v) for v in values.values()):
                    raise ValueError('Non-finite score')
                rows.append({'split': split, 'model': record['model'], 'label': MODELS[record['model']], **values})
        if {(r['split'], r['model']) for r in rows} != {(s, m) for s in ('train', 'test') for m in MODELS}:
            raise ValueError('Model comparison is incomplete')
        return {'status': 'ready', 'source': 'out/task2/model_comparison.csv', 'rows': rows}
    except (OSError, ValueError, KeyError, csv.Error) as exc:
        return {'status': 'unavailable', 'message': f'Saved model comparison unavailable: {exc}', 'rows': []}


MODELS = {'raw_modis': 'Raw MODIS (no correction)', 'a_ratio': 'A. Constant ratio', 'b_power': 'B. Power law (national)',
          'c_power_month': 'C. Power law + month terms', 'd_block_power': 'D. Power law per 2° block'}
COMPARISON_COLUMNS = (('monthly_mape', 'monthly_MAPE_%'), ('monthly_r2', 'monthly_R2'), ('monthly_bias', 'monthly_bias_%'),
                      ('annual_mape', 'annual_MAPE_%'), ('annual_r2', 'annual_R2'), ('annual_bias', 'annual_bias_%'))


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
        interval = attach_interval(rows, metadata)
        return {'status': 'ready', 'scope': 'national', 'unit': 'active cell-days',
                'source': 'out/task2/predictions_monthly.csv', 'interval': interval,
                'data': [rows[key] for key in sorted(rows)]}
    except (OSError, ValueError, KeyError, TypeError, csv.Error) as exc:
        return {**unavailable, 'message': f'Saved held-out predictions unavailable: {exc}'}
