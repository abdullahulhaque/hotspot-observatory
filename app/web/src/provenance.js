export function qualityLabel(row, metric = 'harmonized') {
  const labels = [];
  if (metric === 'harmonized') labels.push(row?.source === 'backcast' ? 'Back-cast estimate' : row?.source === 'gapfill' ? 'Gap-filled estimate' : 'Observed');
  if (row?.incomplete_metrics?.includes(metric)) labels.push('Incomplete observations');
  if (row?.nrt) labels.push('NRT · provisional');
  if (row?.gap_flag) labels.push('Sensor gap flagged');
  return labels.join(' · ');
}

export function comparisonBlocked(stats) {
  return ['incomplete', 'quality_unavailable'].includes(stats?.comparison_status);
}
