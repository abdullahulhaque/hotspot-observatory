import { useEffect, useState } from 'react';
import SensorChart, { monthKey } from './SensorChart.jsx';
import { qualityLabel } from './provenance.js';
import { rawComparison } from './rawComparison.js';

const fmt = value => value == null ? 'Unavailable' : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
const rawQuality = (row, metric) => [
  row[metric] == null ? 'Missing / unavailable' : 'Observed',
  row[metric] != null && !row.incomplete_metrics?.includes(metric) && (row.quality_available ? 'Complete coverage' : 'Completeness unverified'),
  qualityLabel(row, metric),
].filter(Boolean).join(' · ');

function ObservationComparison({ row, regionName, period, loading, error, hasData }) {
  const comparison = rawComparison(row);
  return <section className="observation-comparison" aria-labelledby="observation-comparison-title" aria-busy={loading}>
    <h3 id="observation-comparison-title">Observation comparison</h3>
    <p className="observation-context">{regionName} · {row ? monthKey(row) : 'No month selected'} · {period === 'D' ? 'Daytime' : 'Nighttime'}</p>
    {loading ? <p role="status">Loading observations…</p> : error ? <p className="quality-notice" role="alert">{error}</p> : !row || hasData === false ? <p>No data in this area</p> : <>
      <dl className="observation-values">
        {['raw_modis', 'raw_viirs'].map(metric => <div key={metric}><dt>{metric === 'raw_modis' ? 'Raw MODIS Aqua' : 'Raw VIIRS S-NPP'}</dt><dd data-metric={metric}>{fmt(row[metric])}</dd><dd className="observation-quality">{rawQuality(row, metric)}</dd></div>)}
        <div><dt>Difference (VIIRS − MODIS)</dt><dd data-metric="difference">{comparison.difference == null ? 'Unavailable' : new Intl.NumberFormat('en', { maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(comparison.difference)}</dd></div>
        <div><dt>Ratio (VIIRS / MODIS)</dt><dd data-metric="ratio">{comparison.ratio == null ? 'Unavailable' : `${new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(comparison.ratio)}×`}</dd></div>
      </dl>
      <p>Values and difference are in active cell-days; the ratio is unitless.</p>
      {comparison.reason && <p className="quality-notice">{comparison.reason}</p>}
      {comparison.ratioReason && <p>{comparison.ratioReason}</p>}
      {row.missing_snpp_days > 0 && <p className="quality-notice">{row.missing_snpp_days} confirmed missing S-NPP data days in this month.</p>}
      {row.nrt && <p className="quality-notice">This month includes provisional NRT data for at least one sensor. Values may change on refresh.</p>}
    </>}
    <p>Different detection capabilities can produce different measurements for the same region and month. These differences do not measure unique wildfires or establish an actual increase in fire activity.</p>
  </section>;
}

export default function SensorComparison({ daytime, loading, error, meta, bounds, regionName, retry, getJSON }) {
  const [period, setPeriod] = useState('D'), [hoveredMonth, setHoveredMonth] = useState('');
  const [range, setRange] = useState('overlap');
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
  const fullSeries = period === 'D' ? daytime : night;
  // The dataset contract starts VIIRS in 2012. Retain missing months within that window.
  const rows = (fullSeries?.data || []).filter(row => range === 'full' || row.year >= 2012);
  const series = fullSeries ? { ...fullSeries, data: rows } : null;
  const activeLoading = period === 'D' ? loading : nightLoading, activeError = period === 'D' ? error : nightError;
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
    <div className="sensor-observation-controls"><div><h3>Raw observations</h3><p>{regionName} · {rows.length ? monthKey(rows[0]) : '…'} to {rows.length ? monthKey(rows.at(-1)) : '…'}</p></div><label>Comparison range<select aria-label="Sensor comparison range" value={range} onChange={event => setRange(event.target.value)}><option value="overlap">Overlap (2012 onward)</option><option value="full">Full MODIS record</option></select></label><label>Observation period<select aria-label="Sensor observation period" value={period} onChange={event => setPeriod(event.target.value)}><option value="D">Daytime</option><option value="N">Nighttime</option></select></label></div>
    <p className="sensor-units">Monthly {period === 'D' ? 'daytime' : 'nighttime'} active cell-days · matching axes · missing observations are unavailable</p>
    {series?.synthetic && <p className="quality-notice" role="status">Synthetic development data — not NASA observations.</p>}
    <div className="raw-chart-pair">{['raw_modis', 'raw_viirs'].map(metric => <SensorChart key={metric} metric={metric} series={series} loading={period === 'D' ? loading : nightLoading} error={period === 'D' ? error : nightError} maximum={maximum} hoveredMonth={month} onHover={setHoveredMonth} period={period}/>)}</div>
    {rows.length > 0 && series?.has_data && <label className="linked-hover-control">Hover either chart to compare the same month, or use the slider: <strong>{month}</strong><input type="range" aria-label="Inspect satellite month" min="0" max={rows.length - 1} value={index} onChange={event => setHoveredMonth(monthKey(rows[Number(event.target.value)]))}/></label>}
    <ObservationComparison row={rows[index]} regionName={regionName} period={period} loading={activeLoading} error={activeError} hasData={series?.has_data}/>
    <p className="sensor-caution">MODIS and VIIRS observe the same burning activity with different detection capabilities. Their raw hotspot measurements cannot be compared directly without accounting for these differences.</p>
  </>;
}
