import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_RAMP } from './heatScale.js';

function polygon(bounds) {
  const [w, s, east, n] = bounds;
  const e = east < w ? east + 360 : east;
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } };
}
const wrap = lon => ((lon + 180) % 360 + 360) % 360 - 180;
const EMPTY = { type: 'FeatureCollection', features: [] };
// Each 0.1° cell is drawn as its true footprint, coloured on the same square-root
// cividis scale as the calendar so both views read the same way.
export function cellFeatures(cells, maximum) {
  if (!cells?.length || !(maximum > 0)) return EMPTY;
  return { type: 'FeatureCollection', features: cells.map(([lon, lat, value, source]) => ({ type: 'Feature',
    properties: { v: value, p: Math.sqrt(Math.min(1, value / maximum)), s: source },
    geometry: { type: 'Polygon', coordinates: [[[lon - .05, lat - .05], [lon + .05, lat - .05], [lon + .05, lat + .05], [lon - .05, lat + .05], [lon - .05, lat - .05]]] } })) };
}
const RAMP = ['interpolate', ['linear'], ['get', 'p'], ...MAP_RAMP.flatMap((color, i) => [i / (MAP_RAMP.length - 1), color])];

// Below zoom 6 a 0.1° square is under a pixel wide, so cells are also drawn as dots
// whose size grows with zoom; from zoom 6 the true cell squares take over.
export function cellPoints(cells, maximum) {
  if (!cells?.length || !(maximum > 0)) return EMPTY;
  return { type: 'FeatureCollection', features: cells.map(([lon, lat, value, source]) => ({ type: 'Feature',
    properties: { v: value, p: Math.sqrt(Math.min(1, value / maximum)), s: source }, geometry: { type: 'Point', coordinates: [lon, lat] } })) };
}

export default function Map({ bounds, onSelect, coverage, grid }) {
  const container = useRef(null), map = useRef(null), selection = useRef(onSelect), current = useRef(bounds);
  const [drawing, setDrawing] = useState(false), [notice, setNotice] = useState(''), [hovered, setHovered] = useState(null);
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const coverageRef = useRef(coverage), initialBounds = useRef(bounds);
  coverageRef.current = coverage;
  selection.current = onSelect;
  current.current = bounds;

  useEffect(() => {
    let instance;
    try {
      instance = new maplibregl.Map({
        container: container.current, bounds: [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
        fitBoundsOptions: { padding: { top: 76, bottom: 76, left: 30, right: 30 } }, maxZoom: 14, renderWorldCopies: false,
        // Draw one copy of the world. maxBounds and minZoom are avoided: on narrow screens they
        // stop the map fitting Argentina, and the resize refit then keeps re-rendering.
        // A local style still renders the selection if the optional basemap is offline.
        style: { version: 8, sources: { basemap: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' } },
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#E6EAED' } },
            { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-saturation': -1, 'raster-opacity': 0.8, 'raster-contrast': 0.1, 'raster-fade-duration': 0 } }] },
      });
    } catch {
      setNotice('Map unavailable. Select your region with the latitude / longitude inputs.');
      return;
    }
    map.current = instance;
    const resize = new ResizeObserver(() => {
      instance.resize();
      // Fit the whole study area, including Tierra del Fuego, at every screen size.
      const [w, s, e, n] = current.current;
      instance.fitBounds([[w, s], [e < w ? e + 360 : e, n]], { padding: { top: 76, bottom: 76, left: 30, right: 30 }, maxZoom: 8, duration: 0 });
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
        // A light tint marks areas without data while keeping neighbouring borders and names readable.
        instance.addLayer({ id: 'outside-coverage', type: 'fill', source: 'coverage-mask', paint: { 'fill-color': '#B9C2CA', 'fill-opacity': .38 } });
        instance.addLayer({ id: 'coverage-outline', type: 'line', source: 'coverage', paint: { 'line-color': '#16222E', 'line-width': 1.8 } });
      }
      instance.addSource('activity', { type: 'geojson', data: cellFeatures(gridRef.current?.cells, gridRef.current?.max) });
      instance.addSource('activity-points', { type: 'geojson', data: cellPoints(gridRef.current?.cells, gridRef.current?.max) });
      instance.addLayer({ id: 'activity', type: 'fill', source: 'activity', minzoom: 6, paint: { 'fill-color': RAMP, 'fill-opacity': 0.92, 'fill-antialias': false } }, boundary ? 'outside-coverage' : undefined);
      instance.addLayer({ id: 'activity-points', type: 'circle', source: 'activity-points', maxzoom: 6, paint: { 'circle-color': RAMP, 'circle-opacity': 0.9,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 1.2, 4, 2, 5, 2.8, 6, 4] } }, boundary ? 'outside-coverage' : undefined);
      for (const layer of ['activity', 'activity-points']) {
        instance.on('mousemove', layer, event => { const f = event.features?.[0]; if (f) setHovered({ v: f.properties.v, s: f.properties.s, lon: f.geometry.type === 'Point' ? f.geometry.coordinates[0] : event.lngLat.lng, lat: f.geometry.type === 'Point' ? f.geometry.coordinates[1] : event.lngLat.lat }); });
        instance.on('mouseleave', layer, () => setHovered(null));
      }
      instance.addSource('selection', { type: 'geojson', data: polygon(current.current) });
      // Keep the coverage mask above the highlight so a bounding box never implies
      // that observations are available in neighbouring countries.
      instance.addLayer({ id: 'selection-fill', type: 'fill', source: 'selection', paint: { 'fill-color': '#1D5C8C', 'fill-opacity': 0.04 } }, boundary ? 'outside-coverage' : undefined);
      instance.addLayer({ id: 'selection-outline', type: 'line', source: 'selection', paint: { 'line-color': '#16222E', 'line-width': 1.6, 'line-dasharray': [3, 2] } });
    });
    return () => { resize.disconnect(); map.current = null; instance.remove(); };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    instance.getSource('selection')?.setData(polygon(bounds));
    if (bounds === initialBounds.current) return;
    const [w, s, e, n] = bounds;
    instance.fitBounds([[w, s], [e < w ? e + 360 : e, n]], { padding: { top: 76, bottom: 76, left: 30, right: 30 }, maxZoom: 8, duration: 0 });
  }, [bounds]);

  useEffect(() => {
    map.current?.getSource('activity')?.setData(cellFeatures(grid?.cells, grid?.max));
    map.current?.getSource('activity-points')?.setData(cellPoints(grid?.cells, grid?.max));
    setHovered(null);
  }, [grid]);

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
    <div className="map-toolbar"><span className="map-tag">Argentina coverage</span>
      <button className={drawing ? 'draw active' : 'draw'} onClick={() => setDrawing(value => !value)} aria-pressed={drawing}>
        <span aria-hidden="true">▧</span> {drawing ? 'Cancel drawing' : 'Select area on map'}</button></div>
    <div className={`map-caption${drawing || hovered ? ' active' : ''}`} aria-live="polite">{drawing ? 'Drag to select a rectangle · Esc to cancel' : hovered ? <span>{hovered.v.toLocaleString('en', { maximumFractionDigits: 1 })} active cell-days in the cell near {Math.abs(hovered.lat).toFixed(2)}° S, {Math.abs(hovered.lon).toFixed(2)}° W{hovered.s !== 'observed' ? ` · ${hovered.s === 'backcast' ? 'back-cast' : 'gap-filled'} estimate` : ''}</span> : <><span className="coverage-key">Argentina data coverage</span><span className="selection-key">Selected bounding box</span><span className="no-data-key">Outside Argentina: no data</span></>}</div>
    {notice && <div className="map-notice" role="status">{notice}</div>}
  </div>;
}
