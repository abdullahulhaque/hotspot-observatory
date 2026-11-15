import { qualityLabel } from './provenance.js';
const fmt = value => value?.toLocaleString('en', { maximumFractionDigits: 1 });
export default function MonthQuality({ row, interval }) {
  if (!row) return null;
  const available = row.metrics?.harmonized?.value != null;
  return <div className="month-quality">
    <p className="provenance-badges">{available ? qualityLabel(row) : 'Harmonized value unavailable'}</p>
    {row.nrt && <p className="footnote">This month includes provisional near-real-time data for at least one sensor. Values may change on refresh. NRT is separate from observed versus estimated provenance.</p>}
    {row.missing_snpp_days > 0 && <><p className="quality-notice">{row.missing_snpp_days} confirmed missing S-NPP days. {row.incomplete ? 'This observation is an undercount. Anomaly percentage, difference and rank are withheld.' : 'Raw VIIRS is incomplete; the daytime harmonized value is a model estimate.'}</p><details className="footnote"><summary>Missing dates</summary>{row.missing_snpp_dates.join(', ')}</details></>}
    {row.incomplete && !row.missing_snpp_days && <p className="quality-notice">The sensor supplying this value has missing coverage. Anomaly percentage, difference and rank are withheld.</p>}
    {!row.quality_available && <p className="quality-notice">Coverage metadata is unavailable. Anomaly interpretation is withheld until it can be checked.</p>}
    {available && row.source !== 'observed' && <div className="prediction-interval">
      <strong>Nominal {interval?.nominal_coverage != null ? `${100 * interval.nominal_coverage}%` : '80%'} prediction interval</strong>
      <p>{row.lo80 == null ? 'Interval unavailable' : `${fmt(row.lo80)}–${fmt(row.hi80)} active cell-days`}</p>
      {interval?.monthly_coverage != null && <p className="footnote">Measured national monthly coverage: {(100 * interval.monthly_coverage).toFixed(1)}%{interval.nominal_coverage != null && interval.monthly_coverage < interval.nominal_coverage ? ', below the nominal target' : ''}. Regional coverage has not been independently validated.</p>}
      <details><summary>Interval interpretation</summary><p className="footnote">{interval?.note}</p><p className="footnote">Held-out years: {interval?.test_years?.join(', ') || 'not reported'}. Live-year estimates were not tested. Modelled spatial activity follows MODIS detections; locations detected only by VIIRS can have zero estimates.</p></details>
    </div>}
    {row.limitations?.filter(item => item.status).map(item => <p className="quality-notice" key={item.id}>{item.status}.</p>)}
    {row.limitations?.length > 0 && <details className="month-limitations"><summary>Limitations for this month</summary>{row.limitations.map(item => <p className="footnote" key={item.id}>{item.finding} <em>Any totals quoted here describe Argentina nationally, not a custom region.</em></p>)}</details>}
    {available && !row.incomplete && row.source !== 'observed' && <p className="footnote">The comparison and rank use an estimated value, not a complete VIIRS observation.</p>}
  </div>;
}
