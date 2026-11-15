// Table 1: every input used, with provider, resolution, the period actually read
// (from validation.json acquisition spans and the live-year fetch log) and processing.
const span = (spans, sensor, first, last) => {
  const a = spans?.[`${sensor} ${first}`]?.[0], b = spans?.[`${sensor} ${last}`]?.[1];
  return a && b ? `${a} to ${b}` : 'Not reported';
};
const requested = (fetch, sensor, source) => fetch?.[sensor]?.sources?.[source]?.requested?.join(' to ');

export default function DataSources({ validation, meta }) {
  const ready = validation?.status === 'ready';
  const spans = ready ? validation.acq_date_spans : null;
  const live = ready ? validation.live_year : null;
  const fetch = live?.fetch;
  const outageDays = live?.snpp_coverage_check?.days?.length;
  const rows = [
    { name: 'MODIS active fire, Collection 6.1 (MCD14ML), Aqua satellite', provider: 'NASA FIRMS yearly country archive, standard processing',
      resolution: '≈ 1 km pixel at nadir; afternoon orbit', period: span(spans, 'MODIS', 2003, 2025),
      processing: 'Aqua only; confidence ≥ 30; type 0 (presumed vegetation fire). Back-cast input 2003–2011, calibration input 2012–2019, gap-fill input.' },
    { name: 'VIIRS 375 m active fire, Collection 2 (VNP14IMGML), Suomi-NPP satellite', provider: 'NASA FIRMS yearly country archive, standard processing',
      resolution: '375 m pixel; afternoon orbit', period: span(spans, 'VIIRS', 2012, 2025),
      processing: 'S-NPP only; confidence not "low"; type 0. Reference scale for the harmonized record; observed values from 2012.' },
    { name: 'Live year 2026: MODIS and VIIRS S-NPP, standard then near-real-time', provider: 'NASA FIRMS area API (MODIS_SP / MODIS_NRT, VIIRS_SNPP_SP / VIIRS_SNPP_NRT)',
      resolution: 'As above', period: fetch ? `MODIS standard ${requested(fetch, 'MODIS', 'MODIS_SP')}, NRT ${requested(fetch, 'MODIS', 'MODIS_NRT')}; VIIRS standard ${requested(fetch, 'VIIRS', 'VIIRS_SNPP_SP')}, NRT ${requested(fetch, 'VIIRS', 'VIIRS_SNPP_NRT')}` : 'Not reported',
      processing: `Bounding box clipped to the Argentina polygon; NRT static sources inferred from known industrial locations; only complete months kept${live?.months_held_back_incomplete?.length ? ` (${live.months_held_back_incomplete.join(', ')} held back)` : ''}.` },
    { name: 'MODIS active fire, Terra satellite', provider: 'NASA FIRMS yearly country archive', resolution: '≈ 1 km pixel',
      period: '2003 to 2011', processing: 'Reference only: days with Terra detections but no Aqua rows identify Aqua outages before VIIRS existed.' },
    { name: 'VIIRS 375 m active fire, NOAA-20 satellite', provider: 'NASA FIRMS area API, worldwide daily queries', resolution: '375 m pixel',
      period: outageDays ? `${outageDays} live-year days checked` : 'Not reported', processing: 'Reference only: a day counts as an S-NPP outage when S-NPP has no rows worldwide while NOAA-20 does.' },
    { name: 'Admin-0 country boundaries, v5.1.2', provider: 'Natural Earth (public domain)', resolution: '1:10m for clipping; 1:110m for the map outline',
      period: 'Static', processing: 'Clipping the live-year bounding box to Argentina. Checked on 2019: MODIS matches the country archive exactly, VIIRS within −0.01% of annual cell-days.' },
    { name: 'Basemap tiles', provider: 'OpenStreetMap contributors', resolution: 'Web map tiles', period: 'Current', processing: 'Display only; not analysed.' },
  ];
  return <>
    <figure className="figure data-table" aria-labelledby="table-1-title">
      <div className="figure-head"><span className="figure-number">Table 1</span><h3 id="table-1-title" className="figure-title">Data sources and how each was used</h3></div>
      <div className="table-scroll"><table className="sources-table">
        <thead><tr><th scope="col">Dataset</th><th scope="col">Provider</th><th scope="col">Resolution</th><th scope="col">Period read</th><th scope="col">Processing and role</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.name}><th scope="row">{row.name}</th><td>{row.provider}</td><td>{row.resolution}</td><td className="nowrap-ish">{row.period}</td><td>{row.processing}</td></tr>)}</tbody>
      </table></div>
      <figcaption className="figure-caption"><span><b>Source</b> out/validation.json (acquisition spans, live-year fetch log, outage check) and harmonized-file metadata</span>{meta?.parameters?.filters && <span><b>Filters recorded in the data file</b> {meta.parameters.filters}</span>}</figcaption>
    </figure>
    <div className="unit-definition">
      <h3>The unit: active 0.1° cell-days</h3>
      <p>Each detection is assigned to the 0.1° grid cell that contains it (cell centre = ⌊coordinate ÷ 0.1⌋ × 0.1 + 0.05). A cell scores one for a UTC day if a sensor's filtered record has at least one detection in it that day. A monthly value is the number of such cell-days. MODIS and VIIRS are counted separately, and so are daytime and nighttime overpasses.</p>
      <p>Counting cells instead of detections removes most of the pixel-size effect: one fire can light up many 375 m VIIRS pixels but usually only one or two 1 km MODIS pixels. The unit measures where and how often satellites saw fire, not the number of fires or the area burned.</p>
    </div>
  </>;
}
