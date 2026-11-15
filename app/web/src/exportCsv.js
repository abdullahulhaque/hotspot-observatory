// Parse quoted fields, including commas, escaped quotes and embedded newlines.
// This preserves the API's measurements and quality metadata when adding context.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && character === ',') { row.push(field); field = ''; }
    else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += character;
  }
  if (quoted) throw new Error('CSV export contains an unterminated quoted field.');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function withSelection(text, { regionName, bounds, start, end }) {
  const [header, ...rows] = parseCsv(text);
  const yearIndex = header?.indexOf('year'), monthIndex = header?.indexOf('month');
  if (yearIndex == null || yearIndex < 0 || monthIndex < 0) throw new Error('CSV export is missing date columns.');
  const context = [regionName, ...bounds, start, end];
  const output = [
    ['date', 'study_area', 'bbox_west', 'bbox_south', 'bbox_east', 'bbox_north', 'selection_start', 'selection_end', ...header],
    ...rows.map(row => [`${row[yearIndex]}-${String(row[monthIndex]).padStart(2, '0')}`, ...context, ...row]),
  ];
  return output.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
}
