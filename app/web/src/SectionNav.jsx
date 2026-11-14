import { useEffect, useState } from 'react';

const SECTIONS = [['where', '01 Select a study area'], ['satellites', '02 Compare satellites'], ['history', '03 Understand harmonization'], ['explore', '04 Explore fire history']];

export default function SectionNav() {
  const [active, setActive] = useState('where');
  useEffect(() => {
    let frame;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const threshold = Math.min(180, window.innerHeight * .25);
        let current = 'where';
        for (const [id] of SECTIONS) {
          if (document.getElementById(id)?.getBoundingClientRect().top <= threshold) current = id;
        }
        if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) current = 'explore';
        setActive(current);
      });
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = new ResizeObserver(update);
    for (const [id] of SECTIONS) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return <nav className="section-nav" aria-label="On this page">{SECTIONS.map(([id, label]) =>
    <a key={id} href={`#${id}`} aria-current={active === id ? 'location' : undefined}>{label}</a>)}</nav>;
}
