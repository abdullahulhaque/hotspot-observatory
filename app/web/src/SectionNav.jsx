import { useEffect, useState } from 'react';

const SECTIONS = [['where', 'Study Area'], ['satellites', 'Compare Sensors'], ['history', 'Harmonization'], ['explore', 'Fire History']];

export default function SectionNav() {
  const [active, setActive] = useState('where');
  useEffect(() => {
    let frame;
    const header = document.querySelector('.topbar');
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const headerHeight = header?.getBoundingClientRect().height || 0;
        document.documentElement.style.setProperty('--header-height', `${headerHeight}px`);
        const threshold = Math.max(headerHeight + 24, Math.min(180, window.innerHeight * .25));
        let current = 'where';
        let currentTop = -Infinity;
        for (const [id] of SECTIONS) {
          const top = document.getElementById(id)?.getBoundingClientRect().top;
          // Adjacent desktop sections share a row: keep its first section active,
          // or the explicitly linked section, until the next row enters view.
          if (top <= threshold && (top > currentTop + 1 || Math.abs(top - currentTop) <= 1 && window.location.hash === `#${id}`)) {
            current = id;
            currentTop = top;
          }
        }
        if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) current = 'explore';
        setActive(current);
      });
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    window.addEventListener('hashchange', update);
    const observer = new ResizeObserver(update);
    if (header) observer.observe(header);
    for (const [id] of SECTIONS) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.documentElement.style.removeProperty('--header-height');
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('hashchange', update);
    };
  }, []);
  return <nav className="section-nav" aria-label="On this page">{SECTIONS.map(([id, label]) =>
    <a key={id} href={`#${id}`} aria-current={active === id ? 'location' : undefined}>{label}</a>)}</nav>;
}
