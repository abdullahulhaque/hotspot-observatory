// Shown beside headline numbers so the unit is defined where it is read.
// 0.1° of latitude is about 11.1 km; 0.1° of longitude is about 10.3 km at 22° S and 6.4 km at 55° S.
export default function UnitNote({ compact = false }) {
  return <details className={`unit-note${compact ? ' compact' : ''}`}>
    <summary>Active cell-days: satellite-detected fire activity, not a fire count or burned area</summary>
    <div className="unit-note-body">
      <p>One <b>active cell-day</b> is one 0.1° grid cell with at least one satellite fire detection on one UTC day. Across Argentina a cell is about 11 km north–south and 6–10 km east–west.</p>
      <p>A large fire can add many cell-days (it covers many cells and burns for days); several small fires in one cell on one day add one. Compare cell-days with cell-days, not with fire counts or hectares burned.</p>
    </div>
  </details>;
}
