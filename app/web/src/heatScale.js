// Map scale: matplotlib inferno sampled from 0.2 to 0.8. Perceptually uniform with
// monotonic lightness, so it stays readable for colour-vision deficiencies, and every
// step contrasts with the light grey basemap (cividis's grey middle does not).
export const MAP_RAMP = ['#420a68', '#6a176e', '#932667', '#bc3754', '#dd513a', '#f37819', '#fca50a'];
export const CIVIDIS = ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8678', '#a59c74', '#c3b369', '#e1cc55', '#fee838'];
const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export function heatColor(value, maximum) {
  if (value == null) return undefined;
  const position = Math.sqrt(Math.max(0, Math.min(1, maximum > 0 ? value / maximum : 0))) * (CIVIDIS.length - 1);
  const index = Math.floor(position), fraction = position - index;
  const left = channels(CIVIDIS[index]), right = channels(CIVIDIS[Math.min(index + 1, CIVIDIS.length - 1)]);
  return `rgb(${left.map((v, i) => Math.round(v + fraction * (right[i] - v))).join(', ')})`;
}
export const legendTicks = maximum => [0, .25, .5, .75, 1].map(position => ({ position, value: maximum * position ** 2 }));
