import { useEffect, useRef, useState } from 'react';
const COLORS = { raw_modis: '#78c5d5', raw_viirs: '#f2c46e', harmonized: '#d59ced' };
const LABELS = { raw_modis: 'Raw MODIS', raw_viirs: 'Raw VIIRS', harmonized: 'Harmonized' };
const key = row => `${row.year}-${String(row.month).padStart(2, '0')}`;
const fmt = value => value == null ? 'Unavailable' : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
const ordinal = row => row.year * 12 + row.month - 1;
function segments(rows, valid) {
  const result = []; let part = [];
  for (const row of rows) {
    if (valid(row)) part.push(row);
    else if (part.length) { result.push(part); part = []; }
  }
  if (part.length) result.push(part);
  return result;
}

export default function SensorChart({ series, loading, selected, onSelect, period }) {
  const container = useRef(null), [width, setWidth] = useState(800);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(360, Math.min(800, entry.contentRect.width))));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const rows = series?.data || [];
  const noData = series?.has_data === false;
  const hasValues = rows.some(r => Object.keys(COLORS).some(metric => r[metric] != null));
  const W = width, H = 280, L = 56, R = 20, T = 36, B = 38;
  const first = rows.length ? ordinal(rows[0]) : 0, last = rows.length ? ordinal(rows.at(-1)) : 1;
  const x = row => L + (ordinal(row) - first) / Math.max(1, last - first) * (W - L - R);
  const maximum = Math.max(1, ...rows.flatMap(r => [r.raw_modis || 0, r.raw_viirs || 0, r.harmonized || 0, r.hi80 || 0]));
  const y = value => H - B - value / maximum * (H - T - B);
  const marker = x({ year: 2012, month: 1 });
  const activeIndex = Math.max(0, rows.findIndex(r => key(r) === selected));
  const active = rows[activeIndex];
  const band = ['backcast', 'gapfill'].flatMap(source => segments(rows, r => r.source === source && r.lo80 != null && r.hi80 != null));
  const ticks = [...new Set([first, ...rows.filter(r => r.month === 1 && r.year % (width < 500 ? 10 : 5) === 0 && ordinal(r)-first > (last-first)*.1 && last-ordinal(r) > (last-first)*.1).map(ordinal), last])];
  return <section ref={container} className="sensor-panel" aria-label="Sensor comparison">
    <div className="eyebrow">ONE AREA · THREE SERIES</div><h2>Sensor comparison</h2>
    <p className="muted">Monthly active cell-days · {period === 'D' ? 'Daytime' : 'Nighttime'}</p>
    <div className="chart-legend">{Object.entries(LABELS).map(([metric, label]) => <span key={metric}><i style={{ background: COLORS[metric] }} />{label}</span>)}<span><i className="band-key" />80% model band</span></div>
    <div className="chart-legend source-legend"><span>• Back-cast month</span><span>◆ Gap-filled month</span><span>△ Sensor gap flagged</span></div>
    {loading ? <div className="empty">Loading sensor comparison…</div> : noData ? <div className="empty">No data in this area</div> : !hasValues ? <div className="empty">No data in this date range</div> : <>
      <svg className="sensor-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly raw MODIS, raw VIIRS and harmonized activity in active cell-days, with 80% model intervals; dots mark back-casts, diamonds gap-fills, and triangles sensor gaps">
        <title>Sensor comparison, {rows[0] && key(rows[0])} to {rows.at(-1) && key(rows.at(-1))}</title>
        {[0, .25, .5, .75, 1].map(f => <g key={f}><line x1={L} x2={W-R} y1={y(maximum*f)} y2={y(maximum*f)} className="chart-grid" /><text x={L-9} y={y(maximum*f)+4} textAnchor="end">{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(maximum*f)}</text></g>)}
        {ticks.map(t => <text key={t} x={L+(t-first)/Math.max(1,last-first)*(W-L-R)} y={H-12} textAnchor={t === first ? 'start' : t === last ? 'end' : 'middle'}>{Math.floor(t/12)}</text>)}
        {band.map((part, i) => part.length === 1 ? <rect key={i} className={`interval-band ${part[0].source}-band`} x={x(part[0])-3} y={y(part[0].hi80)} width="6" height={y(part[0].lo80)-y(part[0].hi80)} /> : <path key={i} className={`interval-band ${part[0].source}-band`} d={`M${part.map(r => `${x(r)},${y(r.hi80)}`).join(' L')} L${[...part].reverse().map(r => `${x(r)},${y(r.lo80)}`).join(' L')} Z`} />)}
        {Object.keys(COLORS).map(metric => <g key={metric}>{segments(rows, r => r[metric] != null).map((part, i) => part.length === 1 ? <circle key={i} cx={x(part[0])} cy={y(part[0][metric])} r="3" fill={COLORS[metric]} /> : <path key={i} d={`M${part.map(r => `${x(r)},${y(r[metric])}`).join(' L')}`} fill="none" stroke={COLORS[metric]} strokeWidth="1.8" strokeDasharray={metric === 'harmonized' ? '6 3' : undefined} />)}</g>)}
        {rows.map(row => <g key={key(row)}>
          {row.harmonized != null && row.source === 'backcast' && <circle className="chart-backcast" data-month={key(row)} cx={x(row)} cy={y(row.harmonized)} r="2.2"><title>{key(row)}: back-cast · {fmt(row.harmonized)} active cell-days</title></circle>}
          {row.harmonized != null && row.source === 'gapfill' && <path className="chart-gapfill" data-month={key(row)} d={`M${x(row)},${y(row.harmonized)-5} l5,5 l-5,5 l-5,-5 Z`}><title>{key(row)}: gap-filled · {fmt(row.harmonized)} active cell-days</title></path>}
          {row.gap_flag && <path className="chart-gap-flag" data-month={key(row)} d={`M${x(row)},${H-B+4} l4,7 h-8 Z`}><title>{key(row)}: sensor gap flagged</title></path>}
        </g>)}
        {marker >= L && marker <= W-R && <g className="viirs-marker"><line x1={marker} x2={marker} y1={T-6} y2={H-B} /><text x={Math.min(marker+8, W-168)} y={20}>VIIRS record begins</text><text x={marker+6} y={H-B-6}>2012</text></g>}
        {active && <line className="chart-cursor" x1={x(active)} x2={x(active)} y1={T} y2={H-B} />}
      </svg>
      <label className="chart-slider">Inspect month: {active && key(active)}<input aria-label="Inspect chart month" type="range" min="0" max={rows.length-1} value={activeIndex} onChange={e => onSelect(key(rows[Number(e.target.value)]))} /></label>
      {active && <div className="chart-values" aria-live="polite">{Object.entries(LABELS).map(([metric, label]) => <span key={metric}><b style={{ color: COLORS[metric] }}>{label}</b> {fmt(active[metric])}</span>)}<span>active cell-days</span>{active.gap_flag && <strong>△ Sensor gap flagged</strong>}{active.source === 'gapfill' && <strong>◆ Gap-filled month</strong>}{active.source === 'backcast' && <span>• Back-cast month</span>}{active.lo80 != null && <span>80% interval {fmt(active.lo80)}–{fmt(active.hi80)} active cell-days</span>}</div>}
    </>}
    <p className="footnote">VIIRS record begins in 2012. {period === 'N' ? 'Nighttime harmonized is unavailable before 2012; no night back-cast is produced.' : series?.interval?.note}{series?.interval?.synthetic && period === 'D' ? ' Band values are illustrative for synthetic data.' : ''}</p>
  </section>;
}
