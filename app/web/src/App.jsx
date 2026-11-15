import { useEffect, useMemo, useState } from 'react';
import MonthQuality from './MonthQuality.jsx';
import { qualityLabel, comparisonBlocked } from './provenance.js';
import SectionNav from './SectionNav.jsx';
import SeasonComparison from './SeasonComparison.jsx';
import RegionMap from './Map.jsx';
import SensorChart from './SensorChart.jsx';
import MethodPanel from './MethodPanel.jsx';
import AreaSummary from './AreaSummary.jsx';
import WhyHarmonize from './WhyHarmonize.jsx';
import { CIVIDIS, heatColor, legendTicks } from './heatScale.js';

const API = import.meta.env.VITE_API_BASE || '/api';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LABELS = { raw_modis: 'MODIS Aqua', raw_viirs: 'VIIRS Suomi-NPP', harmonized: 'Harmonized' };
const format = value => value == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
const monthLabel = value => value ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`)) : 'Loading…';
const PRESETS = [['All Argentina', [-74,-56,-53,-21]], ['Gran Chaco', [-64,-28,-59,-24]], ['Pampas', [-64,-38,-59,-33]], ['Patagonia', [-71,-50,-67,-40]]];
const monthKey = row => `${row.year}-${String(row.month).padStart(2, '0')}`;
function validateBounds(values) {
  if (values.some(v => String(v).trim() === '' || !Number.isFinite(Number(v)))) return 'Enter all four coordinates.';
  const [w, s, e, n] = values.map(Number);
  if (Math.abs(w) > 180 || Math.abs(e) > 180 || Math.abs(s) > 90 || Math.abs(n) > 90) return 'Longitude must be ±180° and latitude ±90°.';
  if (s >= n || w === e) return 'South must be below north, and west and east must differ.';
  return '';
}
async function getJSON(path, signal) {
  const response = await fetch(`${API}${path}`, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${response.status}).`);
  }
  return response.json();
}

export default function App() {
  const [meta, setMeta] = useState(null), [error, setError] = useState('');
  const [bounds, setBounds] = useState([-74, -56, -53, -21]), [inputs, setInputs] = useState(['-74', '-56', '-53', '-21']);
  const [start, setStart] = useState('2003-01'), [end, setEnd] = useState(''), [period, setPeriod] = useState('D');
  const [mode, setMode] = useState('harmonized'), [sensor, setSensor] = useState('raw_modis');
  const [selected, setSelected] = useState(''), [series, setSeries] = useState(null), [anomaly, setAnomaly] = useState(null);
  const [loading, setLoading] = useState(true), [anomalyError, setAnomalyError] = useState(''), [formError, setFormError] = useState('');
  const [retry, setRetry] = useState(0), [downloading, setDownloading] = useState(false);
  const [validation, setValidation] = useState(null);
  const [area, setArea] = useState(null), [areaLoading, setAreaLoading] = useState(true), [areaError, setAreaError] = useState('');
  const [daytime, setDaytime] = useState(null), [dayLoading, setDayLoading] = useState(true), [dayError, setDayError] = useState('');
  const [exploreView, setExploreView] = useState('calendar');
  const [seasonNight, setSeasonNight] = useState(null), [seasonLoading, setSeasonLoading] = useState(true), [seasonError, setSeasonError] = useState('');
  const [hoveredMonth, setHoveredMonth] = useState('');
  const metric = mode === 'harmonized' ? 'harmonized' : sensor;
  const query = useMemo(() => new URLSearchParams({ bbox: bounds.join(','), start, end, daynight: period }), [bounds, start, end, period]);

  useEffect(() => {
    const controller = new AbortController();
    getJSON('/validation', controller.signal).then(setValidation).catch(err => { if (err.name !== 'AbortError') setValidation({ status: 'invalid', message: err.message }); });
    getJSON('/meta', controller.signal).then(data => {
      setMeta(data);
      if (data.start && data.end) {
        const latest = data.latest_complete_month && data.latest_complete_month < data.end ? data.latest_complete_month : data.end;
        setStart('2003-01'); setEnd(latest);
        setSelected(latest);
      }
    }).catch(err => { if (err.name !== 'AbortError') { setError(err.message); setLoading(false); } });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!meta) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setSeries(null);
    if (!start || !end || start > end) { setError('Choose a start month on or before the end month.'); setLoading(false); return () => controller.abort(); }
    getJSON(`/series?${query}`, controller.signal).then(setSeries).catch(err => {
      if (err.name !== 'AbortError') setError(err.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [meta, query, retry]);

  useEffect(() => {
    if (start && end && start <= end) setSelected(value => value < start ? start : value > end ? end : value);
  }, [start, end]);

  useEffect(() => {
    if (!meta || !selected) return;
    const controller = new AbortController();
    setAnomaly(null); setAnomalyError('');
    const params = new URLSearchParams({ bbox: bounds.join(','), month: selected, daynight: period });
    getJSON(`/anomaly?${params}`, controller.signal).then(setAnomaly).catch(err => { if (err.name !== 'AbortError') setAnomalyError(err.message); });
    return () => controller.abort();
  }, [meta, bounds, selected, period, retry]);

  useEffect(() => {
    if (!meta) return;
    const controller = new AbortController();
    setArea(null); setAreaError(''); setAreaLoading(true);
    const params = new URLSearchParams({ bbox: bounds.join(','), daynight: period });
    getJSON(`/area-summary?${params}`, controller.signal).then(setArea).catch(err => {
      if (err.name !== 'AbortError') setAreaError(err.message);
    }).finally(() => { if (!controller.signal.aborted) setAreaLoading(false); });
    return () => controller.abort();
  }, [meta, bounds, period, retry]);

  useEffect(() => {
    if (!meta?.start || !meta?.end) return;
    const controller = new AbortController();
    setDayLoading(true); setDayError(''); setDaytime(null);
    const params = new URLSearchParams({ bbox: bounds.join(','), start: meta.start, end: meta.end, daynight: 'D' });
    getJSON(`/series?${params}`, controller.signal).then(data => {
      setDaytime(data); setHoveredMonth(value => value >= meta.start && value <= meta.end ? value : meta.end);
    }).catch(err => { if (err.name !== 'AbortError') setDayError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setDayLoading(false); });
    return () => controller.abort();
  }, [meta, bounds, retry]);

  useEffect(() => {
    if (exploreView !== 'seasons' || period !== 'N' || !meta?.start || !meta?.end) return;
    const controller = new AbortController();
    setSeasonNight(null); setSeasonLoading(true); setSeasonError('');
    const params = new URLSearchParams({ bbox: bounds.join(','), start: meta.start, end: meta.end, daynight: 'N' });
    getJSON(`/series?${params}`, controller.signal).then(setSeasonNight).catch(err => {
      if (err.name !== 'AbortError') setSeasonError(err.message);
    }).finally(() => { if (!controller.signal.aborted) setSeasonLoading(false); });
    return () => controller.abort();
  }, [exploreView, period, meta, bounds, retry]);

  const applyBounds = values => { setBounds(values); setInputs(values.map(String)); setFormError(''); };
  const rows = series?.data || [];
  const noData = series?.has_data === false;
  const nightUnavailable = mode === 'harmonized' && period === 'N' && start < '2012-01';
  const lookup = new Map(rows.map(row => [monthKey(row), row]));
  const years = [...new Set(rows.map(row => row.year))];
  const max = Math.max(0, ...rows.map(row => row[metric] ?? 0));
  const available = rows.filter(row => row[metric] != null);
  const total = available.length ? available.reduce((sum, row) => sum + row[metric], 0) : null;
  const anomalyRow = anomaly?.data?.[0];
  const stats = anomalyRow?.metrics?.harmonized;
  const synthetic = meta?.synthetic || series?.synthetic || anomaly?.synthetic;

  async function download() {
    setDownloading(true);
    try {
      const response = await fetch(`${API}/export.csv?${query}&metric=${metric}`);
      if (!response.ok) throw new Error(`CSV export failed (${response.status}).`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `hotspots-${start}-${end}-${metric}${synthetic ? '-synthetic' : ''}.csv`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err.message); }
    finally { setDownloading(false); }
  }

  const regionName = PRESETS.find(([,values]) => values.join(',') === bounds.join(','))?.[0] || 'Custom area';
  const latestMonth = meta?.latest_complete_month && meta.latest_complete_month < meta.end ? meta.latest_complete_month : meta?.end;
  const rawRows = daytime?.data || [];
  const rawMaximum = Math.max(1, ...rawRows.flatMap(row => [row.raw_modis || 0, row.raw_viirs || 0]));
  const rawIndex = Math.max(0, rawRows.findIndex(row => monthKey(row) === hoveredMonth));

  return <div className="app-shell">
    <header className="topbar"><div className="topbar-inner"><div className="brand"><span className="brand-icon" aria-hidden="true">◉</span><div>HOTSPOT <strong>OBSERVATORY</strong><small>Harmonized satellite fire history</small></div></div><SectionNav/></div></header>
    {synthetic && <div className="synthetic-banner" role="status"><strong>◈ SYNTHETIC DATA</strong><span>Invented demonstration values. Not NASA observations. Not for scientific use.</span></div>}
    <main className="four-section-page">
      <div className="page-heading"><div><h1>Harmonized fire activity from MODIS and VIIRS</h1><p className="hero-subhead">Explore decades of satellite-detected fire activity through a unified historical record. Compare burning patterns across regions, seasons, and years, identify unusual activity, and investigate long-term trends using NASA observations calibrated for differences between satellite instruments.</p><p className="hero-note">Current coverage: {meta?.country || 'Argentina'}, {meta?.start?.slice(0, 4) || '2003'}–{latestMonth?.slice(0, 4) || '2026'} · More regions planned</p><details className="measurement-explanation"><summary>Data and methods</summary><p>Argentina is divided into 0.1° geographic grid cells. Each cell with at least one hotspot detection on a day contributes one active cell-day. The same cell can count again on another day. This measures satellite-detected activity, not unique fires or burned area.</p></details></div></div>
      {error && <div className="error" role="alert">{error} <button onClick={() => setRetry(v => v + 1)}>Retry</button></div>}
      <div className="overview-row">
      <section id="where" className="page-section" aria-labelledby="where-title">
        <div className="page-section-heading"><span>01</span><h2 id="where-title">Choose your study area.</h2><p>Select a region or define your own area to explore NASA satellite observations.</p></div>
        <div className="where-grid"><div className="map-container">{meta ? <RegionMap bounds={bounds} onSelect={applyBounds} coverage={meta.coverage} /> : <div className="map-shell empty">Loading Argentina coverage…</div>}</div>
          <section className="panel region-panel" aria-label="Current study area">
            <div className="presets" aria-label="Study area presets">{PRESETS.map(([name, values]) => <button key={name} aria-pressed={regionName === name} onClick={() => applyBounds(values)}>{name}</button>)}</div>
            <div className="current-study-area"><h3>Current study area</h3><p className="study-area-name" aria-live="polite">{regionName}</p><p className="historical-record">Historical record: {monthLabel(meta?.start)} - {monthLabel(latestMonth)}</p></div>
            <p className="coverage-note">The selected rectangle is a geographic bounding box. Analyses include only data within Argentina coverage; surrounding countries are excluded.</p>
            <details className="custom-coordinates"><summary>Custom coordinates</summary>
            <p id="coordinate-help" className="coordinate-help">Signed decimal degrees: negative longitude is west; negative latitude is south.</p>
            <form onSubmit={event => { event.preventDefault(); const message = validateBounds(inputs); setFormError(message); if (!message) applyBounds(inputs.map(Number)); }}>
              <div className="coordinate-grid">{[['West longitude', 'W', 0], ['East longitude', 'E', 2], ['South latitude', 'S', 1], ['North latitude', 'N', 3]].map(([label, short, index]) =>
                <label key={short}>{label}<div className="coordinate-input"><input aria-label={label} aria-describedby="coordinate-help" type="number" step="any" min={index % 2 ? -90 : -180} max={index % 2 ? 90 : 180} value={inputs[index]} onChange={event => setInputs(previous => previous.map((value, i) => i === index ? event.target.value : value))} required /><span aria-hidden="true">°</span></div></label>)}</div>
              {formError && <p className="field-error" role="alert">{formError}</p>}<button className="apply" type="submit">Update study area</button>
            </form>
            </details>
            <p className="small-area-warning">Calibration was validated nationally. Regional estimates have not been independently validated; small-area estimates are less reliable.</p>
          </section>
        </div>
        <a className="next-section" href="#satellites">Next: Compare satellite observations</a>
      </section>
      <section id="satellites" className="page-section compact-section" aria-labelledby="satellites-title">
        <div className="page-section-heading"><span>02</span><h2 id="satellites-title">Compare the Satellites</h2><p>Monthly daytime active cell-days · same y-axis scale · full record</p></div>
        <div className="raw-chart-pair">{['raw_modis','raw_viirs'].map(rawMetric => <SensorChart key={rawMetric} metric={rawMetric} series={daytime} loading={dayLoading} error={dayError} maximum={rawMaximum} hoveredMonth={hoveredMonth} onHover={setHoveredMonth}/>)}</div>
        {rawRows.length > 0 && daytime?.has_data && <label className="linked-hover-control">Hover either chart to compare the same month, or use the slider: <strong>{hoveredMonth}</strong><input type="range" aria-label="Inspect satellite month" min="0" max={rawRows.length-1} value={rawIndex} onChange={event => setHoveredMonth(monthKey(rawRows[Number(event.target.value)]))}/></label>}
        <div className="sensor-table-wrap"><table className="sensor-comparison-table"><thead><tr><th>Sensor</th><th>Record begins</th><th>Pixel size</th><th>What it detects</th></tr></thead><tbody><tr><th>MODIS Aqua</th><td>Mid-2002</td><td>~1 km</td><td>Larger thermal signals</td></tr><tr><th>VIIRS S-NPP</th><td>2012</td><td>375 m</td><td>Catches smaller fires</td></tr></tbody></table></div>
        <p className="sensor-caution">More VIIRS detections do not mean more fires occurred.</p><p className="footnote">Sensor record dates are shown above; this Argentina dataset begins in {meta?.start || '2003-01'}.</p>
      </section>
      </div>
      <section id="history" className="page-section compact-section" aria-labelledby="history-title">
        <div className="page-section-heading"><span>03</span><h2 id="history-title">Understand Harmonization</h2><p>A consistent scale across the sensor change.</p></div>
        <WhyHarmonize data={area} loading={areaLoading} error={areaError} compact />
        <MethodPanel validation={validation} calibration={meta?.calibration}/>
      </section>
      <section id="explore" className="page-section explore-section" aria-labelledby="explore-title">
        <div className="page-section-heading"><span>04</span><h2 id="explore-title">Explore Fire History</h2><p>Select a month to inspect its harmonized history.</p></div>
        <div className="mode-toggle explore-view-toggle" aria-label="History view"><button aria-pressed={exploreView === 'calendar'} className={exploreView === 'calendar' ? 'selected' : ''} onClick={() => setExploreView('calendar')}>Fire calendar</button><button aria-pressed={exploreView === 'seasons'} className={exploreView === 'seasons' ? 'selected' : ''} onClick={() => setExploreView('seasons')}>Compare seasons</button></div>
        {exploreView === 'seasons' && <SeasonComparison series={period === 'D' ? daytime : seasonNight} loading={period === 'D' ? dayLoading : seasonLoading} error={period === 'D' ? dayError : seasonError} start={meta?.start} end={latestMonth} regionName={regionName} period={period} onPeriodChange={setPeriod}/>}
        <div className="calendar-view" hidden={exploreView !== 'calendar'}>
          <section className="panel observation-controls"><h3>Observation window</h3>
            <div className="date-grid"><label>From<input type="month" aria-label="Start month" value={start} onChange={event => setStart(event.target.value)} /></label><label>To<input type="month" aria-label="End month" max={meta?.end} value={end} onChange={event => setEnd(event.target.value)} /></label></div>
            <div className="filter-grid"><label>Acquisition<select value={period} onChange={event => setPeriod(event.target.value)} aria-label="Day or night"><option value="D">Daytime</option><option value="N">Nighttime</option></select></label>
              <label>Raw sensor<select value={sensor} onChange={event => setSensor(event.target.value)} disabled={mode !== 'raw'} aria-label="Raw sensor"><option value="raw_modis">MODIS Aqua</option><option value="raw_viirs">VIIRS S-NPP</option></select></label></div>
            <div className="summary"><div><strong>{noData ? 'No data in this area' : format(total)}</strong><span>active cell-days · {available.length} available months · {LABELS[metric]}</span></div><span className="summary-icon" aria-hidden="true">▥</span></div>

            {available.some(row => row.incomplete_metrics?.includes(metric)) && <p className="footnote quality-notice">This total includes incomplete observations; it can undercount activity. Inspect the ! months below.</p>}
            {available.some(row => row.nrt) && <p className="footnote">NRT months are provisional and may change on refresh.</p>}
          </section>
        <div className="explore-grid">
          <section className="calendar-panel">
            <div className="section-title"><div><div className="eyebrow">THE LONG VIEW</div><h3>Monthly activity</h3></div><div className="mode-toggle" aria-label="Data scale">
              <button aria-pressed={mode === 'raw'} className={mode === 'raw' ? 'selected' : ''} onClick={() => setMode('raw')}>Raw</button>
              <button aria-pressed={mode === 'harmonized'} className={mode === 'harmonized' ? 'selected' : ''} onClick={() => setMode('harmonized')}>Harmonized</button></div></div>
            <div className="calendar-description"><span>{LABELS[metric]} · {period === 'D' ? 'Daytime' : 'Nighttime'} · active cell-days</span><span>Click a month to inspect ↗</span></div>
            {mode === 'harmonized' && !meta?.has_harmonized && <div className="info">Harmonized values are unavailable. Missing values are not zero.</div>}
            {nightUnavailable && <div className="info" role="status">Nighttime harmonized is unavailable before 2012. No night back-cast is produced; these months are missing, not zero.</div>}
            <div className="calendar-scroll" aria-busy={loading}>
              {loading ? <div className="empty">Loading monthly activity…</div> : noData ? <div className="empty">No data in this area</div> : !rows.some(r => r[metric] != null) ? <div className="empty">{nightUnavailable ? 'Nighttime harmonized is unavailable before 2012' : 'No data for this sensor in this date range'}</div> :
                <div className="calendar" role="group" aria-label="Year by month activity heatmap">
                  <div className="calendar-row month-labels"><span>YEAR</span>{MONTHS.map(month => <span key={month}>{month}</span>)}</div>
                  {years.map(year => <div className="calendar-row" key={year}><span className="year-label">{year}</span>{MONTHS.map((month, index) => {
                    const key = `${year}-${String(index + 1).padStart(2, '0')}`, row = lookup.get(key), value = row?.[metric];
                    const color = heatColor(value, max);
                    const source = mode === 'harmonized' ? row?.source : 'observed';
                    return <button key={key} disabled={!row} className={`cell ${value == null ? 'missing' : ''} ${source === 'backcast' ? 'backcast' : source === 'gapfill' ? 'gapfill' : ''} ${row?.gap_flag ? 'gap-flag' : ''} ${row?.incomplete_metrics?.includes(metric) ? 'incomplete-cell' : ''} ${row?.nrt ? 'nrt-cell' : ''} ${selected === key ? 'chosen' : ''}`}
                      style={{ backgroundColor: color }} onClick={() => setSelected(key)} aria-pressed={selected === key}
                      aria-label={`${month} ${year}: ${value == null ? 'unavailable' : format(value)}${synthetic ? ', synthetic' : ''}${source === 'backcast' ? ', back-cast' : ''}${row?.gap_flag ? ', gap flagged' : ''}${source === 'gapfill' ? ', model gap-fill' : ''}, ${qualityLabel(row, metric)}`}
                      title={`${month} ${year} · ${format(value)} active cell-days${source === 'backcast' ? ' · Back-cast month' : ''}${source === 'gapfill' ? ' · Gap-filled month' : ''} · ${qualityLabel(row, metric)}`} ><span className="source-symbol" aria-hidden="true">{source === 'backcast' ? '•' : source === 'gapfill' ? '◆' : ''}</span>{row?.gap_flag && <span className="gap-symbol" aria-hidden="true">△</span>}{row?.incomplete_metrics?.includes(metric) && <span className="incomplete-symbol" aria-hidden="true">!</span>}{row?.nrt && <span className="nrt-symbol" aria-hidden="true">N</span>}</button>;
                  })}</div>)}
                </div>}
            </div>
            <div className="heat-scale" aria-label="Square-root cividis colour scale"><span>active cell-days · square-root scale</span><div className="heat-ramp" style={{ background: `linear-gradient(to right, ${CIVIDIS.join(',')})` }} /><div className="heat-ticks">{legendTicks(max).map(tick => <span key={tick.position} style={{ left: `${tick.position * 100}%` }}>{format(tick.value)}</span>)}</div></div>
            <div className="legend"><span className="missing-key" /> <span>Unavailable</span>{mode === 'harmonized' && <><span>• Back-cast month</span><span>◆ Gap-filled month</span></>}<span>△ Sensor gap flagged</span><span>! Incomplete observations</span><span>N Near-real-time (provisional)</span></div>
          </section>
          <section className="panel anomaly-panel"><div className="anomaly-title"><h3>Monthly anomaly</h3><span className="month-pill">{selected}</span></div>
            <p className="muted anomaly-series">Series used: Harmonized · {period === 'D' ? 'Daytime' : 'Nighttime'}</p>
            {anomalyRow && !noData && <p className="anomaly-source footnote">{anomalyRow.source === 'backcast' ? '• Selected month is back-cast from MODIS.' : anomalyRow.source === 'gapfill' ? '◆ Selected month is gap-filled from MODIS.' : stats?.value == null ? 'Selected harmonized value is unavailable.' : 'Selected month uses observed VIIRS.'}{anomalyRow.gap_flag ? ' △ Sensor gap flagged.' : ''}</p>}
            {!noData && <MonthQuality row={anomalyRow} interval={anomaly?.interval}/>}
            {noData ? <p className="muted">No data in this area</p> : anomalyError ? <p className="field-error" role="alert">{anomalyError}</p> : !stats ? <p className="muted">Loading historical comparison…</p> : <>
              <div className="anomaly-number">{stats.percent_change == null ? '—' : `${stats.percent_change > 0 ? '+' : ''}${format(stats.percent_change)}%`}</div>
              <p className="anomaly-caption">{comparisonBlocked(stats) ? 'Comparison withheld: incomplete observations or unavailable coverage metadata.' : stats.historical_median === 0 ? 'Percent change is undefined for a zero baseline.' : stats.value == null ? (period === 'N' && selected < '2012-01' ? 'Nighttime harmonized is unavailable before 2012.' : 'Selected harmonized value unavailable.') : stats.sample_size === 0 ? 'No earlier years available for this month.' : 'relative to the historical monthly median'}</p>
              <p className="footnote">active cell-days</p><div className="comparison"><div><span>Selected month</span><strong>{format(stats.value)}</strong></div><div><span>Historical median</span><strong>{format(stats.historical_median)}</strong></div><div><span>Absolute difference</span><strong>{stats.difference > 0 ? '+' : ''}{format(stats.difference)}</strong></div></div>
              <p className="anomaly-rank">{stats.rank == null ? (comparisonBlocked(stats) ? 'Rank withheld' : 'Rank unavailable') : `${stats.rank_tied ? 'Tied rank' : 'Rank'} ${stats.rank} of ${stats.rank_count} ${MONTHS[Number(selected.slice(5))-1]} records`}</p>
              <p className="footnote">1 = highest. Rank includes this month and the earlier same-calendar-month records; ties share a rank.</p>
              <p className="footnote">{stats.sample_size} earlier {stats.sample_size === 1 ? 'year' : 'years'}{stats.sample_size > 0 ? ` (${stats.baseline_years[0]}–${stats.baseline_years.at(-1)})` : ''} · Same calendar month · Target year excluded. Both values use Harmonized. Baseline excludes known incomplete observations and uses earlier years independent of the displayed window. Estimates remain included and carry model uncertainty.</p>
            </>}
          </section>
        </div>
        <AreaSummary data={area} loading={areaLoading} error={areaError}/>
        <div className="csv-row"><div><h3>Take the selected series with you</h3><p>Monthly {LABELS[metric]} · active cell-days · includes source, NRT, missing-day and interval columns</p></div><button className="export" title={`Export ${LABELS[metric]} in active cell-days`} onClick={download} disabled={!series || loading || downloading}>↓ {downloading ? 'Preparing…' : 'Download CSV'}</button></div>
        </div>
      </section>
      <footer><span>0.1° GRID · WGS84 · UTC</span><span>Calibration: {meta?.calibration || 'loading'}{synthetic ? ' · Synthetic demonstration' : ''}</span></footer>
    </main>
  </div>;
}
