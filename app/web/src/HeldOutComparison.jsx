import { useEffect, useRef, useState } from 'react';
import Figure, { SERIES } from './Figure.jsx';
const fmt = value => value == null ? 'Unavailable' : value.toLocaleString('en', { maximumFractionDigits: 1 });
const monthKey = row => `${row.year}-${String(row.month).padStart(2, '0')}`;
const LINES = [['actual_viirs', 'Observed VIIRS', SERIES.viirs], ['model_b', 'Model B prediction', SERIES.harmonized]];

export default function HeldOutComparison({ series }) {
  const container = useRef(null), [width, setWidth] = useState(900), [selected, setSelected] = useState(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, entry.contentRect.width)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const rows = series?.status === 'ready' ? series.data || [] : [];
  const band = series?.interval?.status === 'ready';
  const index = Math.min(selected ?? rows.length - 1, rows.length - 1), active = rows[index];
  const W = width, H = 260, L = 60, R = 12, T = 14, B = 46;
  const maximum = Math.max(1, ...rows.flatMap(row => [row.actual_viirs, row.model_b, band ? row.hi80 : 0]).filter(Number.isFinite));
  const x = i => L + i / Math.max(1, rows.length - 1) * (W - L - R);
  const y = value => H - B - value / maximum * (H - T - B);
  const path = metric => {
    let previous = false;
    return rows.map((row, i) => {
      if (!row.included || row[metric] == null) { previous = false; return ''; }
      const segment = `${previous ? 'L' : 'M'}${x(i)},${y(row[metric])}`;
      previous = true; return segment;
    }).join(' ');
  };
  const area = band ? `${rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(r.hi80)}`).join(' ')} ${[...rows].reverse().map((r, j) => `L${x(rows.length - 1 - j)},${y(r.lo80)}`).join(' ')} Z` : '';
  const hover = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    setSelected(Math.max(0, Math.min(rows.length - 1, Math.round(((event.clientX - rect.left) / rect.width * W - L) / (W - L - R) * (rows.length - 1)))));
  };
  const outside = rows.filter(r => r.included && r.inside_interval === false);
  return <section ref={container} className="held-out-comparison" aria-labelledby="held-out-title">
    <div className="figure-head"><span className="figure-number">Figure 3</span><h3 id="held-out-title" className="figure-title">Predictions against held-out observations</h3></div>
    {!rows.length ? <p className="muted" role="status">{series?.message || 'Saved held-out predictions are not available.'}</p> : <>
      <p className="held-out-scope">All Argentina · {rows[0].year}–{rows.at(-1).year} · National daytime active cell-days. This validation does not change with the selected study area.</p>
      <div className="chart-key">{LINES.map(([key, label, color]) => <span key={key}><i className={`key-line${key === 'model_b' ? ' key-dashed' : ''}`} style={key === 'model_b' ? undefined : { background: color }}/>{label}{key === 'model_b' && ' (from MODIS)'}</span>)}
        {band && <span><i className="key-band"/>80% prediction interval</span>}{band && <span><i className="key-marker outside"/>Observed outside interval</span>}<span><i className="key-marker excluded"/>Excluded month</span></div>
      <svg className="chart sensor-chart held-out-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="National held-out VIIRS observations and Model B monthly predictions in active cell-days" onPointerMove={hover} onPointerDown={hover}>
        {[0, .5, 1].map(f => <g key={f}><line className="gridline chart-grid" x1={L} x2={W - R} y1={y(maximum * f)} y2={y(maximum * f)}/><text className="tick" x={L - 7} y={y(maximum * f) + 4} textAnchor="end">{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(maximum * f)}</text></g>)}
        {rows.map((row, i) => row.month === 1 && (width > 600 || row.year % 2 === 0) && <g key={i}><line className="axis-line" x1={x(i)} x2={x(i)} y1={H - B} y2={H - B + 4}/><text className="tick" x={x(i)} y={H - B + 18} textAnchor={i === 0 ? 'start' : 'middle'}>{row.year}</text></g>)}
        <text className="axis-title" x={(L + W - R) / 2} y={H - 6} textAnchor="middle">Month (UTC)</text>
        <text className="axis-title" transform={`translate(13 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle">Active cell-days</text>
        {band && <path className="interval-area" d={area}/>}
        {LINES.map(([key, label, color]) => <g key={key}><path className={`held-out-line ${key}`} d={path(key)} fill="none" stroke={color} strokeWidth="1.8" strokeDasharray={key === 'model_b' ? '5 3' : undefined}/>
          {rows.map((row, i) => !row.included && row[key] != null && <circle key={i} className="held-out-excluded" cx={x(i)} cy={y(row[key])} r="3" fill="none" stroke={SERIES.muted}><title>{monthKey(row)} · {label}: {fmt(row[key])} · Excluded from validation{row.gap_flag ? ' · Sensor gap flagged' : ''}{!row.complete ? ' · Incomplete observations' : ''}</title></circle>)}
          {active?.[key] != null && <circle cx={x(index)} cy={y(active[key])} r="3.5" fill={active.included ? color : SERIES.muted}/>}
        </g>)}
        {outside.map(row => { const i = rows.indexOf(row); return <path key={`o${i}`} className="outside-marker" d={`M${x(i)},${y(row.actual_viirs) - 5} L${x(i) + 4.5},${y(row.actual_viirs) + 3} L${x(i) - 4.5},${y(row.actual_viirs) + 3} Z`}><title>{monthKey(row)}: observed outside the 80% interval</title></path>; })}
        {active && <line className="chart-cursor" data-month={monthKey(active)} x1={x(index)} x2={x(index)} y1={T} y2={H - B}/>}
      </svg>
      <p className="footnote">Lines show the {rows.filter(row => row.included).length} months used for validation. Grey rings mark excluded months; gaps are not zeros. Predictions are model estimates, not observed VIIRS or the harmonized splice.{band && ` ${series.interval.months_inside} of ${series.interval.months_scored} scored months fall inside the 80% band; triangles mark the ${outside.length} that do not.`}</p>
      <label className="held-out-slider">Inspect validation month<input type="range" aria-label="Inspect validation month" min="0" max={rows.length - 1} value={index} onChange={event => setSelected(Number(event.target.value))}/></label>
      {active && <p className="held-out-values" aria-live="polite"><strong>{monthKey(active)}</strong> · Observed VIIRS: <strong data-metric="actual_viirs">{fmt(active.actual_viirs)}</strong> · Model B estimate: <strong data-metric="model_b">{fmt(active.model_b)}</strong> active cell-days{band && active.lo80 != null && <> · 80% interval {fmt(active.lo80)}–{fmt(active.hi80)}</>} · {active.included ? 'Included in validation' : 'Excluded from validation'}{active.gap_flag && ' · Sensor gap flagged'}{!active.complete && ' · Incomplete observations'}</p>}
      <p className="figure-caption"><span><b>Source</b> {series.source}{band ? '; interval rebuilt from the leave-one-year-out quantiles in out/validation.json and checked against the reported coverage' : ''}</span><span><b>Period</b> {rows[0].year}-01 to {rows.at(-1).year}-12, held-out years</span></p>
    </>}
  </section>;
}
