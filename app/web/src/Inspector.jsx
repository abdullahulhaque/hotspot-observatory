import MonthQuality from './MonthQuality.jsx';
import { AnomalyContext } from './Analyses.jsx';
import { comparisonBlocked } from './provenance.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const format = value => value == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
const monthLabel = value => value ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`)) : 'Loading…';

// Selected-month analysis: harmonized value against same-month history in earlier years.
export default function Inspector({ anomaly, anomalyError, selected, period, regionName, noData }) {
  const anomalyRow = anomaly?.data?.[0];
  const stats = anomalyRow?.metrics?.harmonized;
  const monthShort = selected ? MONTHS[Number(selected.slice(5)) - 1] : '';
  return <section className="panel anomaly-panel" aria-label="Selected-month analysis">
    <div className="anomaly-title"><h2>Selected-month analysis</h2><span className="month-pill">{selected}</span></div>
    <p className="anomaly-region">{regionName} · {monthLabel(selected)}</p>
    <p className="muted anomaly-series">Series used: Harmonized · {period === 'D' ? 'Daytime' : 'Nighttime'}</p>
    {anomalyRow && !noData && <p className="anomaly-source footnote">{anomalyRow.source === 'backcast' ? '• Selected month is back-cast from MODIS.' : anomalyRow.source === 'gapfill' ? '◆ Selected month is gap-filled from MODIS.' : stats?.value == null ? 'Selected harmonized value is unavailable.' : 'Selected month uses observed VIIRS.'}{anomalyRow.gap_flag ? ' △ Sensor gap flagged.' : ''}</p>}
    {noData ? <p className="muted">No data in this area</p> : anomalyError ? <p className="field-error" role="alert">{anomalyError}</p> : !stats ? <p className="muted">Loading historical comparison…</p> : <>
      <div className="comparison"><div><span>Harmonized activity</span><strong>{format(stats.value)}</strong></div><div><span>Historical median</span><strong>{format(stats.historical_median)}</strong></div><div><span>Absolute difference</span><strong>{stats.difference > 0 ? '+' : ''}{format(stats.difference)}</strong></div></div><p className="footnote">active cell-days</p>
      <div className="anomaly-number">{stats.percent_change == null ? '—' : `${stats.percent_change > 0 ? '+' : ''}${format(stats.percent_change)}%`}</div>
      <p className="anomaly-caption">{comparisonBlocked(stats) ? 'Comparison withheld: incomplete observations or unavailable coverage metadata.' : stats.historical_median === 0 ? 'Percent change is undefined for a zero baseline.' : stats.value == null ? (period === 'N' && selected < '2012-01' ? 'Nighttime harmonized is unavailable before 2012.' : 'Selected harmonized value unavailable.') : stats.sample_size === 0 ? 'No earlier years available for this month.' : 'relative to the historical monthly median'}</p>
      <p className="anomaly-rank">{stats.rank == null ? (comparisonBlocked(stats) ? 'Rank withheld' : 'Rank unavailable') : `${stats.rank_tied ? 'Tied rank' : 'Rank'} ${stats.rank} of ${stats.rank_count} ${monthShort} records`}</p>
      <p className="footnote">1 = highest. Rank includes this month and the earlier same-calendar-month records; ties share a rank.</p>
      <AnomalyContext stats={stats} monthLabel={monthShort} blocked={comparisonBlocked(stats)}/>
      <p className="footnote baseline-definition">{stats.sample_size} earlier {monthShort} {stats.sample_size === 1 ? 'record' : 'records'}{stats.sample_size > 0 ? ` (${stats.baseline_years[0]}–${stats.baseline_years.at(-1)})` : ''}. Median uses Harmonized values for this calendar month in earlier years; the target year, unavailable months and known incomplete observations are excluded. The baseline is independent of the displayed date window. Estimates remain included with model uncertainty.</p>
      {stats.sample_size > 0 && <details className="baseline-years"><summary>Included baseline years</summary><p>{stats.baseline_years.join(', ')}</p></details>}
    </>}
    {!noData && <MonthQuality row={anomalyRow} interval={anomaly?.interval}/>}
  </section>;
}
