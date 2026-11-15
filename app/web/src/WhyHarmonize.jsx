import { useEffect, useRef, useState } from 'react';
import { qualityLabel } from './provenance.js';
import { SERIES as COLORS } from './Figure.jsx';
const fmt = n => n == null ? 'Unavailable' : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(n);
const SERIES = [['naive_splice', 'Naive splice', COLORS.viirs], ['harmonized', 'Harmonized', COLORS.harmonized]];
export default function WhyHarmonize({ data, loading, error, monthly, monthlyLoading, monthlyError, regionName, compact = false }) {
  const container = useRef(null), [width, setWidth] = useState(800);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(300, Math.min(compact ? 1400 : 800, entry.contentRect.width))));
    observer.observe(container.current); return () => observer.disconnect();
  }, [compact]);
  const rows = data?.annual_daytime || [], W = width, H = compact ? 280 : 300, L = 64, R = 20, T = 42, B = 50;
  const months = monthlyLoading || monthlyError ? [] : monthly?.data || [];
  const estimatedMonths = months.filter(row => row.source === 'backcast' || row.source === 'gapfill');
  function provenance(year, metric = 'harmonized') {
    const records = months.filter(row => row.year === year);
    if (!records.length) return { label: 'Provenance unavailable', known: false, estimated: false, incomplete: false, nrt: false };
    const counts = ['observed', 'backcast', 'gapfill'].map(source => records.filter(row => row.source === source && row.harmonized != null).length);
    const parts = metric === 'harmonized' ? counts.map((count, i) => count ? `${count} ${['observed VIIRS', 'MODIS-based back-cast', 'MODIS-based gap-fill'][i]} months` : '').filter(Boolean) : [`Raw ${year < 2012 ? 'MODIS' : 'VIIRS'} measurements`];
    const key = metric === 'harmonized' ? metric : year < 2012 ? 'raw_modis' : 'raw_viirs';
    const incomplete = records.some(row => row.incomplete_metrics?.includes(key));
    const nrt = records.some(row => row.nrt);
    if (incomplete) parts.push('Incomplete observations — may undercount activity');
    if (nrt) parts.push('NRT · provisional');
    if (records.some(row => row.gap_flag)) parts.push('Includes gap-flagged months');
    if (records.some(row => !row.quality_available)) parts.push('Coverage quality unavailable');
    return { label: parts.join(' · '), known: true, estimated: counts[1] + counts[2] > 0, incomplete, nrt };
  }
  const first = rows[0]?.year || 2003, last = rows.at(-1)?.year || 2025;
  const x = year => L + (year-first)/Math.max(1,last-first)*(W-L-R);
  const max = Math.max(1, ...rows.flatMap(r => [r.naive_splice || 0, r.harmonized || 0]));
  const y = value => H-B-value/max*(H-T-B);
  const ticks = rows.filter((r, i) => i === 0 || i === rows.length-1 || r.year % (width < 500 ? 10 : 5) === 0 && r.year-first > 2 && last-r.year > 2);
  function path(metric, keep = () => true) {
    let previous = false;
    return rows.map(row => {
      if (row[metric] == null || !keep(row)) { previous = false; return ''; }
      const segment = `${previous ? 'L' : 'M'}${x(row.year)},${y(row[metric])}`;
      previous = true; return segment;
    }).join(' ');
  }
  return <section ref={container} className="sensor-panel why-panel" aria-label="Why harmonize?">
    {!compact && <><div className="eyebrow">A CONSISTENT MEASURING STICK</div><h2>Why harmonize?</h2></>}
    <div className="figure-head"><h3 className="figure-title">Annual daytime activity in the study area: the two instruments joined, versus harmonized</h3></div>
    <p className="muted">Annual daytime totals · {regionName || 'selected area'} · full record · active cell-days</p>
    <div className="chart-key"><span><i className="key-line" style={{ background: COLORS.modis }}/>Naive splice, raw MODIS to 2011</span><span><i className="key-line" style={{ background: COLORS.viirs }}/>Naive splice, raw VIIRS from 2012</span><span><i className="key-line key-dashed"/>Harmonized</span></div>
    {error ? <p className="field-error">{error}</p> : loading ? <div className="empty">Loading annual comparison…</div> : !data?.has_data ? <div className="empty">No data in this area</div> : !rows.some(r => r.harmonized != null || r.naive_splice != null) ? <div className="empty">No complete years available.</div> : <>
      <svg className="chart sensor-chart annual-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Annual daytime naive sensor splice versus harmonized activity; instrument transition at 2012">
        {[0,.5,1].map(f => <g key={f}><line className="gridline chart-grid" x1={L} x2={W-R} y1={y(max*f)} y2={y(max*f)} /><text className="tick" x={L-8} y={y(max*f)+4} textAnchor="end">{new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(max*f)}</text></g>)}
        <text className="axis-title" x={(L+W-R)/2} y={H-6} textAnchor="middle">Year (UTC)</text><text className="axis-title" transform={`translate(13 ${(T+H-B)/2}) rotate(-90)`} textAnchor="middle">Active cell-days per year</text>
        {ticks.map(r => <text className="tick" key={r.year} x={x(r.year)} y={H-B+18} textAnchor={r.year === first ? 'start' : r.year === last ? 'end' : 'middle'}>{r.year}</text>)}
        {SERIES.map(([metric, name, color]) => <g key={metric}>{metric === 'naive_splice' ? <><path className="annual-naive_splice" d={path(metric, r => r.year < 2012)} fill="none" stroke={COLORS.modis} strokeWidth="2"/><path className="annual-naive_splice" d={path(metric, r => r.year >= 2012)} fill="none" stroke={COLORS.viirs} strokeWidth="2"/></> : <path className={`annual-${metric}`} d={path(metric)} fill="none" stroke={color} strokeWidth="2.25" strokeDasharray="6 3"/>}{rows.filter(r => r[metric] != null).map(r => {
          const info = provenance(r.year, metric), estimated = metric === 'harmonized' && info.estimated;
          const label = `${r.year} · ${name}: ${fmt(r[metric])} active cell-days · ${info.label}`;
          return <g key={r.year} className="annual-point" data-year={r.year} data-series={metric} tabIndex="0" role="img" aria-label={label} transform={`translate(${x(r.year)},${y(r[metric])})`}><title>{label}</title>
            {metric === 'harmonized' && !info.known ? <rect x="-3" y="-3" width="6" height="6" fill="none" stroke={color}/> : estimated ? <path d="M0,-4 L4,0 L0,4 L-4,0 Z" fill="#fff" stroke={color} strokeWidth="1.5"/> : <circle r="3" fill={metric === 'naive_splice' ? (r.year < 2012 ? COLORS.modis : COLORS.viirs) : color}/>}
            {r.gap_flag && <circle r="6" fill="none" stroke={color}/>}
            {info.incomplete && <text className="annual-incomplete" x="7" y="-7">!</text>}
          </g>;
        })}</g>)}
        {first <= 2012 && last >= 2012 && <g className="viirs-marker annual-join"><line x1={x(2012)} x2={x(2012)} y1={T-8} y2={H-B}/><text x={Math.min(x(2012)+8,W-178)} y="20">2012: instrument transition</text></g>}
      </svg>
      <p className="annual-provenance-key">Harmonized markers: filled circle, observed VIIRS months only; open diamond, includes MODIS-based estimates; square, provenance unavailable; ring, includes gap-flagged months; !, incomplete observations. Hover or focus a point for its provenance.</p>
      <p className="figure-caption"><span><b>Source</b> /area-summary for the selected bounding box (harmonized Parquet, daytime)</span><span><b>Period</b> {first}–{last}, complete years only</span></p>
      {monthlyError && <p className="field-error">Monthly provenance unavailable: {monthlyError}</p>}
      <details className="annual-details"><summary>Annual values and provenance</summary><div className="validation-table"><table><thead><tr><th>Year</th><th>Naive splice</th><th>Harmonized</th><th>Harmonized provenance</th></tr></thead><tbody>{rows.map(r => <tr key={r.year}><th>{r.year}{r.gap_flag ? ' △' : ''}{r.harmonized == null && r.naive_splice == null ? ' · Not plotted' : ''}</th><td>{fmt(r.naive_splice)}</td><td>{fmt(r.harmonized)}</td><td>{provenance(r.year).label}</td></tr>)}</tbody></table></div></details>
      <details className="monthly-interval-details"><summary>Monthly estimate intervals and quality flags</summary>
        <p className="footnote">{monthly?.interval?.note || 'Prediction interval metadata unavailable.'} These are monthly bounds, not an annual confidence band. The full monthly record includes the partial latest year.</p>
        {estimatedMonths.length ? <div className="validation-table"><table><thead><tr><th>Month</th><th>Harmonized</th><th>Lower bound</th><th>Upper bound</th><th>Provenance / quality</th></tr></thead><tbody>{estimatedMonths.map(row => <tr key={`${row.year}-${row.month}`}><th>{row.year}-{String(row.month).padStart(2, '0')}</th><td>{fmt(row.harmonized)}</td><td>{fmt(row.lo80)}</td><td>{fmt(row.hi80)}</td><td>{qualityLabel(row)}</td></tr>)}</tbody></table></div> : <p className="footnote">No monthly estimates available.</p>}
        <p className="footnote">All values in active cell-days. Nominal interval: {monthly?.interval?.nominal_coverage == null ? 'unreported' : `${100 * monthly.interval.nominal_coverage}%`}. Measured coverage and regional limitations are reported below.</p>
      </details>
    </>}
    <p className="footnote">Naive splice uses raw MODIS through 2011, then raw VIIRS from 2012. The marker identifies the sensor transition; year-to-year changes alone do not isolate a sensor effect. Harmonized values use observed VIIRS or MODIS-based back-cast and gap-fill estimates on the VIIRS scale, never the sum of both sensors.</p>
    <p className="footnote">Years need 12 available months for each series; the partial latest year is not plotted. Flagged months are retained. This daytime comparison is independent of the acquisition filter and displayed date window.</p>
  </section>;
}
