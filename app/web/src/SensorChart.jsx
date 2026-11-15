import { qualityLabel } from './provenance.js';
import { useEffect, useRef, useState } from 'react';
export const monthKey = row => `${row.year}-${String(row.month).padStart(2, '0')}`;
const fmt = value => value == null ? 'Unavailable' : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
const LABELS = { raw_modis: 'Raw MODIS Aqua', raw_viirs: 'Raw VIIRS S-NPP' };
const COLORS = { raw_modis: '#79b3b2', raw_viirs: '#cbb278' };

export default function SensorChart({ series, loading, error, metric, maximum, hoveredMonth, onHover, period = 'D' }) {
  const container = useRef(null), [width, setWidth] = useState(600);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(220, Math.min(700, entry.contentRect.width))));
    observer.observe(container.current); return () => observer.disconnect();
  }, []);
  const rows = series?.data || [], W = width, H = 190, L = 40, R = 12, T = 12, B = 27;
  const activeIndex = Math.max(0, rows.findIndex(row => monthKey(row) === hoveredMonth));
  const active = rows[activeIndex];
  const x = index => L + index / Math.max(1, rows.length-1) * (W-L-R);
  const y = value => H-B-value/Math.max(1, maximum)*(H-T-B);
  let previous = false;
  const path = rows.map((row, i) => {
    if (row[metric] == null) { previous = false; return ''; }
    const segment = `${previous ? 'L' : 'M'}${x(i)},${y(row[metric])}`;
    previous = true; return segment;
  }).join(' ');
  const hover = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = (event.clientX-rect.left)/rect.width*W;
    const index = Math.max(0, Math.min(rows.length-1, Math.round((svgX-L)/(W-L-R)*(rows.length-1))));
    if (rows[index]) onHover(monthKey(rows[index]));
  };
  return <section ref={container} className="raw-chart-card" aria-label={LABELS[metric]}>
    <h3><i style={{ background: COLORS[metric] }}/>{LABELS[metric]}</h3>
    {loading ? <div className="raw-empty">Loading {period === 'D' ? 'daytime' : 'nighttime'} activity…</div> : error ? <div className="raw-empty field-error">{error}</div> : series?.has_data === false ? <div className="raw-empty">No data in this area</div> : !rows.length ? <div className="raw-empty">No monthly data available</div> : <>
      <svg className="sensor-chart raw-chart" data-y-max={maximum} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${LABELS[metric]}, monthly ${period === 'D' ? 'daytime' : 'nighttime'} active cell-days`} onPointerMove={hover} onPointerDown={hover}>
        {[0,.5,1].map(f => <g key={f}><line className="chart-grid" x1={L} x2={W-R} y1={y(maximum*f)} y2={y(maximum*f)} /><text className="raw-y-tick" x={L-7} y={y(maximum*f)+4} textAnchor="end">{new Intl.NumberFormat('en', { notation:'compact', maximumFractionDigits:1 }).format(maximum*f)}</text></g>)}
        {rows.map((row,i) => (i===0 || i===rows.length-1 || row.month===1 && row.year%10===0 && i>24 && rows.length-i>24) && <text key={i} x={x(i)} y={H-6} textAnchor={i===0 ? 'start' : i===rows.length-1 ? 'end' : 'middle'}>{row.year}</text>)}
        <path className={`raw-line ${metric}`} d={path} fill="none" stroke={COLORS[metric]} strokeWidth="1.6"/>
        {rows.map((row,i) => row[metric] != null && (row.incomplete_metrics?.includes(metric) || row.nrt || row.gap_flag) && <g key={`quality-${i}`}><title>{monthKey(row)}: {qualityLabel(row, metric)}</title><circle cx={x(i)} cy={y(row[metric])} r={row.incomplete_metrics?.includes(metric) ? 3 : 2} fill={row.incomplete_metrics?.includes(metric) ? '#fa987b' : row.nrt ? '#d3b8ff' : 'none'} stroke={row.gap_flag ? '#fff' : 'none'}/></g>)}
        {active && <><line className="chart-cursor" data-month={monthKey(active)} x1={x(activeIndex)} x2={x(activeIndex)} y1={T} y2={H-B}/>{active[metric] != null && <circle cx={x(activeIndex)} cy={y(active[metric])} r="3" fill={COLORS[metric]}/>}</>}
      </svg>
      <p className="raw-quality-key footnote">● Orange: incomplete · Purple: NRT · Ring: gap flagged</p>
      <div className="raw-hover" aria-live="polite"><span>{active && monthKey(active)}</span><strong>{fmt(active?.[metric])}</strong><span>active cell-days</span><span>{active?.[metric] != null && 'Observed'}{qualityLabel(active, metric) && ` · ${qualityLabel(active, metric)}`}</span></div>
    </>}
  </section>;
}
