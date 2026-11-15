import { fmtNumber } from './Figure.jsx';

const years = list => Array.isArray(list) && list.length ? `${Math.min(...list)}–${Math.max(...list)}` : 'Not reported';
const signed = (value, digits = 3) => value == null ? '—' : `${value >= 0 ? '+' : '−'}${fmtNumber(Math.abs(value), digits)}`;
const pct = value => value == null ? '—' : `${fmtNumber(100 * value, 1)}%`;

export default function MethodSteps({ meta, validation }) {
  const ready = validation?.status === 'ready';
  const model = ready ? validation.model || {} : {};
  const loyo = ready ? validation.interval_80?.leave_one_year_out : null;
  const q = loyo?.monthly_log_q10_q90;
  const limits = ready ? validation.known_limitations || [] : [];
  const overpass = limits.find(item => item?.id === 'backcast_overpass_assumption')?.check;
  const staticCheck = ready ? validation.live_year?.static_sources?.validation_residual_celldays_pct : null;
  const staticMax = staticCheck ? Math.max(...Object.values(staticCheck).flatMap(v => Object.values(v)).map(Math.abs)) : null;
  const flagged = ready ? validation.gap_flagged_months || [] : [];
  const filled = ready ? validation.gap_filled_months || [] : [];
  const excess = meta?.modelled_cells_exceeding_days;
  const params = meta?.parameters || {};

  function downloadParameters() {
    const record = {
      generated_from: ['out/harmonized.parquet metadata', 'out/validation.json'],
      data_file: params, model, test_years: validation?.test_years, interval_80: validation?.interval_80,
      gap_rule: 'a day is a gap day for a sensor with zero national rows while the reference sensor has rows; a month is flagged when it has more than 3 gap days',
      gap_flagged_months: flagged, gap_filled_months: filled, join_check_2012: validation?.join_check_2012,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'hotspot-observatory-parameters.json';
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <>
    <ol className="method-steps">
      <li><h3>Filter detections</h3><p>Keep presumed vegetation fires and drop low-confidence detections.</p><p className="param">{params.filters || 'MODIS Aqua confidence ≥ 30; VIIRS S-NPP confidence not low; type 0'}</p></li>
      <li><h3>Grid and count</h3><p>Assign detections to 0.1° cells and count active cell-days per month, separately for each sensor and for day and night.</p><p className="param">Unit: {params.unit || 'active_cell_days_0.1deg'} · times in UTC</p></li>
      <li><h3>Flag sensor outages</h3><p>A day is a gap day for a sensor when it has no detections anywhere in Argentina while the reference sensor does (Aqua ↔ S-NPP from 2012, Aqua ↔ Terra before). A month with more than 3 gap days is flagged and excluded from fitting and scoring.</p><p className="param">{flagged.length ? `${flagged.length} flagged months: ${flagged.map(f => `${f.month_str} (${f.sensor_missing} missing)`).join(', ')}` : 'Flagged months not reported'}</p></li>
      <li><h3>Fit four candidate calibrations on the overlap years</h3><p>Each model predicts national monthly daytime VIIRS cell-days from MODIS cell-days. They are competing hypotheses about how the sensors relate.</p>
        <ul className="model-list"><li><b>A.</b> constant ratio, V = r · M</li><li><b>B.</b> power law, log(1 + V) = a + b · log(1 + M)</li><li><b>C.</b> power law with a term for each calendar month</li><li><b>D.</b> power law fitted separately for each 2° block</li></ul>
        <p className="param">Training {years(model.train_years)}{model.train_excluded_months?.length ? `, excluding ${model.train_excluded_months.join(', ')}` : ''}. Night is never modelled: MODIS detects too few night fires.</p></li>
      <li><h3>Test on held-out years and choose one model</h3><p>Score each model against VIIRS on years excluded from fitting. Model B was chosen: it has the lowest annual error on held-out years, near-zero bias and two parameters (see Validation).</p>
        <p className="param equation">log(1 + VIIRS) = {model.a != null ? fmtNumber(model.a, 4) : 'a'} + {model.b != null ? fmtNumber(model.b, 5) : 'b'} · log(1 + MODIS) · held-out years {years(validation?.test_years)}</p></li>
      <li><h3>Estimate uncertainty</h3><p>Refit Model B leaving out one training year at a time and take the 10th and 90th percentiles of the out-of-year residuals. This gives a nominal 80% prediction interval for any modelled month.</p>
        <p className="param">{q ? `Residual quantiles (log scale) ${signed(q[0])} / ${signed(q[1])}, i.e. ×${fmtNumber(Math.exp(q[0]), 3)} to ×${fmtNumber(Math.exp(q[1]), 3)} the estimate` : 'Interval quantiles not reported'}</p></li>
      <li><h3>Build the harmonized record</h3><p>Daytime 2003–2011 is back-cast from MODIS with Model B. Months with a VIIRS outage are gap-filled the same way. Every other month uses observed VIIRS. Each national estimate is spread over cells in proportion to their MODIS cell-days, so cells sum exactly to the national value. Night is VIIRS only, from 2012.</p>
        <p className="param">{filled.length ? `Gap-filled months: ${filled.map(f => f.month).join(', ')}` : 'Gap-filled months not reported'}</p></li>
      <li><h3>Append the live year</h3><p>2026 comes from the FIRMS API: standard processing where available, near-real-time after. Points are clipped to Argentina, and an outage is filled only after confirming the satellite returned no data worldwide.</p>
        <p className="param">{validation?.live_year?.months_appended?.length ? `Months appended: ${validation.live_year.months_appended[0]} to ${validation.live_year.months_appended.at(-1)}; provisional NRT months: ${(validation.live_year.nrt_months || []).join(', ') || 'none'}` : 'Live-year details not reported'}</p></li>
    </ol>

    <h3 className="minor-heading">Assumptions and how each was checked</h3>
    <div className="table-scroll"><table className="assumptions">
      <thead><tr><th scope="col">Assumption</th><th scope="col">Status</th><th scope="col">Evidence</th></tr></thead>
      <tbody>
        <tr><th scope="row">The MODIS–VIIRS relationship fitted on 2012–2019 holds in other years</th><td><span className="status partial">Tested, partly holds</span></td><td>Held-out error rises from 2023, when Aqua's overpass time drifts later (Validation, Limitations).</td></tr>
        <tr><th scope="row">Aqua's 2003–2011 overpass time matches the training years, so the back-cast is valid</th><td><span className={`status ${overpass?.verdict === 'confirmed' ? 'ok' : 'partial'}`}>{overpass ? `Tested, ${overpass.verdict}` : 'Not reported'}</span></td><td>{overpass ? `Back-cast years ${overpass.backcast_2003_2011_range.join('–')} vs training ${overpass.training_year_range.join('–')} local solar time; largest difference ${fmtNumber(Math.max(...Object.values(overpass.backcast_minus_training_minutes_by_year).map(Math.abs)), 0)} min against a ${fmtNumber(overpass.tolerance_minutes, 0)} min tolerance.` : '—'}</td></tr>
        <tr><th scope="row">A national calibration applies to any sub-region</th><td><span className="status untested">Not tested</span></td><td>Regional values and intervals are scaled national results. No regional reference was held out.</td></tr>
        <tr><th scope="row">Near-real-time detections at known industrial locations are not vegetation fires</th><td><span className="status ok">{staticMax != null ? 'Tested' : 'Not reported'}</span></td><td>{staticMax != null ? `On 2025 and 2026 standard data the inferred filter leaves at most ${fmtNumber(staticMax, 2)}% residual cell-day error.` : '—'}</td></tr>
        <tr><th scope="row">Modelled months keep the MODIS spatial pattern</th><td><span className="status untested">Assumed</span></td><td>Cells only VIIRS would detect stay at zero.{excess?.count ? ` ${fmtNumber(excess.count, 0)} modelled cell-months exceed the days in their month (maximum ${fmtNumber(excess.max, 1)}), which a literal cell-day count cannot.` : ''}</td></tr>
        <tr><th scope="row">Counting cell-days removes the pixel-size difference</th><td><span className="status partial">Partly</span></td><td>Fires on a cell boundary count in each cell they touch, and the chance differs by pixel size. Model B absorbs the national average effect.</td></tr>
      </tbody>
    </table></div>

    <div className="parameters-block">
      <h3 className="minor-heading">Parameters used</h3>
      <dl className="parameters">
        <div><dt>Calibration</dt><dd>{params.calibration || meta?.calibration || '—'}</dd></div>
        <div><dt>Data contract</dt><dd>{params.contract || meta?.contract || '—'}</dd></div>
        <div><dt>Coverage</dt><dd>{params.coverage || '—'}</dd></div>
        <div><dt>Model form</dt><dd>{model.form || '—'}</dd></div>
        <div><dt>Coefficients</dt><dd>{model.a != null ? `a = ${fmtNumber(model.a, 6)}, b = ${fmtNumber(model.b, 6)}` : '—'}</dd></div>
        <div><dt>Training / held-out</dt><dd>{years(model.train_years)} / {years(validation?.test_years)}</dd></div>
        <div><dt>Interval</dt><dd>{q ? `Nominal ${pct(validation.interval_80.nominal)}, leave-one-year-out; measured held-out coverage ${pct(loyo.monthly_test_coverage)}` : '—'}</dd></div>
        <div><dt>Gap rule</dt><dd>More than 3 gap days in a month</dd></div>
        <div><dt>Grid</dt><dd>0.1° cells, WGS84, UTC days</dd></div>
      </dl>
      <button className="secondary-button" onClick={downloadParameters} disabled={!ready}>Download parameters (JSON)</button>
      <details className="reproduce"><summary>Reproduce the scientific pipeline</summary>
        <pre><code>{`bash get_rest.sh Argentina                       # FIRMS yearly archives
python pipeline/calibration.py                   # fit and score models A–D
python pipeline/fetch_firms.py                   # live year (needs FIRMS_MAP_KEY)
python pipeline/fetch_firms.py --coverage-check  # confirm S-NPP outages
python pipeline/harmonize.py                     # write the harmonized record`}</code></pre>
        <p className="footnote">harmonize.py refits Model B and stops unless it reproduces the Task 2 coefficients and scores, and checks that cells sum to the national value in every month.</p>
      </details>
    </div>
  </>;
}
