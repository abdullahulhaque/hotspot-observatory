import { useEffect, useMemo, useRef, useState } from 'react';
import SeasonComparison from './SeasonComparison.jsx';
import RegionMap from './Map.jsx';
import SensorComparison from './SensorComparison.jsx';
import MethodPanel from './MethodPanel.jsx';
import AreaSummary from './AreaSummary.jsx';
import WhyHarmonize from './WhyHarmonize.jsx';
import Hero from './Hero.jsx';
import DataSources from './DataSources.jsx';
import MethodSteps from './MethodSteps.jsx';
import Limitations from './Limitations.jsx';
import Timeline from './Timeline.jsx';
import Inspector from './Inspector.jsx';
import CalendarPanel from './CalendarPanel.jsx';
import { RegionalComparison, TimingTrend } from './Analyses.jsx';
import { MAP_RAMP, legendTicks } from './heatScale.js';
import { withSelection } from './exportCsv.js';
import UnitNote from './UnitNote.jsx';

const API = import.meta.env.VITE_API_BASE || '/api';
const LABELS = { raw_modis: 'MODIS Aqua', raw_viirs: 'VIIRS Suomi-NPP', harmonized: 'Harmonized' };
const format = value => value == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
const monthLabel = value => value ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`)) : 'Loading…';
const PRESETS = [['All Argentina', [-74,-56,-53,-21]], ['Gran Chaco', [-64,-28,-59,-24]], ['Pampas', [-64,-38,-59,-33]], ['Patagonia', [-71,-50,-67,-40]]];
const ALL_ARGENTINA = PRESETS[0][1];
const VIEWS = [['explore', 'Explore'], ['validation', 'Validation'], ['methods', 'Methods'], ['data', 'Data'], ['limitations', 'Limitations'], ['about', 'About']];
const TABS = [['calendar', 'Calendar'], ['seasons', 'Seasons'], ['record', 'Annual record'], ['trend', 'Timing & trend'], ['regions', 'Regions'], ['sensors', 'Raw sensors']];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
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
// The URL holds the analysis state, so any view can be bookmarked or shared.
function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const bbox = (p.get('bbox') || '').split(',');
  const pick = (name, allowed, fallback) => allowed.includes(p.get(name)) ? p.get(name) : fallback;
  const series = pick('series', ['harmonized', 'raw_modis', 'raw_viirs'], 'harmonized');
  return {
    view: pick('view', VIEWS.map(v => v[0]), 'explore'), tab: pick('tab', TABS.map(t => t[0]), 'calendar'),
    bounds: bbox.length === 4 && !validateBounds(bbox) ? bbox.map(Number) : ALL_ARGENTINA,
    start: MONTH.test(p.get('start') || '') ? p.get('start') : '', end: MONTH.test(p.get('end') || '') ? p.get('end') : '',
    month: MONTH.test(p.get('month') || '') ? p.get('month') : '', period: pick('period', ['D', 'N'], 'D'),
    mode: series === 'harmonized' ? 'harmonized' : 'raw', sensor: series === 'harmonized' ? 'raw_modis' : series,
    baseline: pick('baseline', ['all', '10'], 'all'),
  };
}

function Tabs({ items, active, onChange, label, className = '' }) {
  const refs = useRef({});
  const onKeyDown = (event, index) => {
    const delta = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!delta) return;
    event.preventDefault();
    const [id] = items[(index + delta + items.length) % items.length];
    onChange(id); refs.current[id]?.focus();
  };
  return <div className={`tabs ${className}`} role="tablist" aria-label={label}>{items.map(([id, name], index) =>
    <button key={id} ref={el => { refs.current[id] = el; }} role="tab" id={`tab-${id}`} aria-selected={active === id} aria-controls={`panel-${id}`} tabIndex={active === id ? 0 : -1}
      onClick={() => onChange(id)} onKeyDown={event => onKeyDown(event, index)}>{name}</button>)}</div>;
}

export default function App() {
  const initial = useMemo(readUrl, []);
  const [view, setView] = useState(initial.view), [tab, setTab] = useState(initial.tab);
  const [meta, setMeta] = useState(null), [error, setError] = useState('');
  const [bounds, setBounds] = useState(initial.bounds), [inputs, setInputs] = useState(initial.bounds.map(String));
  const [start, setStart] = useState(initial.start), [end, setEnd] = useState(initial.end), [period, setPeriod] = useState(initial.period);
  const [mode, setMode] = useState(initial.mode), [sensor, setSensor] = useState(initial.sensor), [baseline, setBaseline] = useState(initial.baseline);
  const [selected, setSelected] = useState(initial.month), [series, setSeries] = useState(null), [anomaly, setAnomaly] = useState(null);
  const [loading, setLoading] = useState(true), [anomalyError, setAnomalyError] = useState(''), [formError, setFormError] = useState('');
  const [retry, setRetry] = useState(0), [downloading, setDownloading] = useState(false), [copied, setCopied] = useState(false);
  const [validation, setValidation] = useState(null);
  const [area, setArea] = useState(null), [areaLoading, setAreaLoading] = useState(true), [areaError, setAreaError] = useState('');
  const [daytime, setDaytime] = useState(null), [dayLoading, setDayLoading] = useState(true), [dayError, setDayError] = useState('');
  const [seasonNight, setSeasonNight] = useState(null), [seasonLoading, setSeasonLoading] = useState(true), [seasonError, setSeasonError] = useState('');
  const [national, setNational] = useState(null), [grid, setGrid] = useState(null), [gridError, setGridError] = useState('');
  const [regions, setRegions] = useState(PRESETS.map(([name]) => ({ name, loading: true })));
  const metric = mode === 'harmonized' ? 'harmonized' : sensor;
  const query = useMemo(() => new URLSearchParams({ bbox: bounds.join(','), start, end, daynight: period }), [bounds, start, end, period]);

  useEffect(() => {
    const controller = new AbortController();
    getJSON('/validation', controller.signal).then(setValidation).catch(err => { if (err.name !== 'AbortError') setValidation({ status: 'invalid', message: err.message }); });
    getJSON('/meta', controller.signal).then(data => {
      setMeta(data);
      if (data.start && data.end) {
        const latest = data.latest_complete_month && data.latest_complete_month < data.end ? data.latest_complete_month : data.end;
        // Fill defaults only where neither the URL nor the user has chosen a value.
        setStart(value => value || data.start); setEnd(value => value || latest);
        setSelected(value => value || latest);
      }
    }).catch(err => { if (err.name !== 'AbortError') { setError(err.message); setLoading(false); } });
    getJSON(`/area-summary?bbox=${ALL_ARGENTINA.join(',')}&daynight=D`, controller.signal).then(setNational)
      .catch(err => { if (err.name !== 'AbortError') setNational({ error: err.message }); });
    return () => controller.abort();
  }, [retry]);

  // Keep the URL in step with the analysis state (no history entries for every change).
  useEffect(() => {
    if (!meta) return;
    const p = new URLSearchParams({ view, tab, bbox: bounds.join(','), start, end, month: selected, period, series: metric, baseline });
    window.history.replaceState(null, '', `${window.location.pathname}?${p}`);
    setCopied(false);
  }, [meta, view, tab, bounds, start, end, selected, period, metric, baseline]);

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
    if (start && end && start <= end) setSelected(value => !value ? value : value < start ? start : value > end ? end : value);
  }, [start, end]);

  useEffect(() => {
    if (!meta || !selected) return;
    const controller = new AbortController();
    setAnomaly(null); setAnomalyError('');
    const params = new URLSearchParams({ bbox: bounds.join(','), month: selected, daynight: period, baseline });
    getJSON(`/anomaly?${params}`, controller.signal).then(setAnomaly).catch(err => { if (err.name !== 'AbortError') setAnomalyError(err.message); });
    return () => controller.abort();
  }, [meta, bounds, selected, period, baseline, retry]);

  useEffect(() => {
    if (!meta || !selected) return;
    const controller = new AbortController();
    setGridError('');
    const params = new URLSearchParams({ month: selected, daynight: period, metric });
    getJSON(`/grid?${params}`, controller.signal).then(setGrid).catch(err => { if (err.name !== 'AbortError') { setGrid(null); setGridError(err.message); } });
    return () => controller.abort();
  }, [meta, selected, period, metric, retry]);

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
    getJSON(`/series?${params}`, controller.signal).then(setDaytime).catch(err => { if (err.name !== 'AbortError') setDayError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setDayLoading(false); });
    return () => controller.abort();
  }, [meta, bounds, retry]);

  // Regional profiles always compare the four fixed preset areas; load on first use.
  const regionsWanted = tab === 'regions' && view === 'explore';
  const [regionsRequested, setRegionsRequested] = useState(false);
  useEffect(() => { if (regionsWanted) setRegionsRequested(true); }, [regionsWanted]);
  useEffect(() => {
    if (!regionsRequested || !meta?.start || !meta?.end) return;
    const controller = new AbortController();
    setRegions(PRESETS.map(([name]) => ({ name, loading: true })));
    PRESETS.forEach(([name, box], index) => {
      const params = new URLSearchParams({ bbox: box.join(','), start: meta.start, end: meta.end, daynight: 'D' });
      getJSON(`/series?${params}`, controller.signal)
        .then(data => setRegions(list => list.map((r, i) => i === index ? { name, series: data } : r)))
        .catch(err => { if (err.name !== 'AbortError') setRegions(list => list.map((r, i) => i === index ? { name, error: err.message } : r)); });
    });
    return () => controller.abort();
  }, [regionsRequested, meta, retry]);

  useEffect(() => {
    if (tab !== 'seasons' || period !== 'N' || !meta?.start || !meta?.end) return;
    const controller = new AbortController();
    setSeasonNight(null); setSeasonLoading(true); setSeasonError('');
    const params = new URLSearchParams({ bbox: bounds.join(','), start: meta.start, end: meta.end, daynight: 'N' });
    getJSON(`/series?${params}`, controller.signal).then(setSeasonNight).catch(err => {
      if (err.name !== 'AbortError') setSeasonError(err.message);
    }).finally(() => { if (!controller.signal.aborted) setSeasonLoading(false); });
    return () => controller.abort();
  }, [tab, period, meta, bounds, retry]);

  const applyBounds = values => { setBounds(values); setInputs(values.map(String)); setFormError(''); };
  const rows = series?.data || [];
  const noData = series?.has_data === false;
  const nightUnavailable = mode === 'harmonized' && period === 'N' && start < '2012-01';
  const available = rows.filter(row => row[metric] != null);
  const total = available.length ? available.reduce((sum, row) => sum + row[metric], 0) : null;
  const synthetic = meta?.synthetic || series?.synthetic || anomaly?.synthetic;
  const regionName = PRESETS.find(([,values]) => values.join(',') === bounds.join(','))?.[0] || 'Custom area';
  const latestMonth = meta?.latest_complete_month && meta.latest_complete_month < meta.end ? meta.latest_complete_month : meta?.end;
  const periodName = period === 'D' ? 'Daytime' : 'Nighttime';
  const openView = (nextView, nextTab) => { setView(nextView); if (nextTab) setTab(nextTab); };

  async function download() {
    setDownloading(true);
    try {
      const response = await fetch(`${API}/export.csv?${query}&metric=all`);
      if (!response.ok) throw new Error(`CSV export failed (${response.status}).`);
      const csv = withSelection(await response.text(), { regionName, bounds, start, end });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `hotspots-${start}-${end}-${period}-all${synthetic ? '-synthetic' : ''}.csv`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err.message); }
    finally { setDownloading(false); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); }
    catch { setCopied(false); setError('Copy the address bar to share this view; the browser blocked clipboard access.'); }
  }

  return <div className={`tool view-${view}`}>
    <header className="toolbar">
      <a className="brand" href="?view=about" onClick={event => { event.preventDefault(); openView('about'); }}><svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 2h20v20H2z M8.67 2v20 M15.33 2v20 M2 8.67h20 M2 15.33h20" fill="none" stroke="currentColor" strokeWidth="1.2"/><rect x="8.67" y="8.67" width="6.66" height="6.66" fill="#C24F00"/></svg><span>Hotspot Observatory<small>Harmonized satellite fire history</small></span></a>
      <Tabs items={VIEWS} active={view} onChange={openView} label="Views" className="view-tabs"/>
      <p className="toolbar-status">{meta ? <>{meta.country} · {meta.start}–{latestMonth} · {meta.calibration}</> : 'Loading record…'}</p>
    </header>
    {synthetic && <div className="synthetic-banner" role="status"><strong>Synthetic data</strong><span>Invented demonstration values. Not NASA observations. Not for scientific use.</span></div>}
    {error && <div className="error" role="alert">{error} <button onClick={() => setRetry(v => v + 1)}>Retry</button></div>}

    {view === 'explore' && <div className="workspace" id="panel-explore" role="tabpanel" aria-labelledby="tab-explore">
      <aside className="controls" aria-label="Analysis controls">
        <section className="control-group region-panel" aria-label="Current study area">
          <h2 className="control-title">Study area</h2>
          <div className="presets" aria-label="Study area presets">{PRESETS.map(([name, values]) => <button key={name} aria-pressed={regionName === name} onClick={() => applyBounds(values)}>{name}</button>)}</div>
          <div className="current-study-area"><p className="study-area-name" aria-live="polite">{regionName}</p><p className="bbox-readout">{bounds.map(v => `${v}°`).join(', ')} <span>(W, S, E, N)</span></p><p className="historical-record">Historical record: {monthLabel(meta?.start)} - {monthLabel(latestMonth)}</p></div>
          <details className="custom-coordinates"><summary>Custom coordinates</summary>
            <p id="coordinate-help" className="coordinate-help">Signed decimal degrees: negative longitude is west; negative latitude is south. You can also draw a rectangle on the map.</p>
            <form onSubmit={event => { event.preventDefault(); const message = validateBounds(inputs); setFormError(message); if (!message) applyBounds(inputs.map(Number)); }}>
              <div className="coordinate-grid">{[['West longitude', 'W', 0], ['East longitude', 'E', 2], ['South latitude', 'S', 1], ['North latitude', 'N', 3]].map(([label, short, index]) =>
                <label key={short}>{label}<div className="coordinate-input"><input aria-label={label} aria-describedby="coordinate-help" type="number" step="any" min={index % 2 ? -90 : -180} max={index % 2 ? 90 : 180} value={inputs[index]} onChange={event => setInputs(previous => previous.map((value, i) => i === index ? event.target.value : value))} required /><span aria-hidden="true">°</span></div></label>)}</div>
              {formError && <p className="field-error" role="alert">{formError}</p>}<button className="apply" type="submit">Update study area</button>
            </form>
          </details>
          <p className="coverage-note">The rectangle is a bounding box; only cells inside Argentina are counted.</p>
          <p className="small-area-warning">Calibration was validated nationally. Regional estimates have not been independently validated; small-area estimates are less reliable.</p>
        </section>
        <section className="control-group" aria-label="Series">
          <h2 className="control-title">Series</h2>
          <div className="mode-toggle" aria-label="Data scale">
            <button aria-pressed={mode === 'harmonized'} className={mode === 'harmonized' ? 'selected' : ''} onClick={() => setMode('harmonized')}>Harmonized</button>
            <button aria-pressed={mode === 'raw'} className={mode === 'raw' ? 'selected' : ''} onClick={() => setMode('raw')}>Raw</button></div>
          <div className="filter-grid"><label>Raw sensor<select value={sensor} onChange={event => setSensor(event.target.value)} disabled={mode !== 'raw'} aria-label="Raw sensor"><option value="raw_modis">MODIS Aqua</option><option value="raw_viirs">VIIRS S-NPP</option></select></label>
            <label>Acquisition<select value={period} onChange={event => setPeriod(event.target.value)} aria-label="Day or night"><option value="D">Daytime</option><option value="N">Nighttime</option></select></label></div>
          <p className="control-note">{mode === 'harmonized' ? 'VIIRS-scale record: observed VIIRS from 2012, MODIS-based estimates before 2012 and in outage months.' : 'Uncalibrated detections from one instrument; not comparable across instruments.'}</p>
        </section>
        <section className="control-group observation-controls" aria-label="Time window">
          <h2 className="control-title">Time window</h2>
          <div className="date-grid"><label>From<input type="month" aria-label="Start month" value={start} onChange={event => setStart(event.target.value)} /></label><label>To<input type="month" aria-label="End month" max={meta?.end} value={end} onChange={event => setEnd(event.target.value)} /></label></div>
          <div className="summary"><strong>{noData ? 'No data in this area' : format(total)}</strong><span>active cell-days · {available.length} available months · {LABELS[metric]}</span></div>
          <UnitNote compact/>
          {available.some(row => row.incomplete_metrics?.includes(metric)) && <p className="footnote quality-notice">This total includes incomplete observations; it can undercount activity. Inspect the ! months in the calendar.</p>}
          {available.some(row => row.nrt) && <p className="footnote">NRT months are provisional and may change on refresh.</p>}
        </section>
        <section className="control-group csv-row" aria-label="Export">
          <h2 className="control-title">Export</h2>
          <p>{regionName} · {start} to {end} · {periodName} · active cell-days. Harmonized and raw values, bounds, provenance, completeness flags and interval bounds; unavailable values stay blank.</p>
          <button className="export" title="Export all measurements and geographic selection metadata" onClick={download} disabled={!series || loading || downloading}>{downloading ? 'Preparing…' : 'Download CSV'}</button>
          <button className="secondary-button" onClick={copyLink} disabled={!meta}>{copied ? 'Link copied' : 'Copy link to this view'}</button>
        </section>
      </aside>

      <main className="stage" aria-label="Map and analyses">
        <section className="map-pane" aria-labelledby="map-title">
          <div className="pane-head"><h2 id="map-title" className="pane-title">{LABELS[metric]} active cell-days per 0.1° cell, {monthLabel(selected)}, {periodName.toLowerCase()}</h2>
            <span className="map-stats">{grid?.available ? <>{format(grid.count)} active cells · {format(grid.total)} cell-days nationally{grid.source && grid.source !== 'observed' ? ` · ${grid.source === 'backcast' ? 'back-cast' : 'gap-filled'} estimate: cells follow the MODIS footprint` : ''}{grid.nrt ? ' · provisional NRT' : ''}{grid.gap_flag ? ' · sensor gap flagged' : ''}</> : ''}</span></div>
          <div className="map-container">{meta ? <RegionMap bounds={bounds} onSelect={applyBounds} coverage={meta.coverage} grid={grid}/> : <div className="map-shell empty">Loading Argentina coverage…</div>}</div>
          <div className="map-unit"><UnitNote compact/></div>
          <div className="map-legend">
            {grid?.available && grid.count > 0 ? <div className="heat-scale" aria-label="Map colour scale"><span>Active cell-days in one 0.1° cell · square-root scale</span><div className="heat-ramp" style={{ background: `linear-gradient(to right, ${MAP_RAMP.join(',')})` }}/><div className="heat-ticks">{legendTicks(grid.max).map(tick => <span key={tick.position} style={{ left: `${tick.position * 100}%` }}>{format(tick.value)}</span>)}</div></div>
              : <p className="muted">{gridError || (grid && !grid.available ? `${LABELS[metric]} values are unavailable for ${monthLabel(selected)} (${periodName.toLowerCase()}); missing is not zero.` : grid ? 'No active cells this month.' : 'Loading map layer…')}</p>}
            <p className="figure-caption"><span><b>Source</b> Harmonized Parquet cells (/grid), {LABELS[metric]}</span><span><b>Period</b> {selected || '…'}, {periodName.toLowerCase()} overpasses</span></p>
          </div>
        </section>
        <Timeline rows={rows} metric={metric} metricLabel={LABELS[metric]} selected={selected} onSelect={setSelected} loading={loading} regionName={regionName} periodName={periodName.toLowerCase()}/>
        <section className="analysis" aria-label="Analyses">
          <Tabs items={TABS} active={tab} onChange={setTab} label="Analyses" className="analysis-tabs"/>
          <div className="analysis-body" id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === 'calendar' && <CalendarPanel rows={rows} metric={metric} mode={mode} period={period} selected={selected} onSelect={setSelected} loading={loading} noData={noData} nightUnavailable={nightUnavailable} hasHarmonized={meta?.has_harmonized} synthetic={synthetic} start={start} end={end}/>}
            {tab === 'seasons' && <SeasonComparison series={period === 'D' ? daytime : seasonNight} loading={period === 'D' ? dayLoading : seasonLoading} error={period === 'D' ? dayError : seasonError} start={meta?.start} end={latestMonth} regionName={regionName} period={period} onPeriodChange={setPeriod}/>}
            {tab === 'record' && <div id="history"><WhyHarmonize data={area} loading={areaLoading} error={areaError} monthly={daytime} monthlyLoading={dayLoading} monthlyError={dayError} regionName={regionName} compact /><AreaSummary data={area} loading={areaLoading} error={areaError}/></div>}
            {tab === 'trend' && <TimingTrend series={daytime} regionName={regionName} loading={dayLoading} error={dayError}/>}
            {tab === 'regions' && <RegionalComparison regions={regions}/>}
            {tab === 'sensors' && <div id="satellites"><SensorComparison daytime={daytime} loading={dayLoading} error={dayError} meta={meta} bounds={bounds} regionName={regionName} retry={retry} getJSON={getJSON}/></div>}
          </div>
        </section>
      </main>

      <aside className="inspector" aria-label="Selected month">
        <Inspector anomaly={anomaly} anomalyError={anomalyError} selected={selected} period={period} regionName={regionName} noData={noData} baseline={baseline} onBaseline={setBaseline}/>
      </aside>
    </div>}

    {view !== 'explore' && <main className="doc-view" id={`panel-${view}`} role="tabpanel" aria-labelledby={`tab-${view}`}>
      <div className="doc-inner">
        {view === 'about' && <Hero meta={meta} latestMonth={latestMonth} national={national} validation={validation} onOpen={openView}/>}
        {view === 'validation' && <section id="validation" aria-labelledby="validation-title"><h1 id="validation-title">Testing the calibration on years it never saw</h1><p className="lede">MODIS was calibrated to VIIRS on 2012–2019 and tested on later years held out of fitting. Scores are national; VIIRS is the reference instrument, not ground truth.</p><MethodPanel validation={validation} calibration={meta?.calibration}/></section>}
        {view === 'methods' && <section id="method" aria-labelledby="method-title"><h1 id="method-title">How the two records are put on one scale</h1><p className="lede">A calibration experiment: fit competing models on the years both satellites flew, choose one on held-out years, then use it only where VIIRS has no observations.</p><MethodSteps meta={meta} validation={validation}/></section>}
        {view === 'data' && <section id="data" aria-labelledby="data-title"><h1 id="data-title">Data sources</h1><p className="lede">Every value starts as a NASA FIRMS active-fire detection: a pixel where a satellite measured more heat than its surroundings.</p><DataSources validation={validation} meta={meta}/></section>}
        {view === 'limitations' && <section id="limitations" aria-labelledby="limitations-title"><h1 id="limitations-title">What this method cannot do yet</h1><p className="lede">These limits come from the validation results and diagnostics. Each marks where the record should be read with care, with the next step that would address it.</p><Limitations validation={validation} meta={meta}/></section>}
      </div>
      <footer className="site-footer">
        <p><b>Data</b> NASA FIRMS active fire: MODIS Collection 6.1 (Aqua, Terra) and VIIRS 375 m Collection 2 (Suomi-NPP, NOAA-20). Boundaries: Natural Earth. Basemap: OpenStreetMap contributors.</p>
        <p><b>Record</b> 0.1° grid · WGS84 · UTC · Calibration: {meta?.calibration || 'loading'}{meta?.contract && meta.contract !== 'unspecified' ? ` · ${meta.contract}` : ''}{synthetic ? ' · Synthetic demonstration' : ''}</p>
      </footer>
    </main>}
  </div>;
}
