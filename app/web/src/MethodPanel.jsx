import { useEffect, useRef, useState } from 'react';
import HeldOutComparison from './HeldOutComparison.jsx';
import Figure, { SERIES, fmtNumber } from './Figure.jsx';
import { annualHeldOutError } from './stats.js';

const fmt = value => typeof value !== 'number' || !Number.isFinite(value) ? '—' : value.toLocaleString('en', { maximumFractionDigits: 2 });
const percent = value => fmt(value) === '—' ? '—' : `${fmt(value)}%`;
const yearLabel = years => Array.isArray(years) && years.length ? `${Math.min(...years)}–${Math.max(...years)}` : 'Not reported';
const metric = (period, name, series) => period?.metrics?.find(m => m.name === name)?.[series];
const signedPct = (value, digits = 1) => value == null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${fmtNumber(Math.abs(value), digits)}%`;
function DetailValue({ value }) {
  const title = id => String(id || 'Details').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
  if (value == null) return <span>Not reported</span>;
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (Array.isArray(value)) return <ul>{value.map((item, i) => <li key={i}><DetailValue value={item}/></li>)}</ul>;
  return <dl>{Object.entries(value).map(([key, item]) => <div key={key}><dt>{title(key)}</dt><dd><DetailValue value={item}/></dd></div>)}</dl>;
}
export { DetailValue };

// Table 2: the saved Task 2 comparison of candidate models (no refit in the app).
function ModelComparison({ comparison }) {
  const [split, setSplit] = useState('test');
  if (comparison?.status !== 'ready') return <p className="muted" role="status">{comparison?.message || 'Model comparison is not available.'}</p>;
  const rows = comparison.rows.filter(row => row.split === split);
  const calibrated = rows.filter(r => r.model !== 'raw_modis');
  const best = key => key.endsWith('r2') ? Math.max(...calibrated.map(r => r[key])) : Math.min(...calibrated.map(r => Math.abs(r[key])));
  const isBest = (row, key) => row.model !== 'raw_modis' && (key.endsWith('r2') ? row[key] : Math.abs(row[key])) === best(key);
  const cell = (row, key, digits, suffix = '') => <td className={isBest(row, key) ? 'best' : undefined}>{key.endsWith('r2') ? fmtNumber(row[key], 3) : `${fmtNumber(row[key], digits)}${suffix}`}</td>;
  return <figure className="figure model-comparison" aria-labelledby="table-2-title">
    <div className="figure-head"><span className="figure-number">Table 2</span><h3 id="table-2-title" className="figure-title">Four candidate calibrations scored against VIIRS</h3></div>
    <div className="segmented" role="group" aria-label="Scoring period">{[['test', 'Held-out years'], ['train', 'Training years']].map(([value, label]) => <button key={value} aria-pressed={split === value} onClick={() => setSplit(value)}>{label}</button>)}</div>
    <div className="table-scroll"><table className="numeric-table">
      <thead><tr><th scope="col">Model</th><th scope="col">Monthly MAPE</th><th scope="col">Monthly R²</th><th scope="col">Monthly bias</th><th scope="col">Annual MAPE</th><th scope="col">Annual R²</th><th scope="col">Annual bias</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.model} className={row.model === 'b_power' ? 'selected-model' : undefined}><th scope="row">{row.label}{row.model === 'b_power' && <span className="chosen-tag">selected</span>}</th>
        {cell(row, 'monthly_mape', 2, '%')}{cell(row, 'monthly_r2')}{cell(row, 'monthly_bias', 2, '%')}{cell(row, 'annual_mape', 2, '%')}{cell(row, 'annual_r2')}{cell(row, 'annual_bias', 2, '%')}</tr>)}</tbody>
    </table></div>
    <figcaption className="figure-caption"><span className="figure-note">Bold marks the best calibrated model in each column (smallest absolute value for bias and MAPE, largest for R²). Model D has a lower held-out monthly MAPE than B but higher annual error and many more parameters, so B was selected. MAPE is mean absolute percentage error.</span><span><b>Source</b> {comparison.source}</span><span><b>Period</b> {split === 'test' ? 'Held-out complete, non-gap months' : 'Training months 2012–2019, gap months excluded'}; national daytime cell-days</span></figcaption>
  </figure>;
}

// Figure 4: Model B's held-out error per year, from saved predictions (scored months only).
function AnnualError({ series, drift }) {
  const container = useRef(null), [width, setWidth] = useState(600);
  useEffect(() => { const o = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width))); o.observe(container.current); return () => o.disconnect(); }, []);
  const rows = annualHeldOutError(series?.status === 'ready' ? series.data : []);
  const W = width, H = 220, L = 56, R = 12, T = 18, B = 46;
  const extent = Math.max(5, ...rows.map(r => Math.abs(r.error_pct))) * 1.2;
  const y = v => T + (extent - v) / (2 * extent) * (H - T - B);
  const step = (W - L - R) / Math.max(1, rows.length);
  return <div ref={container}>{!rows.length ? <p className="muted">Saved held-out predictions are not available.</p> : <>
    <svg className="chart annual-error-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Model B annual error by held-out year: ${rows.map(r => `${r.year} ${signedPct(r.error_pct)}`).join(', ')}`}>
      {[-extent, -extent / 2, 0, extent / 2, extent].map(v => <g key={v}><line className={v === 0 ? 'axis-line' : 'gridline'} x1={L} x2={W - R} y1={y(v)} y2={y(v)}/><text className="tick" x={L - 8} y={y(v) + 4} textAnchor="end">{signedPct(v)}</text></g>)}
      {rows.map((r, i) => <g key={r.year}>
        <rect x={L + i * step + step * .22} width={step * .56} y={Math.min(y(0), y(r.error_pct))} height={Math.max(1, Math.abs(y(r.error_pct) - y(0)))} fill={r.year >= 2023 && drift ? SERIES.modis : SERIES.viirs}/>
        <text className="bar-label" x={L + (i + .5) * step} y={r.error_pct >= 0 ? y(r.error_pct) - 6 : y(r.error_pct) + 14} textAnchor="middle">{signedPct(r.error_pct)}</text>
        <text className="tick" x={L + (i + .5) * step} y={H - B + 18} textAnchor="middle">{r.year}</text>
      </g>)}
      <text className="axis-title" x={(L + W - R) / 2} y={H - 6} textAnchor="middle">Held-out year (scored months only)</text>
      <text className="axis-title" transform={`translate(13 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle">Model B − VIIRS (%)</text>
    </svg>
    <div className="chart-key"><span><i className="key-swatch" style={{ background: SERIES.viirs }}/>2020–2022, stable Aqua orbit</span>{drift && <span><i className="key-swatch" style={{ background: SERIES.modis }}/>2023 onward, Aqua overpass drifting later</span>}</div>
    <details className="figure-data"><summary>Figure 4 data</summary><div className="table-scroll"><table><thead><tr><th scope="col">Year</th><th scope="col">Scored months</th><th scope="col">Observed VIIRS</th><th scope="col">Model B</th><th scope="col">Error</th></tr></thead><tbody>{rows.map(r => <tr key={r.year}><th scope="row">{r.year}</th><td>{r.months}</td><td>{fmtNumber(r.observed, 0)}</td><td>{fmtNumber(r.model_b, 0)}</td><td>{signedPct(r.error_pct)}</td></tr>)}</tbody></table></div></details>
  </>}</div>;
}

export default function MethodPanel({ validation, calibration, children }) {
  const ready = validation?.status === 'ready';
  const periods = ready ? validation.periods || [{ label: validation.held_out, metrics: validation.metrics || [] }] : [];
  const limitations = ready && Array.isArray(validation.known_limitations) ? validation.known_limitations : [];
  const drift = limitations.some(item => item?.id === 'aqua_overpass_drift');
  const training = ready ? yearLabel(validation.model?.train_years) : 'Not reported';
  const heldOut = ready ? validation.test_years?.length ? yearLabel(validation.test_years) : validation.held_out || 'Not reported' : 'Not reported';
  const raw = ready ? metric(validation, 'Monthly MAPE', 'raw_modis') : null;
  const model = ready ? metric(validation, 'Monthly MAPE', 'harmonized') : null;
  const baseline = ready ? metric(validation, 'Monthly MAPE', 'model_a') : null;
  const difference = raw != null && model != null ? raw - model : null;
  const conclusion = difference == null ? 'The measured change will appear when validation scores are available.' : difference === 0 ? 'Model B and uncorrected MODIS have equal held-out monthly MAPE.' : `Model B has ${fmt(Math.abs(difference))} percentage points ${difference > 0 ? 'lower' : 'higher'} held-out monthly MAPE than uncorrected MODIS.`;
  const early = metric(periods.find(p => p.label === '2020-2022'), 'Monthly MAPE', 'harmonized');
  const late = metric(periods.find(p => p.label === '2023-2025'), 'Monthly MAPE', 'harmonized');
  const nominal = ready ? validation.nominal_interval_coverage : null;
  const coverage = ready ? validation.monthly_interval_coverage : null;
  const annual = ready ? validation.interval_80?.leave_one_year_out : null;
  const join = ready ? validation.join_check_2012 : null;
  const errorScale = Math.max(10, Math.ceil(Math.max(0, ...[raw, baseline, model].filter(Number.isFinite)) / 10) * 10);
  return <section className="method-panel" aria-label="Method and validation">
    <div className="scientific-method" aria-label="Scientific methodology">
      <div><h4>Hypothesis</h4><p>Statistical calibration can reduce disagreement between MODIS and VIIRS observations.</p></div>
      <div><h4>Method</h4><p>Fit a calibration using overlapping observations from {training}. Model B maps MODIS activity to the VIIRS scale.</p></div>
      <div><h4>Validation</h4><p>Compare predictions with held-out VIIRS observations from {heldOut}, including the simpler constant-ratio baseline.</p></div>
      <div><h4>Conclusion</h4><p>{conclusion} Performance varies by period; this does not validate individual fires or regional accuracy.</p></div>
    </div>
    <p className="validation-periods">Calibration: <strong>{training}</strong> · Held-out validation: <strong>{heldOut}</strong> · Daytime</p>

    <Figure number={2} title="Monthly error against held-out VIIRS, by method" source="out/validation.json (scores_test, scores_by_period)" period={`${heldOut}; complete, non-gap months; all Argentina`}>
      <div className="validation-heading"><span>{calibration || 'Calibration metadata loading…'}</span><p className="validation-scale">Monthly MAPE (%) relative to VIIRS · Lower is better · Shared scale: 0–{errorScale}%</p></div>
      <div className={`validation-summary${ready ? '' : ' validation-placeholder'}`}>
        {[[raw, 'Raw MODIS', 'raw'], [baseline, 'Constant-ratio baseline (Model A)', 'baseline'], [model, 'Calibrated Model B', 'model']].map(([value, label, key]) => <div className={`validation-metric ${key}`} key={key}><h4>{label}</h4><strong>{percent(value)}</strong><div className="validation-error-track" role="img" aria-label={`${label}: ${percent(value)} monthly MAPE on a shared 0 to ${errorScale}% scale`}>{Number.isFinite(value) && <span style={{ width: `${Math.max(0, value) / errorScale * 100}%` }}/>}</div></div>)}
        <div className="error-axis" aria-hidden="true"><span>0%</span><span>{errorScale / 2}%</span><span>{errorScale}%</span></div>
      </div>
      {!ready && <p className="muted" role="status">{validation?.message || 'Loading validation…'}</p>}
      <p className="baseline-comparison">Constant-ratio baseline (Model A): <strong>{percent(baseline)}</strong> monthly MAPE.{baseline == null ? ' Not reported by the validation metadata.' : model != null ? ` Model B is ${fmt(Math.abs(baseline - model))} percentage points ${baseline >= model ? 'lower' : 'higher'}.` : ''}</p>
    </Figure>
    <p className="validation-conclusion">Calibration fitted on {training} was tested against national daytime VIIRS observations from {heldOut}, excluded from training. {conclusion} {difference > 0 ? 'This shows improved agreement between monthly satellite records at the national scale, not independent validation of wildfire counts.' : difference == null ? '' : 'These results do not show improved agreement over raw MODIS.'}</p>
    <p className="validation-reference">MAPE is mean absolute percentage error; lower is better. VIIRS is the reference instrument, not independent wildfire ground truth. These national scores do not establish accuracy for arbitrary regional selections.</p>

    <HeldOutComparison series={ready ? validation.prediction_series : null}/>
    {ready && <ModelComparison comparison={validation.model_comparison}/>}

    <Figure number={4} title="Model B error on each held-out year" source="out/task2/predictions_monthly.csv, summed over scored months" period={`${heldOut}; national daytime`}>
      <AnnualError series={ready ? validation.prediction_series : null} drift={drift}/>
    </Figure>

    <h3 className="minor-heading">Checks on the uncertainty and the 2012 join</h3>
    <ul className="checks">
      <li className="interval-coverage">{coverage == null ? 'Measured prediction-interval coverage is not reported.' : <>Held-out monthly prediction-interval coverage: {percent(100 * coverage)}{nominal != null && <> versus a nominal {percent(100 * nominal)}{coverage < nominal ? ' target: the intervals undercovered observations' : ' target'}</>}.</>} Monthly intervals must not be summed into an annual confidence band.</li>
      {annual?.annual_test_coverage != null && <li>Annual interval: held-out coverage {percent(100 * annual.annual_test_coverage)} of {validation.interval_80.test_years_n} years, also below nominal.</li>}
      <li>{early != null && late != null ? <>Model B monthly MAPE: {percent(early)} in 2020–2022 versus {percent(late)} in 2023–2025.{late > early && ' Performance was weaker in the later period.'}</> : 'Period-specific calibration performance is not reported.'}</li>
      {join && <li className="join-check">2012 join: observed VIIRS for {join.months_compared?.[0]} to {join.months_compared?.at(-1)} totals {fmtNumber(join.observed_viirs, 0)} cell-days, {signedPct(join.difference_pct, 2)} relative to Model B's estimate from MODIS ({fmtNumber(join.model_b, 0)}). That is inside the annual 80% band of {signedPct(join.annual_band_pct?.[0])} to {signedPct(join.annual_band_pct?.[1])}. <strong>{join.pass ? 'Pass' : 'Fail'}</strong>: the back-cast meets the observed record without a step.</li>}
    </ul>

    {ready && <details className="validation-details"><summary>Technical validation details</summary>
      <div className="validation-table compact-scores"><table><caption>Monthly MAPE (%) by held-out period</caption><thead><tr><th>Period</th><th>Raw MODIS</th><th>Ratio (A)</th><th>Model B</th></tr></thead><tbody>{periods.map((p, i) => <tr key={i}><th>{p.label}</th>{['raw_modis', 'model_a', 'harmonized'].map(series => <td key={series} title={metric(p, 'Monthly MAPE', series) == null ? 'Not reported in validation file' : undefined}>{fmt(metric(p, 'Monthly MAPE', series))}</td>)}</tr>)}</tbody></table></div>
      <p className="footnote">— means not reported. Scores exclude gap-flagged months. Live-year observations are outside the held-out test set.</p>
      {validation.model && <DetailValue value={validation.model}/>}
      <div className="validation-table"><table><thead><tr><th>Period</th><th>Metric</th><th>Uncorrected MODIS</th><th>Constant ratio (A)</th><th>Calibrated Model B</th></tr></thead><tbody>{periods.flatMap((p, i) => p.metrics.map((m, j) => <tr key={`${i}-${j}`}><th>{p.label}</th><th>{m.name} ({m.unit})</th><td>{fmt(m.raw_modis)}</td><td>{fmt(m.model_a)}</td><td>{fmt(m.harmonized)}</td></tr>))}</tbody></table></div>
      {validation.notes?.map((note, i) => <p key={i} className="footnote">{note}</p>)}<p className="footnote">Read from out/validation.json.</p>
    </details>}
    {children}
  </section>;
}
