import { useEffect, useRef, useState } from 'react';
import Figure, { SERIES, fmtNumber } from './Figure.jsx';
import { DetailValue } from './MethodPanel.jsx';

const title = id => String(id || 'Details').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const toMinutes = text => { const [h, m] = String(text).split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };
const clock = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(Math.round(minutes % 60)).padStart(2, '0')}`;

// Figure 5: median daytime overpass, local solar time, by year and satellite, with
// the interquartile range of detection times. From validation.json diagnostic_table.
function OverpassFigure({ rows }) {
  const ref = useRef(null), [width, setWidth] = useState(800);
  useEffect(() => { const o = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width))); o.observe(ref.current); return () => o.disconnect(); }, []);
  const data = rows.filter(r => r.median_day_local_solar_min != null).map(r => ({ ...r, lo: toMinutes(r.iqr_day_local_solar_time?.[0]), hi: toMinutes(r.iqr_day_local_solar_time?.[1]) }));
  const years = data.map(r => r.year), first = Math.min(...years), last = Math.max(...years);
  const W = width, H = 260, L = 62, R = 14, T = 14, B = 46;
  const lo = Math.min(...data.map(r => r.lo ?? r.median_day_local_solar_min)) - 5, hi = Math.max(...data.map(r => r.hi ?? r.median_day_local_solar_min)) + 5;
  const x = (year, offset = 0) => L + (year - first + .5 + offset) / (last - first + 1) * (W - L - R);
  const y = m => H - B - (m - lo) / (hi - lo) * (H - T - B);
  const sensors = [['MODIS Aqua', SERIES.modis, -0.15], ['VIIRS S-NPP', SERIES.viirs, 0.15]];
  const ticks = []; for (let m = Math.ceil(lo / 15) * 15; m <= hi; m += 15) ticks.push(m);
  return <div ref={ref}>{!data.length ? <p className="muted">Overpass diagnostics are not reported.</p> : <>
    <div className="chart-key">{sensors.map(([name, color]) => <span key={name}><i className="key-swatch round" style={{ background: color }}/>{name} median, bar = middle 50% of detections</span>)}<span><i className="key-band light"/>Calibration years</span></div>
    <svg className="chart overpass-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Median daytime overpass time by year for MODIS Aqua and VIIRS S-NPP; Aqua moves later from 2023">
      <rect className="training-band" x={x(2012, -.5)} width={x(2019, .5) - x(2012, -.5)} y={T} height={H - B - T}/>
      {ticks.map(m => <g key={m}><line className="gridline" x1={L} x2={W - R} y1={y(m)} y2={y(m)}/><text className="tick" x={L - 8} y={y(m) + 4} textAnchor="end">{clock(m)}</text></g>)}
      {years.filter((v, i, a) => a.indexOf(v) === i && (v === first || v === last || v % (width < 560 ? 10 : 5) === 0)).map(v => <text className="tick" key={v} x={x(v)} y={H - B + 18} textAnchor="middle">{v}</text>)}
      <text className="axis-title" x={(L + W - R) / 2} y={H - 6} textAnchor="middle">Year</text>
      <text className="axis-title" transform={`translate(13 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle">Local solar time (h:min)</text>
      {sensors.map(([name, color, offset]) => data.filter(r => r.sensor === name).map(r => <g key={`${name}${r.year}`}>
        {r.lo != null && r.hi != null && <line x1={x(r.year, offset)} x2={x(r.year, offset)} y1={y(r.lo)} y2={y(r.hi)} stroke={color} strokeWidth="1.5" opacity=".55"/>}
        <circle cx={x(r.year, offset)} cy={y(r.median_day_local_solar_min)} r="3.5" fill={color}><title>{name} {r.year}: median {r.median_day_local_solar_time}, middle 50% {r.iqr_day_local_solar_time?.join('–')}</title></circle>
      </g>))}
    </svg>
    <details className="figure-data"><summary>Figure 5 data</summary><div className="table-scroll"><table><thead><tr><th scope="col">Satellite</th><th scope="col">Year</th><th scope="col">Median overpass</th><th scope="col">Middle 50%</th><th scope="col">Product version (detections)</th></tr></thead><tbody>{data.map(r => <tr key={`${r.sensor}${r.year}`}><th scope="row">{r.sensor}</th><td>{r.year}</td><td>{r.median_day_local_solar_time}</td><td>{r.iqr_day_local_solar_time?.join('–')}</td><td>{r.version ? Object.entries(r.version).map(([k, v]) => `${k} (${fmtNumber(v, 0)})`).join(', ') : '—'}</td></tr>)}</tbody></table></div></details>
  </>}</div>;
}

export default function Limitations({ validation, meta }) {
  const ready = validation?.status === 'ready';
  const limitations = ready && Array.isArray(validation.known_limitations) ? validation.known_limitations : [];
  const drift = limitations.find(item => item?.id === 'aqua_overpass_drift');
  const diagnostic = limitations.find(item => item?.id === 'diagnostic_table')?.rows || [];
  const excess = meta?.modelled_cells_exceeding_days;
  return <>
    <ul className="limitations-summary">
      <li><b>Validated nationally, against another satellite.</b> Held-out scores measure agreement with VIIRS for all of Argentina. They are not checks against ground-truth fires, and no region was validated on its own.</li>
      <li><b>The calibration weakens after 2022.</b> Model B was fitted while both satellites crossed at about the same time of day. From 2023 Aqua crosses later (Figure 5) and held-out error grows (Validation, Figure 4). Modelled months from 2023 (2024-07, 2026-07) are likely too high.</li>
      <li><b>Intervals are too narrow.</b> The nominal 80% intervals contained {ready && validation.monthly_interval_coverage != null ? `${fmtNumber(100 * validation.monthly_interval_coverage, 1)}%` : 'an unreported share'} of held-out months. Monthly intervals must not be summed into annual bands.</li>
      <li><b>Modelled maps follow MODIS.</b> Back-cast and gap-filled cells are MODIS cells scaled up, so places only VIIRS would see stay at zero.{excess?.count ? ` ${fmtNumber(excess.count, 0)} modelled cell-months in ${excess.months} months exceed the number of days in their month (maximum ${fmtNumber(excess.max, 1)}), so modelled cell values are relative activity, not literal day counts.` : ''}</li>
      <li><b>Missing and provisional data stay labelled.</b> Months with sensor outages are flagged, confirmed missing S-NPP days are listed, and near-real-time months may change when NASA reprocesses them. Comparisons that would use incomplete observations are withheld.</li>
      <li><b>The unit is not fires or area burned.</b> One large fire can occupy many cells; a fire on a cell boundary counts in each cell it touches.</li>
    </ul>
    {drift && <p className="drift-notice">The metadata reports Aqua overpass drift since 2023{limitations.some(item => item?.id === 'modis_version_change') && ' and a coincident MODIS version change'}. These diagnostics do not prove that timing changes caused the deterioration.</p>}
    <Figure number={5} title="When each satellite observed Argentina: median daytime overpass by year" source="FIRMS archive acquisition times, converted to local solar time (out/validation.json, diagnostic_table)" period={diagnostic.length ? `${Math.min(...diagnostic.map(r => r.year))}–${Math.max(...diagnostic.map(r => r.year))}` : 'Not reported'}>
      <OverpassFigure rows={diagnostic}/>
    </Figure>
    {!limitations.length && <p className="muted">Known limitations have not been supplied in the validation file.</p>}
    <h3 className="minor-heading">Documented limitations</h3>
    <div className="limitation-list">{limitations.map((item, i) => <details key={i}><summary>{typeof item === 'string' ? item : title(item.id)}</summary>{typeof item !== 'string' && <DetailValue value={Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'id'))}/>}</details>)}</div>
    <h3 className="minor-heading">Next steps</h3>
    <ol className="next-steps">
      <li><b>Correct for the overpass drift.</b> Refit with overpass time as a covariate, or recalibrate on 2023 onward, then re-score on later held-out years.</li>
      <li><b>Validate regions independently.</b> Hold out regions as well as years, and compare against independent burned-area products where they exist.</li>
      <li><b>Widen the intervals honestly.</b> Calibrate interval width on held-out years so measured coverage reaches the nominal level.</li>
      <li><b>Add NOAA-20 and later VIIRS satellites</b> to reduce single-satellite outages, and extend coverage beyond Argentina.</li>
      <li><b>Map modelled months with a VIIRS-like footprint</b> instead of scaled MODIS cells, so modelled maps stay within physical day counts.</li>
    </ol>
    <p className="night-note">Harmonized nighttime activity uses VIIRS only from 2012; it is not back-cast.</p>
  </>;
}
