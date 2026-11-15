// Pure statistics for the results views. Every function takes rows returned by the
// API and never fills, smooths or extrapolates missing values.

const finite = value => typeof value === 'number' && Number.isFinite(value);

// Years whose twelve months all have a value for `metric` (partial years are excluded).
export function completeYears(rows, metric = 'harmonized') {
  const byYear = new Map();
  for (const row of rows) {
    if (!byYear.has(row.year)) byYear.set(row.year, new Map());
    byYear.get(row.year).set(row.month, row[metric]);
  }
  const years = [];
  for (const [year, months] of [...byYear].sort((a, b) => a[0] - b[0])) {
    const values = Array.from({ length: 12 }, (_, i) => months.get(i + 1));
    if (values.every(finite)) years.push({ year, values, total: values.reduce((sum, v) => sum + v, 0) });
  }
  return years;
}

// Mean activity per calendar month over complete years, and each month's share of
// the mean annual total. Shares make regions of different size comparable in timing.
export function climatology(rows, metric = 'harmonized') {
  const years = completeYears(rows, metric);
  if (!years.length) return { years: 0, first: null, last: null, months: [], peak: null };
  const means = Array.from({ length: 12 }, (_, i) => years.reduce((sum, y) => sum + y.values[i], 0) / years.length);
  const annual = means.reduce((sum, v) => sum + v, 0);
  const months = means.map((mean, i) => ({ month: i + 1, mean, share: annual > 0 ? 100 * mean / annual : null }));
  const peak = annual > 0 ? months.reduce((best, m) => m.mean > best.mean ? m : best) : null;
  return { years: years.length, first: years[0].year, last: years.at(-1).year, months, peak, annual };
}

// Peak month and activity-weighted circular mean month for each complete year.
// The circular mean treats December and January as neighbours.
export function seasonalTiming(rows, metric = 'harmonized') {
  return completeYears(rows, metric).map(({ year, values, total }) => {
    const max = Math.max(...values);
    const peaks = values.flatMap((v, i) => v === max && total > 0 ? [i + 1] : []);
    let x = 0, y = 0;
    values.forEach((v, i) => { const angle = 2 * Math.PI * i / 12; x += v * Math.cos(angle); y += v * Math.sin(angle); });
    const strength = total > 0 ? Math.hypot(x, y) / total : 0;
    const centre = total > 0 && strength > 1e-9 ? ((Math.atan2(y, x) / (2 * Math.PI) * 12 + 12) % 12) + 1 : null;
    return { year, total, peaks, peak: peaks.length === 1 ? peaks[0] : null, centre, concentration: strength };
  });
}

// Standard normal cumulative distribution (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7).
export function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// Mann–Kendall monotonic trend test with tie correction, and Sen's slope with a
// two-sided confidence interval (Gilbert 1987, normal approximation).
export function trendTest(points, confidence = 0.95) {
  const data = points.filter(p => finite(p.x) && finite(p.y));
  const n = data.length;
  if (n < 8) return { n, status: 'insufficient', message: 'At least 8 complete years are needed for a trend test.' };
  let s = 0;
  const slopes = [];
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
    s += Math.sign(data[j].y - data[i].y);
    if (data[j].x !== data[i].x) slopes.push((data[j].y - data[i].y) / (data[j].x - data[i].x));
  }
  const ties = new Map();
  for (const p of data) ties.set(p.y, (ties.get(p.y) || 0) + 1);
  const tieTerm = [...ties.values()].reduce((sum, t) => sum + t * (t - 1) * (2 * t + 5), 0);
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  const z = s > 0 ? (s - 1) / Math.sqrt(variance) : s < 0 ? (s + 1) / Math.sqrt(variance) : 0;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  slopes.sort((a, b) => a - b);
  const median = list => { const v = [...list].sort((a, b) => a - b); return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };
  const slope = median(slopes);
  const zCrit = inverseNormal(1 - (1 - confidence) / 2);
  const c = zCrit * Math.sqrt(variance);
  const lowerIndex = Math.round((slopes.length - c) / 2) - 1, upperIndex = Math.round((slopes.length + c) / 2);
  const lower = slopes[Math.max(0, lowerIndex)], upper = slopes[Math.min(slopes.length - 1, upperIndex)];
  const intercept = median(data.map(d => d.y - slope * d.x));
  return { n, status: 'ready', s, variance, z, p, tau: s / (n * (n - 1) / 2), slope, lower, upper, intercept, confidence };
}

// Inverse standard normal (Acklam's rational approximation, relative error < 1.2e-9).
export function inverseNormal(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  if (p > 1 - low) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

// Annual held-out error of Model B by year, using only the months that were scored.
export function annualHeldOutError(rows) {
  const years = new Map();
  for (const row of rows || []) {
    if (!row.included) continue;
    const entry = years.get(row.year) || { year: row.year, months: 0, observed: 0, model_b: 0, raw_modis: 0, lo80: 0, hi80: 0, bands: 0 };
    entry.months += 1; entry.observed += row.actual_viirs; entry.model_b += row.model_b; entry.raw_modis += row.raw_modis;
    years.set(row.year, entry);
  }
  return [...years.values()].sort((a, b) => a.year - b.year).map(entry => ({
    ...entry, error_pct: 100 * (entry.model_b - entry.observed) / entry.observed,
    raw_error_pct: 100 * (entry.raw_modis - entry.observed) / entry.observed,
  }));
}

// Mid-rank percentile of a value among earlier same-month records, and a screening
// class with explicit thresholds. Too few records or a withheld comparison give none.
export const ANOMALY_CLASSES = [
  { min: 90, label: 'Well above typical', rule: 'at or above the 90th percentile of earlier records' },
  { min: 75, label: 'Above typical', rule: 'between the 75th and 90th percentiles' },
  { min: 25, label: 'Within the typical range', rule: 'between the 25th and 75th percentiles' },
  { min: 10, label: 'Below typical', rule: 'between the 10th and 25th percentiles' },
  { min: -Infinity, label: 'Well below typical', rule: 'below the 10th percentile' },
];
export const MIN_BASELINE = 10;
export function anomalyClass(value, history) {
  const values = (history || []).map(item => item.value).filter(finite);
  if (!finite(value)) return { status: 'unavailable', n: values.length };
  if (values.length < MIN_BASELINE) return { status: 'insufficient', n: values.length };
  const below = values.filter(v => v < value).length, equal = values.filter(v => v === value).length;
  const percentile = 100 * (below + equal / 2) / values.length;
  return { status: 'ready', n: values.length, percentile, ...ANOMALY_CLASSES.find(c => percentile >= c.min) };
}

// Re-centre circular month values (1–13, 13 ≡ 1) on their circular mean so that a
// linear trend test is not broken by the December–January wrap. Returns values in
// (mean − 6, mean + 6] on a continuous scale, plus the mean month.
export function unwrapMonths(values) {
  const finiteValues = values.filter(finite);
  if (!finiteValues.length) return { mean: null, values: values.map(() => null) };
  let x = 0, y = 0;
  for (const v of finiteValues) { x += Math.cos(2 * Math.PI * (v - 1) / 12); y += Math.sin(2 * Math.PI * (v - 1) / 12); }
  const mean = ((Math.atan2(y, x) / (2 * Math.PI) * 12 + 12) % 12) + 1;
  return { mean, values: values.map(v => finite(v) ? mean + ((((v - mean) % 12) + 18) % 12) - 6 : null) };
}
