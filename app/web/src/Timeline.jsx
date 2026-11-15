import { useEffect, useRef, useState } from 'react';
import { fmtNumber } from './Figure.jsx';

const key = row => `${row.year}-${String(row.month).padStart(2, '0')}`;
const LABEL = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const name = month => LABEL.format(new Date(`${month}-01T00:00:00Z`));

// Monthly series for the study area; the selected month drives the map and inspector.
// Operable with pointer (click or drag) and keyboard (arrows, PageUp/PageDown = ±1 year, Home/End).
export default function Timeline({ rows, metric, metricLabel, selected, onSelect, loading, regionName, periodName }) {
  const ref = useRef(null), [width, setWidth] = useState(800), dragging = useRef(false);
  useEffect(() => { const o = new ResizeObserver(([e]) => setWidth(Math.max(260, e.contentRect.width))); o.observe(ref.current); return () => o.disconnect(); }, []);
  const W = width, H = 104, L = 52, R = 12, T = 8, B = 24;
  const max = Math.max(1, ...rows.map(r => r[metric] ?? 0));
  const step = (W - L - R) / Math.max(1, rows.length);
  const index = rows.findIndex(r => key(r) === selected);
  const y = v => H - B - v / max * (H - T - B);
  const pick = clientX => {
    const rect = ref.current.querySelector('svg').getBoundingClientRect();
    const i = Math.max(0, Math.min(rows.length - 1, Math.floor(((clientX - rect.left) / rect.width * W - L) / step)));
    if (rows[i]) onSelect(key(rows[i]));
  };
  const move = delta => { if (!rows.length) return; const i = Math.max(0, Math.min(rows.length - 1, (index < 0 ? rows.length - 1 : index) + delta)); onSelect(key(rows[i])); };
  const onKeyDown = event => {
    const actions = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1, PageDown: -12, PageUp: 12 };
    if (event.key in actions) { event.preventDefault(); move(actions[event.key]); }
    else if (event.key === 'Home') { event.preventDefault(); move(-rows.length); }
    else if (event.key === 'End') { event.preventDefault(); move(rows.length); }
  };
  const years = rows.filter(r => r.month === 1 && (r.year % (width < 600 ? 10 : 5) === 0));
  const active = rows[index];
  return <div className="timeline" ref={ref}>
    <div className="timeline-head">
      <span className="timeline-title">{metricLabel} active cell-days per month · {regionName} · {periodName}</span>
      <span className="timeline-controls">
        <button className="icon-button" aria-label="Previous month" onClick={() => move(-1)} disabled={index <= 0}>‹</button>
        <strong className="timeline-month">{selected ? name(selected) : '—'}</strong>
        <button className="icon-button" aria-label="Next month" onClick={() => move(1)} disabled={index < 0 || index >= rows.length - 1}>›</button>
      </span>
    </div>
    {loading ? <div className="timeline-empty">Loading monthly series…</div> : !rows.length ? <div className="timeline-empty">No months in the selected window.</div> :
      <div className="timeline-track" role="slider" tabIndex="0" aria-label="Selected month" aria-valuemin={0} aria-valuemax={rows.length - 1} aria-valuenow={Math.max(0, index)}
        aria-valuetext={active ? `${name(selected)}: ${active[metric] == null ? 'unavailable' : `${fmtNumber(active[metric])} active cell-days`}` : 'none'} onKeyDown={onKeyDown}
        onPointerDown={event => { dragging.current = true; event.currentTarget.setPointerCapture?.(event.pointerId); pick(event.clientX); }}
        onPointerMove={event => { if (dragging.current) pick(event.clientX); }} onPointerUp={() => { dragging.current = false; }}>
        <svg className="chart timeline-chart" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <line className="gridline" x1={L} x2={W - R} y1={y(max)} y2={y(max)}/>
          <text className="tick" x={L - 6} y={y(max) + 4} textAnchor="end">{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(max)}</text>
          <text className="tick" x={L - 6} y={H - B + 4} textAnchor="end">0</text>
          <line className="axis-line" x1={L} x2={W - R} y1={H - B} y2={H - B}/>
          {rows.map((r, i) => {
            const v = r[metric], x = L + i * step;
            if (v == null) return <rect key={key(r)} className="timeline-missing" x={x} y={H - B - 3} width={Math.max(1, step - .5)} height="3"/>;
            const estimate = metric === 'harmonized' && r.source !== 'observed';
            const incomplete = r.incomplete_metrics?.includes(metric);
            return <rect key={key(r)} className={`timeline-bar${estimate ? ' estimate' : ''}${incomplete ? ' incomplete' : ''}`} x={x} y={y(v)} width={Math.max(1, step - .5)} height={Math.max(.5, H - B - y(v))}/>;
          })}
          {years.map(r => { const i = rows.indexOf(r); return <text className="tick" key={r.year} x={L + i * step} y={H - 6} textAnchor="middle">{r.year}</text>; })}
          {index >= 0 && <g className="timeline-cursor"><line x1={L + (index + .5) * step} x2={L + (index + .5) * step} y1={T - 4} y2={H - B}/><circle cx={L + (index + .5) * step} cy={active?.[metric] != null ? y(active[metric]) : H - B} r="4"/></g>}
        </svg>
      </div>}
    <div className="timeline-key"><span><i className="swatch observed"/>Observed</span>{metric === 'harmonized' && <span><i className="swatch estimate"/>Model estimate (back-cast or gap-fill)</span>}<span><i className="swatch incomplete"/>Incomplete observations</span><span><i className="swatch missing"/>Unavailable</span><span className="timeline-hint">Click or drag to choose a month · arrow keys step · Page Up/Down ±1 year</span></div>
  </div>;
}
