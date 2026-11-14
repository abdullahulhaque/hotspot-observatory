const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const format = value => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
export default function AreaSummary({ data, loading, error }) {
  return <section className="panel area-summary"><h3>Area summary</h3>
    <p className="muted">Harmonized · {data?.daynight === 'N' ? 'Nighttime' : 'Daytime'} · Full record {data?.start}–{data?.end}</p>
    {error ? <p className="field-error">{error}</p> : loading ? <p className="muted">Loading area summary…</p> : !data?.has_data ? <p className="muted">No data in this area</p> : !data.top_years.length ? <p className="muted">No complete years available for ranking.</p> : <>
      <div className="area-summary-content"><div><h3>Top 5 years by annual activity</h3>
      <ol className="top-years">{data.top_years.map(row => <li key={row.year}><span>{row.year}{row.gap_flag && <small title="Includes sensor-gap months"> △</small>}</span><strong>{format(row.harmonized)}</strong></li>)}</ol>
      <p className="footnote">active cell-days per year</p>
      </div><div><h3>Peak calendar month on average</h3>
      <div className="peak-month"><strong>{data.peak_ties.map(month => MONTHS[month - 1]).join(' / ')}</strong><span>{format(data.peak_month.mean)} active cell-days on average</span></div>
      </div></div><p className="footnote">{data.complete_years} years with 12 available harmonized months. Partial years excluded; flagged months retained. This summary uses the full record, independent of the displayed date window.</p>
    </>}
  </section>;
}
