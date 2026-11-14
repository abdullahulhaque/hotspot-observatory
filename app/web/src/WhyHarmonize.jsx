import { useEffect, useRef, useState } from 'react';
const fmt = n => n == null ? 'Unavailable' : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(n);
const SERIES = [['naive_splice', 'Naive splice', '#78c5d5'], ['harmonized', 'Harmonized', '#d59ced']];
export default function WhyHarmonize({ data, loading, error, compact = false }) {
  const container = useRef(null), [width, setWidth] = useState(800);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(360, Math.min(compact ? 1400 : 800, entry.contentRect.width))));
    observer.observe(container.current); return () => observer.disconnect();
  }, [compact]);
  const rows = data?.annual_daytime || [], W = width, H = compact ? 195 : 270, L = 58, R = 20, T = 42, B = 35;
  const first = rows[0]?.year || 2003, last = rows.at(-1)?.year || 2025;
  const x = year => L + (year-first)/Math.max(1,last-first)*(W-L-R);
  const max = Math.max(1, ...rows.flatMap(r => [r.naive_splice || 0, r.harmonized || 0]));
  const y = value => H-B-value/max*(H-T-B);
  const ticks = rows.filter((r, i) => i === 0 || i === rows.length-1 || r.year % (width < 500 ? 10 : 5) === 0 && r.year-first > 2 && last-r.year > 2);
  function path(metric) {
    let previous = false;
    return rows.map(row => {
      if (row[metric] == null) { previous = false; return ''; }
      const segment = `${previous ? 'L' : 'M'}${x(row.year)},${y(row[metric])}`;
      previous = true; return segment;
    }).join(' ');
  }
  return <section ref={container} className="sensor-panel why-panel" aria-label="Why harmonize?">
    {!compact && <><div className="eyebrow">A CONSISTENT MEASURING STICK</div><h2>Why harmonize?</h2></>}
    <p className="muted">Annual daytime totals · selected area · full record · active cell-days</p>
    <div className="chart-legend">{SERIES.map(([metric, name, color]) => <span key={metric}><i style={{ background: color }} />{name}</span>)}</div>
    {error ? <p className="field-error">{error}</p> : loading ? <div className="empty">Loading annual comparison…</div> : !data?.has_data ? <div className="empty">No data in this area</div> : !rows.some(r => r.harmonized != null || r.naive_splice != null) ? <div className="empty">No complete years available.</div> : <>
      <svg className="sensor-chart annual-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Annual daytime naive sensor splice versus harmonized activity, with an artificial sensor jump at 2012">
        {[0,.5,1].map(f => <g key={f}><line className="chart-grid" x1={L} x2={W-R} y1={y(max*f)} y2={y(max*f)} /><text x={L-8} y={y(max*f)+4} textAnchor="end">{new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(max*f)}</text></g>)}
        {ticks.map(r => <text key={r.year} x={x(r.year)} y={H-10} textAnchor={r.year === first ? 'start' : r.year === last ? 'end' : 'middle'}>{r.year}</text>)}
        {SERIES.map(([metric, name, color]) => <g key={metric}><path className={`annual-${metric}`} d={path(metric)} fill="none" stroke={color} strokeWidth="2" strokeDasharray={metric === 'harmonized' ? '6 3' : undefined}/>{rows.filter(r => r[metric] != null).map(r => <circle key={r.year} cx={x(r.year)} cy={y(r[metric])} r="3" fill={color}><title>{r.year} · {name}: {fmt(r[metric])} active cell-days{r.gap_flag ? ' · Includes flagged months' : ''}</title></circle>)}</g>)}
        {first <= 2012 && last >= 2012 && <g className="viirs-marker annual-join"><line x1={x(2012)} x2={x(2012)} y1={T-8} y2={H-B}/><text x={Math.min(x(2012)+8,W-178)} y="20">2012: artificial sensor jump</text></g>}
      </svg>
      <details className="annual-details"><summary>Annual values</summary><div className="validation-table"><table><thead><tr><th>Year</th><th>Naive splice</th><th>Harmonized</th></tr></thead><tbody>{rows.map(r => <tr key={r.year}><th>{r.year}{r.gap_flag ? ' △' : ''}</th><td>{fmt(r.naive_splice)}</td><td>{fmt(r.harmonized)}</td></tr>)}</tbody></table></div></details>
    </>}
    <p className="footnote">Naive splice uses raw MODIS through 2011, then raw VIIRS from 2012. Switching sensor sensitivity introduces an artificial discontinuity; the year-to-year change also includes real activity variation. Harmonization puts both eras on the VIIRS scale.</p>
    <p className="footnote">Years need 12 available months for each series; the partial latest year is not plotted. Flagged months are retained. This daytime comparison is independent of the acquisition filter and displayed date window.</p>
  </section>;
}
