import { useEffect, useRef, useState } from 'react';
const fmt = value => value == null ? 'Unavailable' : value.toLocaleString('en', { maximumFractionDigits: 1 });
const monthKey = row => `${row.year}-${String(row.month).padStart(2, '0')}`;
const SERIES = [['actual_viirs', 'Observed VIIRS', '#79b3b2'], ['model_b', 'Model B prediction', '#cbb278']];

export default function HeldOutComparison({ series }) {
  const container = useRef(null), [width, setWidth] = useState(900), [selected, setSelected] = useState(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(220, entry.contentRect.width)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const rows = series?.status === 'ready' ? series.data || [] : [];
  const index = Math.min(selected ?? rows.length - 1, rows.length - 1), active = rows[index];
  const W = width, H = 220, L = 48, R = 12, T = 14, B = 30;
  const maximum = Math.max(1, ...rows.flatMap(row => [row.actual_viirs, row.model_b]).filter(Number.isFinite));
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
  const hover = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    setSelected(Math.max(0, Math.min(rows.length - 1, Math.round(((event.clientX - rect.left) / rect.width * W - L) / (W - L - R) * (rows.length - 1)))));
  };
  return <section ref={container} className="held-out-comparison" aria-labelledby="held-out-title">
    <h3 id="held-out-title">Predictions against held-out observations</h3>
    {!rows.length ? <p className="muted" role="status">{series?.message || 'Saved held-out predictions are not available.'}</p> : <>
      <p className="held-out-scope">All Argentina · {rows[0].year}–{rows.at(-1).year} · National daytime active cell-days. This validation does not change with the selected study area.</p>
      <div className="chart-legend">{SERIES.map(([key, label, color]) => <span key={key}><i style={{ background: color }}/>{label}{key === 'model_b' && ' (MODIS-based)'}</span>)}</div>
      <svg className="sensor-chart held-out-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="National held-out VIIRS observations and Model B monthly predictions in active cell-days" onPointerMove={hover} onPointerDown={hover}>
        {[0, .5, 1].map(f => <g key={f}><line className="chart-grid" x1={L} x2={W - R} y1={y(maximum * f)} y2={y(maximum * f)}/><text x={L - 7} y={y(maximum * f) + 4} textAnchor="end">{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(maximum * f)}</text></g>)}
        {rows.map((row, i) => (i === 0 || i === rows.length - 1 || row.month === 1 && i > 12 && rows.length - i > 12 && (width > 600 || i === 36)) && <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}>{row.year}</text>)}
        {SERIES.map(([key, label, color]) => <g key={key}><path className={`held-out-line ${key}`} d={path(key)} fill="none" stroke={color} strokeWidth="1.6" strokeDasharray={key === 'model_b' ? '5 3' : undefined}/>
          {rows.map((row, i) => !row.included && row[key] != null && <circle key={i} className="held-out-excluded" cx={x(i)} cy={y(row[key])} r="3" fill="none" stroke="#9ba8b2"><title>{monthKey(row)} · {label}: {fmt(row[key])} · Excluded from validation{row.gap_flag ? ' · Sensor gap flagged' : ''}{!row.complete ? ' · Incomplete observations' : ''}</title></circle>)}
          {active?.[key] != null && <circle cx={x(index)} cy={y(active[key])} r="3" fill={active.included ? color : '#9ba8b2'}/>}
        </g>)}
        {active && <line className="chart-cursor" data-month={monthKey(active)} x1={x(index)} x2={x(index)} y1={T} y2={H - B}/>}
      </svg>
      <p className="footnote">Lines show the {rows.filter(row => row.included).length} months used for validation. Grey rings mark excluded months; gaps are not zeros. Predictions are model estimates, not observed VIIRS or the harmonized splice.</p>
      <label className="held-out-slider">Inspect validation month<input type="range" aria-label="Inspect validation month" min="0" max={rows.length - 1} value={index} onChange={event => setSelected(Number(event.target.value))}/></label>
      {active && <p className="held-out-values" aria-live="polite"><strong>{monthKey(active)}</strong> · Observed VIIRS: <strong data-metric="actual_viirs">{fmt(active.actual_viirs)}</strong> · Model B estimate: <strong data-metric="model_b">{fmt(active.model_b)}</strong> active cell-days · {active.included ? 'Included in validation' : 'Excluded from validation'}{active.gap_flag && ' · Sensor gap flagged'}{!active.complete && ' · Incomplete observations'}</p>}
    </>}
  </section>;
}
