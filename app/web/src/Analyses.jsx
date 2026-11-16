import { useEffect, useRef, useState } from 'react';
import Figure, { SERIES, fmtNumber, monthName } from './Figure.jsx';
import { anomalyClass, ANOMALY_CLASSES, climatology, MIN_BASELINE, monthWindow, seasonalTiming, trendTest, unwrapMonths } from './stats.js';

function useWidth(initial, minimum = 280) {
  const ref = useRef(null), [width, setWidth] = useState(initial);
  useEffect(() => { const o = new ResizeObserver(([e]) => setWidth(Math.max(minimum, e.contentRect.width))); o.observe(ref.current); return () => o.disconnect(); }, [minimum]);
  return [ref, width];
}
const MONTH_LETTERS = 'JFMAMJJASOND';
const STYLES = [
  { color: SERIES.harmonized, dash: undefined, marker: 'circle' },
  { color: SERIES.modis, dash: '7 4', marker: 'square' },
  { color: SERIES.viirs, dash: '2 3', marker: 'triangle' },
  { color: SERIES.green, dash: '9 3 2 3', marker: 'diamond' },
];
function Marker({ shape, x, y, color, size = 3.6 }) {
  if (shape === 'square') return <rect x={x - size} y={y - size} width={size * 2} height={size * 2} fill={color}/>;
  if (shape === 'triangle') return <path d={`M${x},${y - size * 1.2} L${x + size * 1.1},${y + size * .9} L${x - size * 1.1},${y + size * .9} Z`} fill={color}/>;
  if (shape === 'diamond') return <path d={`M${x},${y - size * 1.3} L${x + size * 1.1},${y} L${x},${y + size * 1.3} L${x - size * 1.1},${y} Z`} fill={color}/>;
  return <circle cx={x} cy={y} r={size} fill={color}/>;
}

// Typical seasonal cycle of each preset region from the harmonized record.
export function RegionalComparison({ regions }) {
  const [ref, width] = useWidth(800);
  const [scale, setScale] = useState('share');
  const ready = regions.filter(r => r.series?.data);
  const profiles = ready.map(r => ({ ...r, profile: climatology(r.series.data) })).filter(r => r.profile.years);
  const loading = regions.some(r => r.loading), error = regions.find(r => r.error)?.error;
  const W = width, H = 300, L = 62, R = 14, T = 16, B = 48;
  const value = m => scale === 'share' ? m.share : m.mean;
  const max = Math.max(1, ...profiles.flatMap(p => p.profile.months.map(value))) * 1.08;
  const x = month => L + (month - 1) / 11 * (W - L - R);
  const y = v => H - B - v / max * (H - T - B);
  const years = profiles[0]?.profile;
  return <Figure title="Typical seasonal cycle of fire activity by region" className="regional-figure"
    source="Harmonized daytime record (/series), averaged over complete years for each preset bounding box"
    period={years ? `${years.first}–${years.last}, ${years.years} complete years` : 'Loading…'}
    note="Includes back-cast years 2003–2011. Bounding boxes differ in size, so compare shares for timing and cell-days for amount.">
    <div ref={ref}>
      <div className="segmented" role="group" aria-label="Seasonal profile scale">{[['share', 'Share of the year'], ['mean', 'Mean cell-days']].map(([key, label]) => <button key={key} aria-pressed={scale === key} onClick={() => setScale(key)}>{label}</button>)}</div>
      {error ? <p className="field-error">{error}</p> : !profiles.length ? <div className="figure-empty">{loading ? 'Loading regional profiles…' : 'No complete years available.'}</div> : <>
        <div className="chart-key">{profiles.map((p, i) => <span key={p.name}><svg width="26" height="10" aria-hidden="true"><line x1="0" x2="26" y1="5" y2="5" stroke={STYLES[i].color} strokeWidth="2" strokeDasharray={STYLES[i].dash}/><Marker shape={STYLES[i].marker} x={13} y={5} color={STYLES[i].color} size={3}/></svg>{p.name}</span>)}</div>
        <svg className="chart regional-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Seasonal profiles: ${profiles.map(p => `${p.name} peaks in ${monthName(p.profile.peak?.month)}`).join('; ')}`}>
          {[0, .25, .5, .75, 1].map(f => <g key={f}><line className="gridline" x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)}/><text className="tick" x={L - 8} y={y(max * f) + 4} textAnchor="end">{scale === 'share' ? `${fmtNumber(max * f, 0)}%` : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(max * f)}</text></g>)}
          {Array.from({ length: 12 }, (_, i) => <text className="tick" key={i} x={x(i + 1)} y={H - B + 18} textAnchor="middle">{width < 520 ? MONTH_LETTERS[i] : monthName(i + 1)}</text>)}
          <text className="axis-title" x={(L + W - R) / 2} y={H - 6} textAnchor="middle">Calendar month</text>
          <text className="axis-title" transform={`translate(13 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle">{scale === 'share' ? 'Share of mean annual activity (%)' : 'Mean active cell-days per month'}</text>
          {profiles.map((p, i) => <g key={p.name}>
            <path d={p.profile.months.map((m, j) => `${j ? 'L' : 'M'}${x(m.month)},${y(value(m))}`).join(' ')} fill="none" stroke={STYLES[i].color} strokeWidth="2" strokeDasharray={STYLES[i].dash}/>
            {p.profile.months.map(m => <Marker key={m.month} shape={STYLES[i].marker} x={x(m.month)} y={y(value(m))} color={STYLES[i].color}/>)}
          </g>)}
        </svg>
        <div className="table-scroll"><table className="numeric-table compact">
          <thead><tr><th scope="col">Region</th><th scope="col">Peak month</th><th scope="col">Share of year in peak month</th><th scope="col">Mean annual activity</th><th scope="col">Complete years</th></tr></thead>
          <tbody>{profiles.map(p => <tr key={p.name}><th scope="row">{p.name}</th><td>{p.profile.peak ? monthName(p.profile.peak.month) : '—'}</td><td>{p.profile.peak ? `${fmtNumber(p.profile.peak.share, 1)}%` : '—'}</td><td>{fmtNumber(p.profile.annual, 0)} cell-days</td><td>{p.profile.years}</td></tr>)}</tbody>
        </table></div>
      </>}
    </div>
  </Figure>;
}

// Timing of the peak and long-term change for the selected region.
export function TimingTrend({ series, regionName, loading, error }) {
  const [ref, width] = useWidth(800);
  const rows = series?.data || [];
  const timing = seasonalTiming(rows);
  const totals = trendTest(timing.map(t => ({ x: t.year, y: t.total })));
  const unwrapped = unwrapMonths(timing.map(t => t.centre));
  const centreTrend = trendTest(timing.map((t, i) => ({ x: t.year, y: unwrapped.values[i] })));
  const W = width, H = 240, L = 62, R = 14, T = 14, B = 46, narrow = width < 560;
  const first = timing[0]?.year, last = timing.at(-1)?.year;
  const x = year => L + (year - first) / Math.max(1, last - first) * (W - L - R);
  const maxTotal = Math.max(1, ...timing.map(t => t.total)) * 1.08;
  const yT = v => H - B - v / maxTotal * (H - T - B);
  const ticks = timing.filter(t => t.year === first || t.year === last || (t.year % (narrow ? 10 : 5) === 0 && t.year - first >= 4 && last - t.year >= 2));
  const describe = (test, unit, digits) => test.status !== 'ready' ? test.message : `Sen's slope ${test.slope >= 0 ? '+' : '−'}${fmtNumber(Math.abs(test.slope), digits)} ${unit} per year (95% interval ${fmtNumber(test.lower, digits)} to ${fmtNumber(test.upper, digits)}); Mann–Kendall τ = ${fmtNumber(test.tau, 2)}, p ${test.p < 0.001 ? '< 0.001' : `= ${fmtNumber(test.p, 3)}`}, n = ${test.n} years.`;
  const verdict = test => test.status !== 'ready' ? '' : test.p < 0.05 ? (test.slope > 0 ? 'An increasing monotonic trend is detected at the 5% level.' : 'A decreasing monotonic trend is detected at the 5% level.') : 'No monotonic trend is detected at the 5% level.';
  const mY = month => H - B - (month - (unwrapped.mean - 6)) / 12 * (H - T - B);
  const monthLabel = v => monthName(((Math.round(v) - 1) % 12 + 12) % 12 + 1);
  return <Figure title={`Timing and size of the fire year in ${regionName}`} className="timing-figure"
    source="Harmonized daytime record for the selected bounding box; trend statistics computed in the browser from these values"
    period={first ? `${first}–${last}, complete years only` : 'Loading…'}
    note="Years before 2012 are back-cast from MODIS, so part of any trend can come from the calibration. The test assumes independent years and is not a cause.">
    <div ref={ref}>
      {loading ? <div className="figure-empty">Loading the regional record…</div> : error ? <p className="field-error">{error}</p> : series?.has_data === false ? <div className="figure-empty">No data in this area</div> : timing.length < 2 ? <div className="figure-empty">Not enough complete years.</div> : <div className="twin-charts">
        <div>
          <h4 className="panel-title">a. Annual active cell-days with Sen's slope</h4>
          <svg className="chart trend-chart" viewBox={`0 0 ${W / (narrow ? 1 : 2)} ${H}`} role="img" aria-label={`Annual totals for ${regionName}. ${describe(totals, 'cell-days', 0)}`}>
            {(() => { const w = W / (narrow ? 1 : 2), xx = year => L + (year - first) / Math.max(1, last - first) * (w - L - R); return <>
              {[0, .5, 1].map(f => <g key={f}><line className="gridline" x1={L} x2={w - R} y1={yT(maxTotal * f)} y2={yT(maxTotal * f)}/><text className="tick" x={L - 8} y={yT(maxTotal * f) + 4} textAnchor="end">{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(maxTotal * f)}</text></g>)}
              {ticks.map(t => <text className="tick" key={t.year} x={xx(t.year)} y={H - B + 18} textAnchor="middle">{t.year}</text>)}
              <text className="axis-title" x={(L + w - R) / 2} y={H - 6} textAnchor="middle">Year</text>
              <text className="axis-title" transform={`translate(13 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle">Active cell-days per year</text>
              {timing.map(t => <circle key={t.year} cx={xx(t.year)} cy={yT(t.total)} r="3.5" fill={t.year < 2012 ? '#fff' : SERIES.harmonized} stroke={SERIES.harmonized} strokeWidth="1.5"><title>{t.year}: {fmtNumber(t.total, 0)} active cell-days{t.year < 2012 ? ' (back-cast)' : ''}</title></circle>)}
              {totals.status === 'ready' && <line x1={xx(first)} x2={xx(last)} y1={yT(totals.intercept + totals.slope * first)} y2={yT(totals.intercept + totals.slope * last)} stroke={SERIES.modis} strokeWidth="2" strokeDasharray="6 3"/>}
            </>; })()}
          </svg>
          <p className="stat-line">{describe(totals, 'cell-days', 0)} <strong>{verdict(totals)}</strong></p>
        </div>
        <div>
          <h4 className="panel-title">b. Peak month and activity-weighted centre of the season</h4>
          <svg className="chart timing-chart" viewBox={`0 0 ${W / (narrow ? 1 : 2)} ${H}`} role="img" aria-label={`Seasonal timing for ${regionName}. ${describe(centreTrend, 'months', 2)}`}>
            {(() => { const w = W / (narrow ? 1 : 2), xx = year => L + (year - first) / Math.max(1, last - first) * (w - L - R); return <>
              {Array.from({ length: 13 }, (_, k) => Math.ceil(unwrapped.mean - 6) + k).filter(v => v <= unwrapped.mean + 6 && (v - 1) % 3 === 0).map(v => { return <g key={v}><line className="gridline" x1={L} x2={w - R} y1={mY(v)} y2={mY(v)}/><text className="tick" x={L - 8} y={mY(v) + 4} textAnchor="end">{monthLabel(v)}</text></g>; })}
              {ticks.map(t => <text className="tick" key={t.year} x={xx(t.year)} y={H - B + 18} textAnchor="middle">{t.year}</text>)}
              <text className="axis-title" x={(L + w - R) / 2} y={H - 6} textAnchor="middle">Year</text>
              <text className="axis-title" transform={`translate(13 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle">Month of year</text>
              {timing.map((t, i) => <g key={t.year}>
                {t.peaks.map(p => { const v = unwrapped.mean + ((((p - unwrapped.mean) % 12) + 18) % 12) - 6; return <rect key={p} x={xx(t.year) - 3.5} y={mY(v) - 3.5} width="7" height="7" fill="none" stroke={SERIES.modis} strokeWidth="1.5"><title>{t.year}: peak month {monthName(p)}</title></rect>; })}
                {unwrapped.values[i] != null && <circle cx={xx(t.year)} cy={mY(unwrapped.values[i])} r="3.5" fill={SERIES.viirs}><title>{t.year}: centre of activity {fmtNumber(unwrapped.values[i], 1)} ({monthLabel(unwrapped.values[i])})</title></circle>}
              </g>)}
            </>; })()}
          </svg>
          <div className="chart-key"><span><i className="key-marker square"/>Peak month</span><span><i className="key-swatch round" style={{ background: SERIES.viirs }}/>Activity-weighted centre</span><span><i className="key-line key-dashed" style={{ background: 'none', borderColor: SERIES.modis }}/>Sen's slope (panel a)</span></div>
          <p className="stat-line">Centre of the season: {describe(centreTrend, 'months', 3)} <strong>{verdict(centreTrend)}</strong></p>
        </div>
      </div>}
      {timing.length > 1 && <details className="figure-data"><summary>Data table</summary><div className="table-scroll"><table><thead><tr><th scope="col">Year</th><th scope="col">Annual active cell-days</th><th scope="col">Peak month</th><th scope="col">Centre of activity</th><th scope="col">Source</th></tr></thead><tbody>{timing.map((t, i) => <tr key={t.year}><th scope="row">{t.year}</th><td>{fmtNumber(t.total, 1)}</td><td>{t.peaks.map(monthName).join(', ') || '—'}</td><td>{t.centre == null ? '—' : `${fmtNumber(unwrapped.values[i], 2)} (${monthLabel(unwrapped.values[i])})`}</td><td>{t.year < 2012 ? 'Back-cast' : 'Observed VIIRS'}</td></tr>)}</tbody></table></div></details>}
    </div>
  </Figure>;
}

// Context for the selected month: every earlier same-month value, the median and a
// screening class with explicit percentile rules. Never shown when comparison is withheld.
export function AnomalyContext({ stats, monthLabel: label, blocked }) {
  const [ref, width] = useWidth(300, 220);
  const history = stats?.history || [];
  const result = blocked ? { status: 'withheld' } : anomalyClass(stats?.value, history);
  const values = history.map(h => h.value);
  const W = width, H = 74, L = 8, R = 8;
  const max = Math.max(1, stats?.value || 0, ...values) * 1.05;
  const x = v => L + v / max * (W - L - R);
  return <div className="anomaly-context" ref={ref}>
    {history.length > 0 && <svg className="chart strip-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${history.length} earlier ${label} values from ${fmtNumber(Math.min(...values), 0)} to ${fmtNumber(Math.max(...values), 0)} active cell-days; median ${fmtNumber(stats.historical_median, 0)}${stats.value != null ? `; selected ${fmtNumber(stats.value, 0)}` : ''}`}>
      <line className="axis-line" x1={L} x2={W - R} y1={34} y2={34}/>
      {history.map(h => <circle key={h.year} cx={x(h.value)} cy={34} r="4" fill={h.source === 'observed' ? SERIES.muted : '#fff'} stroke={SERIES.muted} fillOpacity=".55"><title>{h.year}: {fmtNumber(h.value, 1)}{h.source !== 'observed' ? ' (estimate)' : ''}</title></circle>)}
      {stats.historical_median != null && <g><line x1={x(stats.historical_median)} x2={x(stats.historical_median)} y1={20} y2={48} stroke={SERIES.harmonized} strokeWidth="1.5"/><text className="tick" x={x(stats.historical_median)} y={14} textAnchor="middle">median</text></g>}
      {stats.value != null && <path d={`M${x(stats.value)},${48} l6,10 l-12,0 Z`} fill={SERIES.modis}><title>Selected month: {fmtNumber(stats.value, 1)}</title></path>}
      <text className="tick" x={L} y={H - 2}>0</text><text className="tick" x={W - R} y={H - 2} textAnchor="end">{fmtNumber(max, 0)} cell-days</text>
    </svg>}
    <p className="anomaly-class" data-status={result.status}>{result.status === 'ready' ? <><strong>{result.label}</strong>: {fmtNumber(result.percentile, 0)}th percentile of {result.n} earlier {label} records ({result.rule}).</> : result.status === 'insufficient' ? `Screening class needs at least ${MIN_BASELINE} earlier records; ${result.n} available.` : result.status === 'withheld' ? 'Screening class withheld with the comparison.' : 'Screening class unavailable.'}</p>
    <details className="anomaly-rules"><summary>How months are classed</summary><ul>{ANOMALY_CLASSES.map(c => <li key={c.label}><b>{c.label}</b>: {c.rule}</li>)}</ul><p>Percentiles use mid-ranks among earlier same-month values (ties count half). Back-cast and gap-filled values are included and drawn as open circles.</p></details>
    <p className="anomaly-disclaimer">An anomaly is a signal to investigate, not a prediction that a wildfire will occur.</p>
  </div>;
}

// The selected calendar month in each of the last N years, ending at the selected year.
// Bars are values from /anomaly (same_month); the dashed line is the inspector's baseline median.
export function SameMonthChart({ sameMonth, year, monthLabel: label, median, baselineLabel, count, onCount }) {
  const [ref, width] = useWidth(300, 220);
  const rows = monthWindow(sameMonth, year, count);
  const values = rows.map(r => r.value).filter(v => v != null);
  const W = width, H = 150, L = 40, R = 6, T = 14, B = 24;
  const max = Math.max(1, median || 0, ...values) * 1.1;
  const step = (W - L - R) / Math.max(1, rows.length);
  const y = v => H - B - v / max * (H - T - B);
  const labelEvery = rows.length > 12 ? 5 : rows.length > 6 ? 2 : 1;
  const kind = r => r.value == null ? 'missing' : r.year === year ? 'selected' : r.incomplete ? 'incomplete' : r.source && r.source !== 'observed' ? 'estimate' : 'observed';
  const describe = r => `${r.year}: ${r.value == null ? 'unavailable' : `${fmtNumber(r.value)} active cell-days`}${r.source && r.source !== 'observed' ? `, ${r.source === 'backcast' ? 'back-cast' : 'gap-filled'} estimate` : ''}${r.incomplete ? ', incomplete observations' : ''}${r.nrt ? ', provisional' : ''}`;
  return <div className="same-month" ref={ref}>
    <div className="same-month-head"><h3 className="same-month-title">{label} in the last {count} years</h3>
      <div className="segmented" role="group" aria-label="Years to compare">{[5, 10, 20].map(n => <button key={n} aria-pressed={count === n} onClick={() => onCount(n)}>{n}</button>)}</div></div>
    {!rows.length ? <p className="muted">No earlier records for this month.</p> : <>
      <svg className="chart same-month-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}, harmonized active cell-days by year: ${rows.map(describe).join('; ')}`}>
        <line className="gridline" x1={L} x2={W - R} y1={y(max / 1.1)} y2={y(max / 1.1)}/>
        <text className="tick" x={L - 5} y={y(max / 1.1) + 4} textAnchor="end">{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(max / 1.1)}</text>
        <text className="tick" x={L - 5} y={H - B + 4} textAnchor="end">0</text>
        <line className="axis-line" x1={L} x2={W - R} y1={H - B} y2={H - B}/>
        {rows.map((r, i) => { const x = L + i * step + step * .15, w = Math.max(2, step * .7), k = kind(r); return <g key={r.year} className={`same-month-bar ${k}`}>
          <title>{describe(r)}</title>
          {r.value == null ? <text className="tick" x={x + w / 2} y={H - B - 4} textAnchor="middle">n/a</text> : <rect x={x} width={w} y={y(r.value)} height={Math.max(.5, H - B - y(r.value))}/>}
          {((i % labelEvery === 0 && !(labelEvery > 1 && Math.abs(r.year - year) < labelEvery)) || r.year === year) && <text className={`tick${r.year === year ? ' strong' : ''}`} x={x + w / 2} y={H - 8} textAnchor="middle">{rows.length > 10 ? `'${String(r.year).slice(2)}` : r.year}</text>}
        </g>; })}
        {median != null && <g className="same-month-median"><line x1={L} x2={W - R} y1={y(median)} y2={y(median)}/><text x={W - R} y={y(median) - 4} textAnchor="end">median {fmtNumber(median, 0)}</text></g>}
      </svg>
      <div className="chart-key"><span><i className="key-swatch" style={{ background: SERIES.harmonized }}/>Selected</span><span><i className="key-swatch" style={{ background: SERIES.viirs }}/>Observed</span><span><i className="key-swatch estimate"/>Model estimate</span><span><i className="key-swatch incomplete"/>Incomplete</span></div>
      <p className="footnote">Dashed line: {baselineLabel}. Harmonized values, active cell-days. Incomplete months are shown but excluded from the median and rank.</p>
      <details className="figure-data"><summary>Values</summary><div className="table-scroll"><table><thead><tr><th scope="col">Year</th><th scope="col">Active cell-days</th><th scope="col">Provenance</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.year}><th scope="row">{r.year}</th><td>{fmtNumber(r.value)}</td><td>{r.value == null ? 'Unavailable' : `${r.source === 'backcast' ? 'Back-cast estimate' : r.source === 'gapfill' ? 'Gap-filled estimate' : 'Observed'}${r.incomplete ? ' · Incomplete' : ''}${r.nrt ? ' · Provisional' : ''}`}</td></tr>)}</tbody></table></div></details>
    </>}
  </div>;
}
