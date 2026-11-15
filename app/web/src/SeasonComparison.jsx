import { useMemo, useState } from 'react';
import { compareSeasons, SEASONS } from './seasons.js';
import { qualityLabel } from './provenance.js';

const fmt = value => value == null ? 'Unavailable' : value.toLocaleString('en-US', { maximumFractionDigits: 1 });
export default function SeasonComparison({ series, loading, error, start, end, regionName, period, onPeriodChange }) {
  const [seasonId, setSeasonId] = useState('spring'), [count, setCount] = useState(10), [selected, setSelected] = useState(null);
  const result = useMemo(() => compareSeasons(series?.data || [], seasonId, count, start, end, period), [series, seasonId, count, start, end, period]);
  const active = result.seasons.find(season => season.id === selected) || result.complete.at(-1) || result.seasons.at(-1);
  const W = Math.max(650, result.seasons.length * 76), H = 330, L = 72, R = 18, T = 34, B = 80;
  const max = Math.max(1, ...result.seasons.map(season => season.partialTotal ?? 0)) * 1.12;
  const y = value => H - B - value / max * (H - T - B);
  const step = (W - L - R) / Math.max(1, result.seasons.length);
  const difference = active?.complete && result.median != null ? active.total - result.median : null;
  const describe = season => `${season.label}: ${season.complete ? 'Total' : 'Incomplete · partial total'} ${fmt(season.partialTotal)} active cell-days. ${season.months.map(month => `${month.key}: ${fmt(month.value)}${month.reason ? `, ${month.reason}` : ''}${month.row ? `, ${qualityLabel(month.row)}` : ''}`).join('; ')}`;
  return <section className="season-panel" aria-label="Historical seasonal comparisons" aria-busy={loading}>
    <div className="figure-head"><h3 className="figure-title">Seasonal totals against the median of recent complete seasons</h3></div>
    <div className="season-controls"><label>Season<select aria-label="Season" value={seasonId} onChange={event => { setSeasonId(event.target.value); setSelected(null); }}>{SEASONS.map(season => <option key={season.id} value={season.id}>{season.label}</option>)}</select></label>
      <label>Comparison window<select aria-label="Comparison window" value={count} onChange={event => { setCount(Number(event.target.value)); setSelected(null); }}>{[3, 5, 10].map(value => <option key={value} value={value}>Last {value} complete seasons</option>)}</select></label>
      <label>Acquisition<select aria-label="Season day or night" value={period} onChange={event => onPeriodChange(event.target.value)}><option value="D">Daytime</option><option value="N">Nighttime</option></select></label></div>
    <p className="muted">{regionName} · Harmonized · {period === 'D' ? 'Daytime' : 'Nighttime'} active cell-days · Full record through {end}. Calendar date and raw-sensor filters do not change this comparison.</p>
    {loading ? <p className="empty">Loading seasonal activity…</p> : error ? <p className="field-error" role="alert">{error}</p> : series?.has_data === false ? <p className="empty">No data in this area</p> : !result.seasons.length ? <p className="empty">No seasons available</p> : <>
      <p className="footnote season-window">{result.complete.length} complete seasons displayed{result.complete.length < count ? ` (fewer than ${count} are available)` : ''}. Grey incomplete seasons are additional context and excluded from the median and full-season comparisons.</p>
      {result.seasons.some(season => !season.complete) && <p className="quality-notice season-warning">Missing-data warning: incomplete seasons contain unavailable months, incomplete observations, or unverified coverage. Grey bars show partial totals only; missing months are never counted as zero.</p>}
      <p className="footnote season-reference">Dashed line: {result.median == null ? 'no complete-season median available' : `median ${fmt(result.median)} active cell-days`}.</p>
      <p className="season-scroll-hint footnote">Swipe or scroll horizontally to see every season.</p>
      <div className="season-chart-scroll"><svg className="chart sensor-chart season-chart" viewBox={`0 0 ${W} ${H}`} style={{ minWidth: W }} role="group" aria-label="Harmonized seasonal totals and displayed-season median">
        <defs><pattern id="estimate-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#0067A5"/><line x1="0" y1="0" x2="0" y2="6" stroke="#fff" strokeWidth="2"/></pattern></defs>
        <text className="axis-title" transform={`translate(14 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle">Active cell-days per season</text>
        <text className="axis-title" x={(L + W - R) / 2} y={H - 4} textAnchor="middle">Season (labelled by the year it starts)</text>
        {[0, .5, 1].map(f => <g key={f}><line className="gridline chart-grid" x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)}/><text className="tick" x={L - 8} y={y(max * f) + 4} textAnchor="end">{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(max * f)}</text></g>)}
        {result.seasons.map((season, index) => <g key={season.id} className={`season-bar ${season.complete ? 'complete' : 'incomplete'} ${active?.id === season.id ? 'active' : ''}`} data-season={season.id} data-total={season.total ?? ''} data-partial-total={season.partialTotal ?? ''} role="button" tabIndex="0" aria-pressed={active?.id === season.id} aria-label={describe(season)} onPointerEnter={() => setSelected(season.id)} onFocus={() => setSelected(season.id)} onClick={() => setSelected(season.id)} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); setSelected(season.id); } }}>
          <title>{describe(season)}</title><rect className="season-hit-target" x={L + index * step} y={T} width={step} height={H - T} fill="transparent"/>{season.partialTotal == null ? <text className="season-status" x={L + (index + .5) * step} y={H - B - 12} textAnchor="middle">Unavailable</text> : <rect className="season-activity" x={L + index * step + step * .2} y={y(season.partialTotal)} width={step * .6} height={Math.max(1, y(0) - y(season.partialTotal))} fill={!season.complete ? '#C3CBD2' : season.estimated ? 'url(#estimate-hatch)' : '#0067A5'}/>}
          <text x={L + (index + .5) * step} y={H - B + 18} textAnchor="middle">{season.labelYear}</text>
          {!season.complete && <text className="season-status" x={L + (index + .5) * step} y={H - B + 34} textAnchor="middle">Incomplete</text>}
          <text className="season-flags" x={L + (index + .5) * step} y={H - B + 50} textAnchor="middle">{season.estimated ? '◆ ' : ''}{season.gapFlag ? '△ ' : ''}{season.nrt ? 'NRT' : ''}</text>
        </g>)}
        {result.median != null && <g className="season-median" data-value={result.median}><line x1={L} x2={W - R} y1={y(result.median)} y2={y(result.median)}/><text x={W - R} y={T - 12} textAnchor="end">Displayed-season median: {fmt(result.median)}</text></g>}
      </svg></div>
      <p className="footnote">Solid blue: observed. Hatched blue with ◆: includes back-cast or gap-filled estimates. Light grey: incomplete, partial total. △: sensor gap flagged. NRT: provisional. Hover, focus or select a bar for its three-month breakdown.</p>
      <p className="figure-caption"><span><b>Source</b> Harmonized record for the selected bounding box (/series)</span><span><b>Period</b> {result.seasons[0]?.months[0].key} to {end}</span></p>
      {active && <div className="season-detail" aria-live="polite"><div className="season-detail-heading"><h3>{active.label}</h3><strong>{active.complete ? 'Seasonal total' : 'Incomplete · partial total'}: {fmt(active.partialTotal)} active cell-days</strong></div>
        <p className="season-comparison">{!active.complete ? 'Full-season comparison withheld. This incomplete season is excluded from the median and rankings.' : difference === 0 ? `${active.label} equals the displayed complete-season median of ${fmt(result.median)} active cell-days.` : `${active.label} is ${fmt(Math.abs(difference))} active cell-days${result.median > 0 ? ` (${fmt(100 * Math.abs(difference) / result.median)}%)` : ''} ${difference > 0 ? 'above' : 'below'} the displayed complete-season median of ${fmt(result.median)}.`}</p>
        <div className="validation-table"><table><thead><tr><th>Month</th><th>Harmonized active cell-days</th><th>Provenance and coverage</th></tr></thead><tbody>{active.months.map(month => <tr key={month.key}><th>{month.key}</th><td>{fmt(month.value)}</td><td>{month.row ? qualityLabel(month.row) : 'Unavailable'}{month.reason && <span className="quality-notice"> · {month.reason}</span>}{month.row?.missing_snpp_days > 0 && <span className="quality-notice"> · {month.row.missing_snpp_days} confirmed missing S-NPP days</span>}</td></tr>)}</tbody></table></div>
        {active.months.flatMap(month => month.row?.limitations || []).map((item, index) => <p className="footnote quality-notice" key={index}>{item.status || item.finding} Any totals in generated limitation notes are national.</p>)}
        <p className="footnote">The reference is the median of the {result.complete.length} complete seasons displayed, including this season when complete. Estimates remain included with their provenance; NRT values may change. No future observations or forecasts are added.</p>
      </div>}
    </>}
    <p className="footnote">Model performance is validated nationally. Small-area seasonal estimates have not been independently validated; national validation scores are not regional accuracy guarantees.</p>
  </section>;
}
