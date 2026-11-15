import { CIVIDIS, heatColor, legendTicks } from './heatScale.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LABELS = { raw_modis: 'MODIS Aqua', raw_viirs: 'VIIRS Suomi-NPP', harmonized: 'Harmonized' };
const format = value => value == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
const monthKey = row => `${row.year}-${String(row.month).padStart(2, '0')}`;

// Year × month heatmap of the active series for the study area. Selecting a cell sets the month.
export default function CalendarPanel({ rows, metric, mode, period, selected, onSelect, loading, noData, nightUnavailable, hasHarmonized, synthetic, start, end }) {
  const lookup = new Map(rows.map(row => [monthKey(row), row]));
  const years = [...new Set(rows.map(row => row.year))];
  const max = Math.max(0, ...rows.map(row => row[metric] ?? 0));
  return <section className="calendar-panel" aria-labelledby="calendar-title">
    <div className="pane-head"><h3 id="calendar-title" className="pane-title">Monthly activity calendar</h3><span className="calendar-description"><span>{LABELS[metric]} · {period === 'D' ? 'Daytime' : 'Nighttime'} · active cell-days</span><span>Select a month to inspect</span></span></div>
    <p className="calendar-scroll-hint">Scroll horizontally to inspect all twelve months.</p>
    {mode === 'harmonized' && !hasHarmonized && <div className="info">Harmonized values are unavailable. Missing values are not zero.</div>}
    {nightUnavailable && <div className="info" role="status">Nighttime harmonized is unavailable before 2012. No night back-cast is produced; these months are missing, not zero.</div>}
    <div className="calendar-scroll" aria-busy={loading}>
      {loading ? <div className="empty">Loading monthly activity…</div> : noData ? <div className="empty">No data in this area</div> : !rows.some(r => r[metric] != null) ? <div className="empty">{nightUnavailable ? 'Nighttime harmonized is unavailable before 2012' : 'No data for this sensor in this date range'}</div> :
        <div className="calendar" role="group" aria-label="Year by month activity heatmap">
          <div className="calendar-row month-labels"><span>Year</span>{MONTHS.map(month => <span key={month}>{month}</span>)}</div>
          {years.map(year => <div className="calendar-row" key={year}><span className="year-label">{year}</span>{MONTHS.map((month, index) => {
            const key = `${year}-${String(index + 1).padStart(2, '0')}`, row = lookup.get(key), value = row?.[metric];
            const color = heatColor(value, max);
            const source = mode === 'harmonized' ? row?.source : 'observed';
            const provenance = mode === 'harmonized' ? source === 'backcast' ? 'Back-cast estimate from MODIS' : source === 'gapfill' ? 'Gap-filled estimate from MODIS' : 'Observed VIIRS' : `Observed ${LABELS[metric]}`;
            const completeness = !row ? 'Outside selected date range' : value == null ? 'Unavailable' : row.incomplete_metrics?.includes(metric) ? 'Incomplete observations' : !row.quality_available ? 'Coverage metadata unavailable' : mode === 'harmonized' && source !== 'observed' ? 'MODIS input coverage complete' : 'Complete observation coverage';
            const description = `${month} ${year} · ${value == null ? 'Unavailable' : `${format(value)} active cell-days · ${provenance}`} · ${completeness}${mode === 'harmonized' && source !== 'observed' && row?.incomplete_metrics?.includes('raw_viirs') ? ' · Raw VIIRS incomplete' : ''}${row?.gap_flag ? ' · Sensor gap flagged' : ''}${row?.nrt ? ' · NRT · provisional' : ''}${synthetic ? ' · Synthetic data' : ''}`;
            const light = value != null && max > 0 && Math.sqrt(value / max) > .6;
            return <button key={key} disabled={!row} className={`cell ${value == null ? 'missing' : ''} ${light ? 'on-light' : ''} ${source === 'backcast' ? 'backcast' : source === 'gapfill' ? 'gapfill' : ''} ${row?.gap_flag ? 'gap-flag' : ''} ${row?.incomplete_metrics?.includes(metric) ? 'incomplete-cell' : ''} ${row?.nrt ? 'nrt-cell' : ''} ${selected === key ? 'chosen' : ''}`}
              style={{ backgroundColor: color }} onClick={() => onSelect(key)} aria-pressed={selected === key}
              aria-label={`${month} ${year}: ${description.slice(`${month} ${year} · `.length)}`}
              title={description}><span className="source-symbol" aria-hidden="true">{source === 'backcast' ? '•' : source === 'gapfill' ? '◆' : ''}</span>{row?.gap_flag && <span className="gap-symbol" aria-hidden="true">△</span>}{row?.incomplete_metrics?.includes(metric) && <span className="incomplete-symbol" aria-hidden="true">!</span>}{row?.nrt && <span className="nrt-symbol" aria-hidden="true">N</span>}</button>;
          })}</div>)}
        </div>}
    </div>
    <div className="calendar-foot">
      <div className="heat-scale" aria-label="Square-root cividis colour scale"><span>active cell-days · square-root scale</span><div className="heat-ramp" style={{ background: `linear-gradient(to right, ${CIVIDIS.join(',')})` }} /><div className="heat-ticks">{legendTicks(max).map(tick => <span key={tick.position} style={{ left: `${tick.position * 100}%` }}>{format(tick.value)}</span>)}</div></div>
      <div className="legend"><span className="missing-key" /> <span>Unavailable</span><span>Observed: unmarked</span>{mode === 'harmonized' && <><span>• Back-cast estimate</span><span>◆ Gap-filled estimate</span></>}<span>△ Sensor gap flagged</span><span>! Incomplete observations</span><span>N Near-real-time (provisional)</span></div>
    </div>
    <p className="figure-caption"><span><b>Source</b> {LABELS[metric]} monthly totals for the study area (/series)</span><span><b>Period</b> {start} to {end}, {period === 'D' ? 'daytime' : 'nighttime'}</span></p>
  </section>;
}
