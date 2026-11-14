const fmt = value => value == null ? '—' : value.toLocaleString('en', { maximumFractionDigits: 2 });
const title = id => String(id || 'Details').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
function DetailValue({ value }) {
  if (value == null) return <span>Not reported</span>;
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (Array.isArray(value)) return <ul>{value.map((item,i) => <li key={i}><DetailValue value={item}/></li>)}</ul>;
  return <dl>{Object.entries(value).map(([key,item]) => <div key={key}><dt>{title(key)}</dt><dd><DetailValue value={item}/></dd></div>)}</dl>;
}
export default function MethodPanel({ validation, calibration }) {
  const periods = validation?.periods || (validation?.metrics ? [{ label: validation.held_out, metrics: validation.metrics }] : []);
  const limitations = Array.isArray(validation?.known_limitations) ? validation.known_limitations : [];
  const drift = limitations.find(item => item?.id === 'aqua_overpass_drift');
  const metric = (period, name, series) => period.metrics.find(m => m.name === name)?.[series];
  return <section className="method-panel" aria-label="Method and validation">
    <div className="validation-heading"><h3>Held-out error: uncorrected vs corrected</h3><span>National validation · {calibration || 'Loading…'}</span></div>
    {validation?.status === 'ready' ? <>
      <div className="validation-table compact-scores"><table><thead><tr><th rowSpan="2">Period</th><th colSpan="2">Monthly MAPE (%)</th><th colSpan="2">Annual MAPE (%)</th></tr><tr><th>Uncorrected MODIS</th><th>Corrected model</th><th>Uncorrected MODIS</th><th>Corrected model</th></tr></thead><tbody>{periods.map((p,i) => <tr key={i}><th>{p.label}<small>{p.note}</small></th>{['Monthly MAPE','Annual MAPE'].flatMap(name => ['raw_modis','harmonized'].map(series => <td key={`${name}-${series}`} title={metric(p,name,series) == null ? 'Not reported in validation file' : undefined}>{fmt(metric(p,name,series))}</td>))}</tr>)}</tbody></table></div>
      <p className="footnote">Lower MAPE is better. Uncorrected = raw MODIS; corrected = harmonized model. — means not reported in the validation file. These national scores do not independently validate custom regions. Live-year months are outside the held-out test set.</p>
      <details className="validation-details"><summary>All reported metrics and validation notes</summary><div className="validation-table"><table><thead><tr><th>Period</th><th>Metric</th><th>Uncorrected MODIS</th><th>Corrected model</th></tr></thead><tbody>{periods.flatMap((p,i) => p.metrics.map((m,j) => <tr key={`${i}-${j}`}><th>{p.label}</th><th>{m.name} ({m.unit})</th><td>{fmt(m.raw_modis)}</td><td>{fmt(m.harmonized)}</td></tr>))}</tbody></table></div>
      {validation.monthly_interval_coverage != null && <p className="footnote">Nominal {validation.nominal_interval_coverage == null ? 'unreported' : `${100*validation.nominal_interval_coverage}%`} interval · held-out monthly coverage: {(100*validation.monthly_interval_coverage).toFixed(1)}%.</p>}{validation.notes?.map((note,i) => <p key={i} className="footnote">{note}</p>)}<p className="footnote">Read from out/validation.json.</p></details>
    </> : <><div className="validation-placeholder"><span>Uncorrected MODIS <strong>—</strong></span><span>Corrected model <strong>—</strong></span></div><p className="muted">{validation?.message || 'Loading validation…'}</p></>}
    <p className="footnote">Daytime back-casts and gap-fills place MODIS activity on the VIIRS scale. Differences in pixel size and overpass timing affect what each sensor sees; harmonization cannot recover individual fires.</p>
    <div className="known-limitations"><h3>Known limitations</h3>
      {drift && <div className="drift-notice"><strong>Aqua overpass drift since 2023</strong><p>{drift.finding}</p></div>}
      <div className="limitation-list">{limitations.map((item,i) => <details key={i}><summary>{typeof item === 'string' ? item : title(item.id)}</summary>{typeof item !== 'string' && <DetailValue value={Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'id'))}/>}</details>)}</div>
      {!limitations.length && <p className="muted">Known limitations have not been supplied in the validation file.</p>}
    </div>
    <p className="night-note">Night activity is VIIRS-only from 2012; it is not back-cast.</p>
  </section>;
}
