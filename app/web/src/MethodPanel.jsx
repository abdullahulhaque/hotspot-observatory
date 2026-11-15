const fmt = value => typeof value !== 'number' || !Number.isFinite(value) ? '—' : value.toLocaleString('en', { maximumFractionDigits: 2 });
const percent = value => fmt(value) === '—' ? '—' : `${fmt(value)}%`;
const title = id => String(id || 'Details').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const yearLabel = years => Array.isArray(years) && years.length ? `${Math.min(...years)}–${Math.max(...years)}` : 'Not reported';
const metric = (period, name, series) => period?.metrics?.find(m => m.name === name)?.[series];
function DetailValue({ value }) {
  if (value == null) return <span>Not reported</span>;
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (Array.isArray(value)) return <ul>{value.map((item,i) => <li key={i}><DetailValue value={item}/></li>)}</ul>;
  return <dl>{Object.entries(value).map(([key,item]) => <div key={key}><dt>{title(key)}</dt><dd><DetailValue value={item}/></dd></div>)}</dl>;
}
export default function MethodPanel({ validation, calibration, children }) {
  const ready = validation?.status === 'ready';
  const periods = ready ? validation.periods || [{ label: validation.held_out, metrics: validation.metrics || [] }] : [];
  const limitations = ready && Array.isArray(validation.known_limitations) ? validation.known_limitations : [];
  const drift = limitations.find(item => item?.id === 'aqua_overpass_drift');
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
  return <section className="method-panel" aria-label="Method and validation">
    <div className="validation-heading"><h3>National held-out validation</h3><span>{calibration || 'Calibration metadata loading…'}</span></div>
    <p className="validation-periods">Calibration: <strong>{training}</strong> · Held-out validation: <strong>{heldOut}</strong> · Daytime</p>
    <div className={`validation-summary${ready ? '' : ' validation-placeholder'}`}>
      <div className="validation-metric"><h4>Uncorrected MODIS monthly error relative to VIIRS</h4><strong>{percent(raw)}</strong><span>Monthly MAPE</span></div>
      <div className="validation-metric"><h4>Calibrated Model B monthly error relative to VIIRS</h4><strong>{percent(model)}</strong><span>Monthly MAPE</span></div>
    </div>
    {!ready && <p className="muted" role="status">{validation?.message || 'Loading validation…'}</p>}
    <p className="baseline-comparison">Constant-ratio baseline (Model A): <strong>{percent(baseline)}</strong> monthly MAPE.{baseline == null ? ' Not reported by the validation metadata.' : model != null ? ` Model B is ${fmt(Math.abs(baseline - model))} percentage points ${baseline >= model ? 'lower' : 'higher'}.` : ''}</p>
    <p className="validation-reference">MAPE is mean absolute percentage error; lower is better. VIIRS is the reference instrument, not independent wildfire ground truth. These national scores do not establish accuracy for arbitrary regional selections.</p>
    {ready && <>
      <div className="validation-table compact-scores"><table><caption>Monthly MAPE (%) by held-out period</caption><thead><tr><th>Period</th><th>Raw MODIS</th><th>Ratio (A)</th><th>Model B</th></tr></thead><tbody>{periods.map((p,i) => <tr key={i}><th>{p.label}</th>{['raw_modis','model_a','harmonized'].map(series => <td key={series} title={metric(p, 'Monthly MAPE', series) == null ? 'Not reported in validation file' : undefined}>{fmt(metric(p, 'Monthly MAPE', series))}</td>)}</tr>)}</tbody></table></div>
      <p className="footnote">— means not reported. Scores exclude gap-flagged months. Live-year observations are outside the held-out test set.</p>
      <details className="validation-details"><summary>Model details, all reported metrics and validation notes</summary>
        {validation.model && <DetailValue value={validation.model}/>}
        <div className="validation-table"><table><thead><tr><th>Period</th><th>Metric</th><th>Uncorrected MODIS</th><th>Constant ratio (A)</th><th>Calibrated Model B</th></tr></thead><tbody>{periods.flatMap((p,i) => p.metrics.map((m,j) => <tr key={`${i}-${j}`}><th>{p.label}</th><th>{m.name} ({m.unit})</th><td>{fmt(m.raw_modis)}</td><td>{fmt(m.model_a)}</td><td>{fmt(m.harmonized)}</td></tr>))}</tbody></table></div>
        {validation.notes?.map((note,i) => <p key={i} className="footnote">{note}</p>)}<p className="footnote">Read from out/validation.json.</p>
      </details>
    </>}
    {children}
    <div className="scientific-method" aria-label="Scientific methodology">
      <div><h4>Hypothesis</h4><p>Statistical calibration can reduce disagreement between MODIS and VIIRS observations.</p></div>
      <div><h4>Method</h4><p>Fit a calibration using overlapping observations from {training}. Model B maps MODIS activity to the VIIRS scale.</p></div>
      <div><h4>Validation</h4><p>Compare predictions with held-out VIIRS observations from {heldOut}, including the simpler constant-ratio baseline.</p></div>
      <div><h4>Conclusion</h4><p className="validation-conclusion">{conclusion} Performance varies by period; this does not validate individual fires or regional accuracy.</p></div>
    </div>
    <div className="known-limitations"><h3>Limitations and uncertainty</h3>
      <ul className="limitations-summary">
        <li>{early != null && late != null ? <>Model B monthly MAPE: {percent(early)} in 2020–2022 versus {percent(late)} in 2023–2025.{late > early && ' Performance was weaker in the later period.'}</> : 'Period-specific calibration performance is not reported.'}</li>
        <li className="interval-coverage">{coverage == null ? 'Measured prediction-interval coverage is not reported.' : <>Held-out monthly prediction-interval coverage: {percent(100 * coverage)}{nominal != null && <> versus a nominal {percent(100 * nominal)}{coverage < nominal ? ' target: the intervals undercovered observations' : ' target'}</>}.</>} Monthly intervals must not be summed into an annual confidence band.</li>
        <li>National validation does not establish accuracy for arbitrary regional selections; regional prediction intervals have not been independently validated.</li>
        <li>Missing observations can undercount activity. Back-casts and gap-fills are model estimates; flagged, incomplete and NRT months retain their quality labels.</li>
      </ul>
      {drift && <p className="drift-notice">The metadata reports Aqua overpass drift since 2023{limitations.some(item => item?.id === 'modis_version_change') && ' and a coincident MODIS version change'}. These diagnostics do not prove that timing changes caused the deterioration.</p>}
      <div className="limitation-list">{limitations.map((item,i) => <details key={i}><summary>{typeof item === 'string' ? item : title(item.id)}</summary>{typeof item !== 'string' && <DetailValue value={Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'id'))}/>}</details>)}</div>
      {!limitations.length && <p className="muted">Known limitations have not been supplied in the validation file.</p>}
    </div>
    <p className="night-note">Harmonized nighttime activity uses VIIRS only from 2012; it is not back-cast.</p>
  </section>;
}
