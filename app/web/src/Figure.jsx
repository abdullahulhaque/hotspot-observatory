// A numbered scientific figure: title above, data source and period below.
export default function Figure({ number, title, source, period, note, className = '', children, label = 'Figure' }) {
  const id = `${label.toLowerCase()}-${number ?? String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
  return <figure className={`figure ${className}`} aria-labelledby={`${id}-title`}>
    <div className="figure-head">{number != null && <span className="figure-number">{label} {number}</span>}<h3 id={`${id}-title`} className="figure-title">{title}</h3></div>
    {children}
    {(source || period || note) && <figcaption className="figure-caption">
      {note && <span className="figure-note">{note}</span>}
      {source && <span><b>Source</b> {source}</span>}
      {period && <span><b>Period</b> {period}</span>}
    </figcaption>}
  </figure>;
}

// Colorblind-safe series colours (Okabe & Ito, 2008). Series are also told apart by
// line style and marker shape, never by colour alone.
export const SERIES = {
  modis: '#C24F00', viirs: '#0067A5', harmonized: '#16222E', model: '#16222E',
  green: '#00785A', purple: '#A6517F', muted: '#7B8794', grid: '#D9DEE3', band: '#16222E',
};

export const monthName = month => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1];
export const fmtNumber = (value, digits = 1) => value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
