export function rawComparison(row) {
  const modis = row?.raw_modis, viirs = row?.raw_viirs;
  const missing = !Number.isFinite(modis) || !Number.isFinite(viirs);
  const incomplete = ['raw_modis', 'raw_viirs'].some(metric => row?.incomplete_metrics?.includes(metric));
  const reason = missing ? 'Both raw observations are required for a comparison.'
    : incomplete || row.gap_flag ? 'Incomplete or gap-flagged observations can undercount activity; difference and ratio are withheld.'
    : row.quality_available !== true ? 'Observation completeness is unverified; difference and ratio are withheld.' : '';
  return {
    difference: reason ? null : viirs - modis,
    ratio: reason || modis <= 0 ? null : viirs / modis,
    reason,
    ratioReason: !reason && modis <= 0 ? 'The ratio is undefined when MODIS activity is zero.' : '',
  };
}
