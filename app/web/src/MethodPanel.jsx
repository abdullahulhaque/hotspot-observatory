export default function MethodPanel({ validation, calibration }) {
  return <section className="panel method-panel">
    <div className="eyebrow">04 / UNDERSTAND THE ESTIMATE</div><h2>Method and validation</h2>
    <p className="muted">Daytime back-casts scale the MODIS spatial footprint to the VIIRS scale before 2012. From 2012, harmonized activity follows observed VIIRS, with model estimates in months marked as gap-filled. Nighttime is never back-cast.</p>
    <p className="footnote">Calibration: {calibration || 'Loading…'}. A back-cast cannot recover locations detected only by VIIRS. Gap flags mark potentially incomplete sensor months.</p>
    <h3>Held-out error</h3>
    {validation?.status === 'ready' ? <><p className="muted">Held-out period: {validation.held_out}</p><div className="validation-table"><table><thead><tr><th>Metric</th><th>Raw MODIS</th><th>Harmonized model</th></tr></thead><tbody>{validation.metrics.map((m, i) => <tr key={i}><th>{m.name} ({m.unit})</th><td>{m.raw_modis.toLocaleString('en', { maximumFractionDigits: 2 })}</td><td>{m.harmonized.toLocaleString('en', { maximumFractionDigits: 2 })}</td></tr>)}</tbody></table></div></> : <><div className="validation-placeholder"><span>Raw MODIS <strong>—</strong></span><span>Harmonized model <strong>—</strong></span></div><p className="muted">{validation?.message || 'Loading validation…'}</p></>}
    {validation?.monthly_interval_coverage != null && <p className="footnote">Nominal 80% interval · held-out monthly coverage: {(100 * validation.monthly_interval_coverage).toFixed(1)}%.</p>}
    {validation?.notes?.map((note, i) => <p className="footnote" key={i}>{note}</p>)}
    <p className="footnote">Scores are read from <code>out/validation.json</code>. No validation scores are inferred from demo values.</p>
    <p className="footnote">Active cell-days count days with hotspot detections in each 0.1° cell. These are hotspot detections, not individual fires or burned area.</p>
  </section>;
}
