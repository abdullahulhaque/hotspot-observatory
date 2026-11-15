import { useEffect, useState } from 'react';
import SensorChart, { monthKey } from './SensorChart.jsx';

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
    <table className="instrument-comparison" aria-label="Instrument comparison">
      <thead><tr><th scope="col">Instrument</th><th scope="col" className="modis-instrument">MODIS Aqua</th><th scope="col" className="viirs-instrument">VIIRS S-NPP</th></tr></thead>
      <tbody>
        <tr><th scope="row">Historical coverage in our dataset</th><td>{meta?.start ? `${meta.start.slice(0, 4)} onward` : 'Loading…'}</td><td>2012 onward</td></tr>
        <tr><th scope="row">Nominal active-fire pixel resolution</th><td>≈ 1 km</td><td>≈ 375 m</td></tr>
        <tr><th scope="row">Relative detection sensitivity</th><td>Less sensitive to small hotspots</td><td>More sensitive to small hotspots</td></tr>
      </tbody>
    </table>
    <p className="sensor-explanation">Differences in pixel resolution, detection sensitivity, and observation timing mean the same burning activity can produce different hotspot counts.</p>
    <div className="sensor-observation-controls"><div><h3>Raw observations</h3><p>{regionName} · {meta?.start || '…'} to {meta?.end || '…'}</p></div><label>Observation period<select aria-label="Sensor observation period" value={period} onChange={event => setPeriod(event.target.value)}><option value="D">Daytime</option><option value="N">Nighttime</option></select></label></div>
    <p className="sensor-units">Monthly {period === 'D' ? 'daytime' : 'nighttime'} active cell-days · matching axes · missing observations are unavailable</p>
    {series?.synthetic && <p className="quality-notice" role="status">Synthetic development data — not NASA observations.</p>}
    <div className="raw-chart-pair">{['raw_modis', 'raw_viirs'].map(metric => <SensorChart key={metric} metric={metric} series={series} loading={period === 'D' ? loading : nightLoading} error={period === 'D' ? error : nightError} maximum={maximum} hoveredMonth={month} onHover={setHoveredMonth} period={period}/>)}</div>
    {rows.length > 0 && series?.has_data && <label className="linked-hover-control">Hover either chart to compare the same month, or use the slider: <strong>{month}</strong><input type="range" aria-label="Inspect satellite month" min="0" max={rows.length - 1} value={index} onChange={event => setHoveredMonth(monthKey(rows[Number(event.target.value)]))}/></label>}
    <p className="sensor-caution">MODIS and VIIRS observe the same burning activity with different detection capabilities. Their raw hotspot measurements cannot be compared directly without accounting for these differences.</p>
  </>;
}
