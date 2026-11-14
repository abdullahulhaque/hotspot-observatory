export const SEASONS = [
  { id: 'summer', name: 'Summer', start: 12, label: 'December–February (summer)' },
  { id: 'autumn', name: 'Autumn', start: 3, label: 'March–May (autumn)' },
  { id: 'winter', name: 'Winter', start: 6, label: 'June–August (winter)' },
  { id: 'spring', name: 'Spring', start: 9, label: 'September–November (spring)' },
];
export const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

// Only aggregate supplied harmonized values. A season is comparable only when
// all three months are available and none has incomplete harmonized coverage.
export function compareSeasons(rows, seasonId, count, start, end, period = 'D') {
  const definition = SEASONS.find(item => item.id === seasonId);
  if (!definition || !start || !end || start > end) return { seasons: [], complete: [], median: null };
  const lookup = new Map(rows.filter(row => row.daynight === period).map(row => [monthKey(row.year, row.month), row]));
  const seasons = [];
  for (let year = Number(start.slice(0, 4)) - 1; year <= Number(end.slice(0, 4)); year++) {
    const months = Array.from({ length: 3 }, (_, index) => {
      const month = (definition.start + index - 1) % 12 + 1;
      const monthYear = year + (definition.start + index > 12 ? 1 : 0);
      const key = monthKey(monthYear, month);
      const row = key >= start && key <= end ? lookup.get(key) : undefined;
      const value = Number.isFinite(row?.harmonized) ? row.harmonized : null;
      const reason = value == null ? 'Month unavailable' : row.incomplete_metrics?.includes('harmonized') || row.incomplete ? 'Incomplete observations' : row.quality_available === false ? 'Coverage metadata unavailable' : null;
      return { key, row, value, reason };
    });
    // No future seasons or non-overlapping leading seasons are manufactured.
    if (months[0].key > end || months[2].key < start) continue;
    const available = months.filter(month => month.value != null);
    const partialTotal = available.length ? available.reduce((sum, month) => sum + month.value, 0) : null;
    const complete = months.every(month => month.reason == null);
    const labelYear = definition.start === 12 ? `${year}–${String(year + 1).slice(-2)}` : String(year);
    seasons.push({ id: `${seasonId}-${year}`, year, labelYear, label: `${definition.name} ${labelYear}`, months,
      complete, total: complete ? partialTotal : null, partialTotal,
      estimated: months.some(month => ['backcast', 'gapfill'].includes(month.row?.source)),
      nrt: months.some(month => month.row?.nrt), gapFlag: months.some(month => month.row?.gap_flag) });
  }
  const complete = seasons.filter(season => season.complete).slice(-count);
  const cutoff = complete[0]?.year ?? seasons.at(-count)?.year ?? seasons[0]?.year;
  const values = complete.map(season => season.total).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length ? (values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2) : null;
  return { seasons: seasons.filter(season => season.year >= cutoff), complete, median };
}
