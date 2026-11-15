import { useEffect, useState } from 'react';
import SensorChart, { monthKey } from './SensorChart.jsx';

function PixelFootprint({ sensor, cells, resolution, color }) {
  const size = 96, step = size / cells;
  return <svg className="pixel-footprint" viewBox="0 0 152 128" role="img" aria-label={`${sensor}: ${cells} by ${cells} nominal ${resolution} pixels over a conceptual 3 km by 3 km footprint, not measured NASA observations`}>
    <rect x="28" y="6" width={size} height={size} fill="none" stroke={color}/>
    {Array.from({ length: cells - 1 }, (_, i) => <g key={i} stroke={color} strokeWidth=".7">
      <line x1={28 + (i + 1) * step} x2={28 + (i + 1) * step} y1="6" y2="102"/>
      <line x1="28" x2="124" y1={6 + (i + 1) * step} y2={6 + (i + 1) * step}/>
    </g>)}
    <text x="76" y="120" textAnchor="middle">3 km × 3 km footprint</text>
  </svg>;
}

export default function SensorComparison({ daytime, loading, error, meta, bounds, regionName, retry, getJSON }) {
  const [period, setPeriod] = useState('D'), [hoveredMonth, setHoveredMonth] = useState('');
  const [night, setNight] = useState(null), [nightLoading, setNightLoading] = useState(false), [nightError, setNightError] = useState('');
  useEffect(() => {
    if (period !== 'N' || !meta?.start || !meta?.end) return;
    const controller = new AbortController();
    setNight(null); setNightLoading(true); setNightError('');
    const params = new URLSearchParams({ bbox: bounds.join(','), start: meta.start, end: meta.end, daynight: 'N' });
    getJSON(`/series?${params}`, controller.signal).then(setNight).catch(err => {
      if (err.name !== 'AbortError') setNightError(err.message);
    }).finally(() => { if (!controller.signal.aborted) setNightLoading(false); });
    return () => controller.abort();
  }, [period, meta, bounds, retry, getJSON]);
  const series = period === 'D' ? daytime : night;
  const rows = series?.data || [];
  const maximum = Math.max(1, ...rows.flatMap(row => [row.raw_modis, row.raw_viirs]).filter(value => value != null));
  const month = rows.some(row => monthKey(row) === hoveredMonth) ? hoveredMonth : rows.length ? monthKey(rows[rows.length - 1]) : '';
  const index = Math.max(0, rows.findIndex(row => monthKey(row) === month));
  return <>
    <div className="page-section-heading"><span>02</span><h2 id="satellites-title">Compare the Satellites</h2><p>Different instruments · shared study area</p></div>
    <div className="sensor-overview">
      {[['MODIS Aqua', 3, '≈ 1 km', '#79b3b2', meta?.start ? `${meta.start.slice(0, 4)} onward` : 'Loading…'], ['VIIRS S-NPP', 8, '≈ 375 m', '#cbb278', '2012 onward']].map(([name, cells, resolution, color, record]) => <article className="sensor-overview-card" key={name}>
        <h3 style={{ color }}>{name}</h3>
        <dl><dt>Nominal active-fire pixel resolution</dt><dd>{resolution}</dd><dt>Historical coverage in our dataset</dt><dd>{record}</dd></dl>
        <PixelFootprint sensor={name} cells={cells} resolution={resolution} color={color}/>
      </article>)}
    </div>
    <p className="pixel-caption">Conceptual nominal pixel comparison over the same geographic footprint; not measured NASA observations.</p>
    <p className="sensor-explanation">Resolution, detection sensitivity, and observation timing affect the number of hotspots each instrument reports.</p>
    <div className="sensor-observation-controls"><div><h3>Raw observations</h3><p>{regionName} · {meta?.start || '…'} to {meta?.end || '…'}</p></div><label>Observation period<select aria-label="Sensor observation period" value={period} onChange={event => setPeriod(event.target.value)}><option value="D">Daytime</option><option value="N">Nighttime</option></select></label></div>
    <p className="sensor-units">Monthly {period === 'D' ? 'daytime' : 'nighttime'} active cell-days · matching axes · missing observations are unavailable</p>
    {series?.synthetic && <p className="quality-notice" role="status">Synthetic development data — not NASA observations.</p>}
    <div className="raw-chart-pair">{['raw_modis', 'raw_viirs'].map(metric => <SensorChart key={metric} metric={metric} series={series} loading={period === 'D' ? loading : nightLoading} error={period === 'D' ? error : nightError} maximum={maximum} hoveredMonth={month} onHover={setHoveredMonth} period={period}/>)}</div>
    {rows.length > 0 && series?.has_data && <label className="linked-hover-control">Hover either chart to compare the same month, or use the slider: <strong>{month}</strong><input type="range" aria-label="Inspect satellite month" min="0" max={rows.length - 1} value={index} onChange={event => setHoveredMonth(monthKey(rows[Number(event.target.value)]))}/></label>}
    <p className="sensor-caution">MODIS and VIIRS observe the same burning activity with different detection capabilities. Their raw hotspot measurements cannot be compared directly without accounting for these differences.</p>
  </>;
}
