import { useEffect, useMemo, useState } from 'react';
import RegionMap from './Map.jsx';
import SensorChart from './SensorChart.jsx';
import MethodPanel from './MethodPanel.jsx';

const API = import.meta.env.VITE_API_BASE || '/api';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LABELS = { raw_modis: 'MODIS Aqua', raw_viirs: 'VIIRS Suomi-NPP', harmonized: 'Harmonized' };
// Sampled from cividis: monotonically increasing luminance, blue to yellow.
const CIVIDIS = ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8678', '#a59c74', '#c3b369', '#e1cc55', '#fee838'];
const format = value => value == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
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
  const [mode, setMode] = useState('raw'), [sensor, setSensor] = useState('raw_modis');
  const [selected, setSelected] = useState(''), [series, setSeries] = useState(null), [anomaly, setAnomaly] = useState(null);
  const [loading, setLoading] = useState(true), [anomalyError, setAnomalyError] = useState(''), [formError, setFormError] = useState('');
  const [retry, setRetry] = useState(0), [downloading, setDownloading] = useState(false);
  const [validation, setValidation] = useState(null);
  const metric = mode === 'harmonized' ? 'harmonized' : sensor;
  const query = useMemo(() => new URLSearchParams({ bbox: bounds.join(','), start, end, daynight: period }), [bounds, start, end, period]);

  useEffect(() => {
    const controller = new AbortController();
    getJSON('/validation', controller.signal).then(setValidation).catch(err => { if (err.name !== 'AbortError') setValidation({ status: 'invalid', message: err.message }); });
    getJSON('/meta', controller.signal).then(data => {
      setMeta(data);
      if (data.start && data.end) {
        setStart('2003-01'); setEnd(data.end);
        setSelected(data.end);
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

  const applyBounds = values => { setBounds(values); setInputs(values.map(String)); setFormError(''); };
  const rows = series?.data || [];
  const noData = series?.has_data === false;
  const nightUnavailable = mode === 'harmonized' && period === 'N' && start < '2012-01';
  const lookup = new Map(rows.map(row => [monthKey(row), row]));
  const years = [...new Set(rows.map(row => row.year))];
  const max = Math.max(0, ...rows.map(row => row[metric] ?? 0));
  const available = rows.filter(row => row[metric] != null);
  const total = available.length ? available.reduce((sum, row) => sum + row[metric], 0) : null;
  const stats = anomaly?.data?.[0]?.metrics?.[metric];
  const synthetic = meta?.synthetic || series?.synthetic || anomaly?.synthetic;

  async function download() {
    setDownloading(true);
    try {
      const response = await fetch(`${API}/export.csv?${query}`);
      if (!response.ok) throw new Error(`CSV export failed (${response.status}).`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `hotspots-${start}-${end}${synthetic ? '-synthetic' : ''}.csv`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err.message); }
    finally { setDownloading(false); }
  }

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-icon" aria-hidden="true">◉</span><div>HOTSPOT <strong>OBSERVATORY</strong><small>FIRE ACTIVITY · SPACE & TIME</small></div></div>
      <div className="header-note"><span className="status-dot" /> EARTH OBSERVATION EXPLORER <span className="version">v0.3</span></div></header>
    {synthetic && <div className="synthetic-banner" role="status"><strong>◈ SYNTHETIC DATA</strong><span>Invented demonstration values. Not NASA observations. Not for scientific use.</span></div>}
    <main>
      <div className="page-heading"><div><div className="eyebrow">REGIONAL ANALYSIS</div><h1>A clearer view of fire activity.</h1><p>Argentina · Hotspot detections, not individual fires or burned area.</p></div>
        <button className="export" onClick={download} disabled={!series || loading || downloading}>↓ {downloading ? 'Preparing…' : 'Download CSV'}</button></div>
      {error && <div className="error" role="alert">{error} <button onClick={() => setRetry(v => v + 1)}>Retry</button></div>}
      <div className="workspace">
        <section className="explorer" aria-label="Map and calendar">
          <div className="map-container">{meta ? <RegionMap bounds={bounds} onSelect={applyBounds} coverage={meta.coverage} /> : <div className="map-shell empty">Loading Argentina coverage…</div>}</div>
          <SensorChart series={series} loading={loading} selected={selected} onSelect={setSelected} period={period} />
          <section className="calendar-panel">
            <div className="section-title"><div><div className="eyebrow">THE LONG VIEW</div><h2>Monthly activity</h2></div><div className="mode-toggle" aria-label="Data scale">
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
                    const color = value == null ? undefined : CIVIDIS[Math.min(9, Math.floor((max ? value / max : 0) * 9))];
                    return <button key={key} disabled={!row} className={`cell ${value == null ? 'missing' : ''} ${row?.source === 'backcast' ? 'backcast' : row?.source === 'gapfill' ? 'gapfill' : ''} ${row?.gap_flag ? 'gap-flag' : ''} ${selected === key ? 'chosen' : ''}`}
                      style={{ backgroundColor: color }} onClick={() => setSelected(key)} aria-pressed={selected === key}
                      aria-label={`${month} ${year}: ${value == null ? 'unavailable' : format(value)}${synthetic ? ', synthetic' : ''}${row?.source === 'backcast' ? ', back-cast' : ''}${row?.gap_flag ? ', gap flagged' : ''}${row?.source === 'gapfill' ? ', model gap-fill' : ''}`}
                      title={`${month} ${year} · ${format(value)} active cell-days${row?.source === 'backcast' ? ' · Back-cast month' : ''}${row?.source === 'gapfill' ? ' · Gap-filled month' : ''}${row?.gap_flag ? ' · Sensor gap flagged' : ''}`} ><span className="source-symbol" aria-hidden="true">{row?.source === 'backcast' ? '•' : row?.source === 'gapfill' ? '◆' : ''}</span>{row?.gap_flag && <span className="gap-symbol" aria-hidden="true">△</span>}</button>;
                  })}</div>)}
                </div>}
            </div>
            <div className="legend"><span>0</span><span className="color-ramp" /><span>{format(max)} active cell-days</span><span className="missing-key" /> <span>Unavailable</span><span>• Back-cast month</span><span>◆ Gap-filled month</span><span>△ Sensor gap flagged</span></div>
          </section>
        </section>
        <aside>
          <section className="panel region-panel"><div className="eyebrow">01 / WHERE</div><h2>Define your region</h2><p className="muted">Draw on the map or enter coordinates.</p>
            <form onSubmit={event => { event.preventDefault(); const message = validateBounds(inputs); setFormError(message); if (!message) applyBounds(inputs.map(Number)); }}>
              <div className="coordinate-grid">{[['West longitude', 'W', 0], ['East longitude', 'E', 2], ['South latitude', 'S', 1], ['North latitude', 'N', 3]].map(([label, short, index]) =>
                <label key={short}>{label}<div className="coordinate-input"><input aria-label={label} type="number" step="any" min={index % 2 ? -90 : -180} max={index % 2 ? 90 : 180} value={inputs[index]} onChange={event => setInputs(previous => previous.map((value, i) => i === index ? event.target.value : value))} required /><span>° {short}</span></div></label>)}</div>
              {formError && <p className="field-error" role="alert">{formError}</p>}<button className="apply" type="submit">Apply coordinates <span>↗</span></button>
            </form>
            <div className="presets"><span>ARGENTINA REGIONS</span><button onClick={() => applyBounds([-64, -28, -59, -24])}>Gran Chaco</button><button onClick={() => applyBounds([-64, -38, -59, -33])}>Pampas</button><button onClick={() => applyBounds([-71, -50, -67, -40])}>Patagonia</button><button onClick={() => applyBounds([-74, -56, -53, -21])}>All Argentina</button></div>
          </section>
          <section className="panel"><div className="eyebrow">02 / WHEN & HOW</div><h2>Observation window</h2>
            <div className="date-grid"><label>From<input type="month" aria-label="Start month" value={start} onChange={event => setStart(event.target.value)} /></label><label>To<input type="month" aria-label="End month" value={end} onChange={event => setEnd(event.target.value)} /></label></div>
            <div className="filter-grid"><label>Acquisition<select value={period} onChange={event => setPeriod(event.target.value)} aria-label="Day or night"><option value="D">Daytime</option><option value="N">Nighttime</option></select></label>
              <label>Raw sensor<select value={sensor} onChange={event => setSensor(event.target.value)} disabled={mode !== 'raw'} aria-label="Raw sensor"><option value="raw_modis">MODIS Aqua</option><option value="raw_viirs">VIIRS S-NPP</option></select></label></div>
            <div className="summary"><div><strong>{noData ? 'No data in this area' : format(total)}</strong><span>active cell-days · {available.length} available months · {LABELS[metric]}</span></div><span className="summary-icon" aria-hidden="true">▥</span></div>
            <p className="footnote">Day and night are analyzed separately. Raw sensors have different sensitivities; their counts are not directly comparable.</p>
          </section>
          <section className="panel anomaly-panel"><div className="eyebrow">03 / THE DEPARTURE</div><div className="anomaly-title"><h2>Monthly anomaly</h2><span className="month-pill">{selected}</span></div>
            {noData ? <p className="muted">No data in this area</p> : anomalyError ? <p className="field-error" role="alert">{anomalyError}</p> : !stats ? <p className="muted">Loading historical comparison…</p> : <>
              <div className="anomaly-number">{stats.percent_change == null ? '—' : `${stats.percent_change > 0 ? '+' : ''}${format(stats.percent_change)}%`}</div>
              <p className="anomaly-caption">{stats.historical_median === 0 ? 'Percent change is undefined for a zero baseline.' : stats.value == null ? 'Selected value unavailable.' : stats.sample_size === 0 ? 'No earlier years available for this month.' : 'relative to the historical monthly median'}</p>
              <p className="footnote">active cell-days</p><div className="comparison"><div><span>Selected month</span><strong>{format(stats.value)}</strong></div><div><span>Historical median</span><strong>{format(stats.historical_median)}</strong></div><div><span>Absolute difference</span><strong>{stats.difference > 0 ? '+' : ''}{format(stats.difference)}</strong></div></div>
              <p className="footnote">{stats.sample_size} earlier {stats.sample_size === 1 ? 'year' : 'years'}{stats.sample_size > 0 ? ` (${stats.baseline_years[0]}–${stats.baseline_years.at(-1)})` : ''} · Same calendar month · Target year excluded. Baseline uses all available earlier years, independent of the displayed window.</p>
            </>}
          </section>
          <MethodPanel validation={validation} calibration={meta?.calibration} />
        </aside>
      </div>
      <footer><span>0.1° GRID · WGS84 · UTC</span><span>Calibration: {meta?.calibration || 'loading'}{synthetic ? ' · Synthetic demonstration' : ''}</span></footer>
    </main>
  </div>;
}
