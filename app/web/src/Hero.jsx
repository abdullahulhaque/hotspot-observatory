import { useEffect, useRef, useState } from 'react';
import Figure, { SERIES, fmtNumber } from './Figure.jsx';

const USE_CASES = [
  { id: 'seasons', title: 'Historical fire-season analysis', question: 'When and where does fire activity typically peak, and is that changing?', who: 'Climate scientists, fire researchers, environmental agencies' },
  { id: 'calendar', title: 'Fire-activity anomaly detection', question: 'Is this month unusually high or low compared with the same month in earlier years?', who: 'Fire analysts, monitoring agencies, early-warning teams' },
  { id: 'regions', title: 'Regional fire-risk research', question: 'Which areas have been persistently active, and in which months?', who: 'Emergency-response and fire-management agencies, climate modellers' },
];

// Figure 1: the national record joined naively at the 2012 sensor switch, against the
// harmonized record. All values are annual daytime totals from /area-summary.
function SpliceFigure({ national, validation }) {
  const container = useRef(null), [width, setWidth] = useState(900), [focus, setFocus] = useState(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(300, entry.contentRect.width)));
    observer.observe(container.current); return () => observer.disconnect();
  }, []);
  const rows = (national?.annual_daytime || []).filter(r => r.harmonized != null && r.naive_splice != null);
  const quantiles = validation?.interval_80?.leave_one_year_out?.annual_log_q10_q90;
  const annualCoverage = validation?.interval_80?.leave_one_year_out?.annual_test_coverage;
  const testYears = validation?.interval_80?.test_years_n;
  const narrow = width < 560;
  const W = width, H = narrow ? 300 : 360, L = narrow ? 50 : 66, R = narrow ? 12 : 128, T = 22, B = 50;
  const first = rows[0]?.year, last = rows.at(-1)?.year;
  const max = Math.max(1, ...rows.flatMap(r => [r.naive_splice, r.harmonized * (quantiles ? Math.exp(quantiles[1]) : 1)])) * 1.06;
  const x = year => L + (year - first) / Math.max(1, last - first) * (W - L - R);
  const y = value => H - B - value / max * (H - T - B);
  const line = (points, key) => points.map((r, i) => `${i ? 'L' : 'M'}${x(r.year)},${y(r[key])}`).join(' ');
  const modis = rows.filter(r => r.year < 2012), viirs = rows.filter(r => r.year >= 2012);
  const backcast = rows.filter(r => r.year < 2012);
  const at = year => rows.find(r => r.year === year);
  const before = at(2011), after = at(2012);
  const naiveStep = before && after ? after.naive_splice / before.naive_splice : null;
  const harmonizedStep = before && after ? after.harmonized / before.harmonized : null;
  const ticks = rows.filter(r => r.year === first || r.year === last || (r.year % (narrow ? 10 : 5) === 0 && r.year - first > 1 && last - r.year > 1));
  const yTicks = [0, .25, .5, .75, 1].map(f => f * max);
  const band = quantiles && backcast.length ? `${backcast.map((r, i) => `${i ? 'L' : 'M'}${x(r.year)},${y(r.harmonized * Math.exp(quantiles[1]))}`).join(' ')} ${[...backcast].reverse().map(r => `L${x(r.year)},${y(r.harmonized * Math.exp(quantiles[0]))}`).join(' ')} Z` : '';
  const active = focus != null ? at(focus) : null;
  if (!rows.length) return <div className="figure-empty" ref={container}>{national?.error || 'Loading the national record…'}</div>;
  return <div ref={container}>
    <div className="chart-key" aria-hidden="true">
      <span><i className="key-line" style={{ background: SERIES.modis }}/>Raw MODIS, 2003–2011</span>
      <span><i className="key-line" style={{ background: SERIES.viirs }}/>Raw VIIRS, 2012 onward</span>
      <span><i className="key-line key-dashed"/>Harmonized, back-cast from MODIS</span>
      <span><i className="key-line" style={{ background: SERIES.harmonized }}/>Harmonized, observed VIIRS</span>
      {band && <span><i className="key-band"/>80% interval, back-cast years</span>}
    </div>
    <svg className="chart hero-chart" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Annual daytime active cell-days for Argentina: the two instruments joined at 2012, against the harmonized record">
      {yTicks.map(v => <g key={v}><line className="gridline" x1={L} x2={W - R} y1={y(v)} y2={y(v)}/><text className="tick" x={L - 8} y={y(v) + 4} textAnchor="end">{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 0 }).format(v)}</text></g>)}
      {ticks.map(r => <text className="tick" key={r.year} x={x(r.year)} y={H - B + 18} textAnchor="middle">{r.year}</text>)}
      <text className="axis-title" x={(L + W - R) / 2} y={H - 6} textAnchor="middle">Year (UTC)</text>
      <text className="axis-title" transform={`translate(13 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle">Active cell-days per year</text>
      <line className="axis-line" x1={L} x2={W - R} y1={H - B} y2={H - B}/>
      <g className="sensor-switch"><line x1={(x(2011) + x(2012)) / 2} x2={(x(2011) + x(2012)) / 2} y1={T} y2={H - B}/><text x={(x(2011) + x(2012)) / 2 + 6} y={T + 10}>Sensor switch, 2012</text></g>
      {band && <path className="interval-area" d={band}/>}
      <path d={line(modis, 'naive_splice')} fill="none" stroke={SERIES.modis} strokeWidth="2.25"/>
      <path d={line(viirs, 'naive_splice')} fill="none" stroke={SERIES.viirs} strokeWidth="2.25"/>
      {before && after && <line x1={x(2011)} y1={y(before.naive_splice)} x2={x(2012)} y2={y(after.naive_splice)} stroke={SERIES.muted} strokeWidth="1.5" strokeDasharray="2 3"/>}
      <path d={line(backcast.concat(rows.filter(r => r.year === 2012)), 'harmonized')} fill="none" stroke={SERIES.harmonized} strokeWidth="2.5" strokeDasharray="6 4"/>
      <path d={line(viirs, 'harmonized')} fill="none" stroke={SERIES.harmonized} strokeWidth="2.5"/>
      {!narrow && <>
        <text className="direct-label" x={W - R + 8} y={y(viirs.at(-1).naive_splice) + 4} fill={SERIES.viirs}>Raw VIIRS</text>
        <text className="direct-label" x={W - R + 8} y={y(viirs.at(-1).harmonized) + (Math.abs(viirs.at(-1).harmonized - viirs.at(-1).naive_splice) < max * .05 ? 18 : 4)}>Harmonized</text>
      </>}
      {rows.map(r => <g key={r.year} className="hit" tabIndex="0" role="img"
        aria-label={`${r.year}: raw ${r.year < 2012 ? 'MODIS' : 'VIIRS'} ${fmtNumber(r.naive_splice, 0)}, harmonized ${fmtNumber(r.harmonized, 0)} active cell-days${r.year < 2012 ? ', back-cast estimate' : ''}`}
        onFocus={() => setFocus(r.year)} onBlur={() => setFocus(null)} onPointerEnter={() => setFocus(r.year)} onPointerLeave={() => setFocus(null)}>
        <rect x={x(r.year) - (W - L - R) / (2 * Math.max(1, last - first))} y={T} width={(W - L - R) / Math.max(1, last - first)} height={H - B - T} fill="transparent"/>
        <circle cx={x(r.year)} cy={y(r.naive_splice)} r={focus === r.year ? 4.5 : 2.5} fill={r.year < 2012 ? SERIES.modis : SERIES.viirs}/>
        <circle cx={x(r.year)} cy={y(r.harmonized)} r={focus === r.year ? 4.5 : 2.5} fill={r.year < 2012 ? '#fff' : SERIES.harmonized} stroke={SERIES.harmonized} strokeWidth="1.5"/>
      </g>)}
    </svg>
    <p className="readout" aria-live="polite">{active ? <><b>{active.year}</b> raw {active.year < 2012 ? 'MODIS' : 'VIIRS'} {fmtNumber(active.naive_splice, 0)} · harmonized {fmtNumber(active.harmonized, 0)} active cell-days{active.year < 2012 && quantiles ? ` (80% interval ${fmtNumber(active.harmonized * Math.exp(quantiles[0]), 0)}–${fmtNumber(active.harmonized * Math.exp(quantiles[1]), 0)})` : ''}</> : 'Hover or focus a year to read its values.'}</p>
    {naiveStep != null && <p className="hero-finding">Joining the raw records multiplies activity by <strong>{fmtNumber(naiveStep, 2)}×</strong> from 2011 to 2012, the year the sensor changes. On the harmonized scale the same step is <strong>{fmtNumber(harmonizedStep, 2)}×</strong>.</p>}
    {band && <p className="figure-note-inline">The shaded band is the annual 80% prediction interval for back-cast years, from leave-one-year-out residuals. On held-out years it contained {annualCoverage != null && testYears ? `${Math.round(annualCoverage * testYears)} of ${testYears}` : 'an unreported share of'} annual totals, so it is narrower than its nominal level.</p>}
    <details className="figure-data"><summary>Figure 1 data</summary><div className="table-scroll"><table><thead><tr><th scope="col">Year</th><th scope="col">Raw sensor</th><th scope="col">Raw active cell-days</th><th scope="col">Harmonized active cell-days</th><th scope="col">Harmonized source</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.year}><th scope="row">{r.year}</th><td>{r.year < 2012 ? 'MODIS Aqua' : 'VIIRS S-NPP'}</td><td>{fmtNumber(r.naive_splice)}</td><td>{fmtNumber(r.harmonized)}</td><td>{r.year < 2012 ? 'Back-cast from MODIS' : 'Observed VIIRS'}{r.gap_flag ? ', includes gap-flagged months' : ''}</td></tr>)}</tbody></table></div></details>
  </div>;
}

export default function Hero({ meta, latestMonth, national, validation, onOpen }) {
  const constantRatio = validation?.status === 'ready' ? validation.model_a_ratio : null;
  return <section id="question" className="about" aria-labelledby="question-title">
    <div>
      <h1 id="question-title">Did fire activity in Argentina jump in 2012, or did the satellite change?</h1>
      <p className="hero-subhead">NASA has detected fires from orbit with MODIS since 2002 and with the sharper VIIRS instrument since 2012. Over the years both flew, 2012–2019, VIIRS recorded {constantRatio ? `${fmtNumber(constantRatio, 2)} times` : 'several times'} as many active cell-days over Argentina as MODIS, so a record that switches instruments shows a rise that did not happen on the ground. We put both instruments on one scale, test that calibration on years it never saw, and publish a single monthly record of fire activity.</p>
      <p className="hero-note">Current coverage: {meta?.country || 'Argentina'}, {meta?.start?.slice(0, 4) || '2003'}–{latestMonth?.slice(0, 4) || '2026'} · More regions planned</p>
      <details className="measurement-explanation"><summary>Data and methods</summary><p>Argentina is divided into 0.1° geographic grid cells. Each cell with at least one hotspot detection on a day contributes one active cell-day. The same cell can count again on another day. This measures satellite-detected activity, not unique fires or burned area.</p></details>
      <Figure number={1} className="hero-figure" title="Argentina's daytime fire record: the two instruments joined at 2012, versus harmonized"
        source="NASA FIRMS MODIS C6.1 (Aqua) and VIIRS 375 m C2 (S-NPP), processed to active 0.1° cell-days"
        period={national?.annual_daytime?.length ? `${national.annual_daytime.filter(r => r.harmonized != null)[0]?.year}–${national.annual_daytime.filter(r => r.harmonized != null).at(-1)?.year}, complete years (record ${national.start} to ${national.end})` : 'Loading…'}>
        <SpliceFigure national={national} validation={validation}/>
      </Figure>
      <div className="question-grid">
        <div><h2 className="minor-heading">Research question</h2><p>Can MODIS observations be calibrated to the VIIRS scale accurately enough to give one continuous monthly record of satellite-detected fire activity for Argentina from 2003, and how well does that calibration hold on years it was not fitted to?</p></div>
        <div><h2 className="minor-heading">Why it matters</h2><p>Long records are how scientists separate normal fire seasons from unusual ones. A false step at 2012 would make any trend, anomaly or seasonal comparison that spans the switch wrong.</p></div>
      </div>
      <h2 className="minor-heading">Who it helps</h2>
      <ol className="use-cases">{USE_CASES.map(item => <li key={item.id}><h3>{item.title}</h3><p className="use-question">{item.question}</p><p className="use-who">{item.who}</p><button className="link-button" onClick={() => onOpen?.('explore', item.id)}>Open this analysis in Explore</button></li>)}</ol>
      <p className="about-next"><button className="secondary-button" onClick={() => onOpen?.('explore')}>Open the explorer</button> <button className="link-button" onClick={() => onOpen?.('methods')}>Read the method</button></p>
    </div>
  </section>;
}
