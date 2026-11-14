import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

function polygon(bounds) {
  const [w, s, east, n] = bounds;
  const e = east < w ? east + 360 : east;
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } };
}
const wrap = lon => ((lon + 180) % 360 + 360) % 360 - 180;

export default function Map({ bounds, onSelect, coverage }) {
  const container = useRef(null), map = useRef(null), selection = useRef(onSelect), current = useRef(bounds);
  const [drawing, setDrawing] = useState(false), [notice, setNotice] = useState('');
  const coverageRef = useRef(coverage), initialBounds = useRef(bounds);
  coverageRef.current = coverage;
  selection.current = onSelect;
  current.current = bounds;

  useEffect(() => {
    let instance;
    try {
      instance = new maplibregl.Map({
        container: container.current, center: [-63.6, -38.4], zoom: 4, maxZoom: 14,
        // A local style still renders the selection if the optional basemap is offline.
        style: { version: 8, sources: { basemap: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' } },
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#14232c' } },
            { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-saturation': -0.5, 'raster-brightness-max': 0.65 } }] },
      });
    } catch {
      setNotice('Map unavailable. Select your region with the latitude / longitude inputs.');
      return;
    }
    map.current = instance;
    const resize = new ResizeObserver(() => {
      instance.resize();
      // Keep a chosen region in view when the layout changes during a map animation.
      if (current.current !== initialBounds.current) {
        const [w, s, e, n] = current.current;
        instance.fitBounds([[w, s], [e < w ? e + 360 : e, n]], { padding: 50, maxZoom: 8, duration: 0 });
      }
    });
    resize.observe(container.current);
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.on('error', () => setNotice('Basemap unavailable. Region selection and coordinate inputs still work.'));
    instance.on('style.load', () => {
      const boundary = coverageRef.current;
      if (boundary) {
        const polygons = boundary.geometry.type === 'MultiPolygon' ? boundary.geometry.coordinates : [boundary.geometry.coordinates];
        const world = [[-180,-85],[180,-85],[180,85],[-180,85],[-180,-85]];
        const mask = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, ...polygons.map(p => p[0])] } };
        instance.addSource('coverage', { type: 'geojson', data: boundary });
        instance.addSource('coverage-mask', { type: 'geojson', data: mask });
        instance.addLayer({ id: 'outside-coverage', type: 'fill', source: 'coverage-mask', paint: { 'fill-color': '#080f15', 'fill-opacity': .7 } });
        instance.addLayer({ id: 'coverage-outline', type: 'line', source: 'coverage', paint: { 'line-color': '#82bdb6', 'line-width': 1.7 } });
      }
      instance.addSource('selection', { type: 'geojson', data: polygon(current.current) });
      instance.addLayer({ id: 'selection-fill', type: 'fill', source: 'selection', paint: { 'fill-color': '#ebd17d', 'fill-opacity': 0.12 } });
      instance.addLayer({ id: 'selection-outline', type: 'line', source: 'selection', paint: { 'line-color': '#ebd17d', 'line-width': 2, 'line-dasharray': [3, 2] } });
    });
    return () => { resize.disconnect(); map.current = null; instance.remove(); };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    instance.getSource('selection')?.setData(polygon(bounds));
    if (bounds === initialBounds.current) return;
    const [w, s, e, n] = bounds;
    instance.fitBounds([[w, s], [e < w ? e + 360 : e, n]], { padding: 65, maxZoom: 8, duration: 600 });
  }, [bounds]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !drawing) return;
    let start = null;
    instance.dragPan.disable();
    instance.boxZoom.disable();
    instance.getCanvas().style.cursor = 'crosshair';
    const coordinates = event => {
      const rect = instance.getCanvas().getBoundingClientRect();
      return instance.unproject([event.clientX - rect.left, event.clientY - rect.top]);
    };
    const getBounds = end => [wrap(Math.min(start.lng, end.lng)), Math.max(-90, Math.min(start.lat, end.lat)),
      wrap(Math.max(start.lng, end.lng)), Math.min(90, Math.max(start.lat, end.lat))];
    const down = event => {
      if (event.button !== 0 || !instance.getSource('selection')) return;
      start = coordinates(event);
      instance.getCanvas().setPointerCapture(event.pointerId);
    };
    const move = event => { if (start) instance.getSource('selection')?.setData(polygon(getBounds(coordinates(event)))); };
    const up = event => {
      if (!start) return;
      const result = getBounds(coordinates(event));
      start = null;
      if (result[0] !== result[2] && result[1] < result[3]) selection.current(result.map(v => Number(v.toFixed(4))));
      else instance.getSource('selection')?.setData(polygon(current.current));
      setDrawing(false);
    };
    const cancel = event => {
      if (event.type === 'pointercancel' || event.key === 'Escape') {
        instance.getSource('selection')?.setData(polygon(current.current));
        setDrawing(false);
      }
    };
    const canvas = instance.getCanvas();
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', cancel);
    return () => {
      instance.dragPan.enable(); instance.boxZoom.enable(); instance.getCanvas().style.cursor = '';
      instance.getSource('selection')?.setData(polygon(current.current));
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', cancel);
    };
  }, [drawing]);

  return <div className="map-shell">
    <div ref={container} className="map" aria-label="Geographic region selection map" />
    <div className="map-toolbar"><span className="map-tag"><i /> ARGENTINA COVERAGE</span>
      <button className={drawing ? 'draw active' : 'draw'} onClick={() => setDrawing(value => !value)} aria-pressed={drawing}>
        <span aria-hidden="true">▧</span> {drawing ? 'Cancel drawing' : 'Draw a rectangle'}</button></div>
    <div className="map-caption">{drawing ? 'Drag to select a rectangle · Esc to cancel' : 'Teal: Argentina coverage · Gold: selected area · Outside coverage dimmed'}</div>
    {notice && <div className="map-notice" role="status">{notice}</div>}
  </div>;
}
