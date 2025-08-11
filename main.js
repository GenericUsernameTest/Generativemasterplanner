// main.js
import { fillHomes, getLongestEdgeAngle } from './homes.js';

// ====== CONFIG ======
mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

// ====== MAP INIT (remember last view) ======
const savedView = JSON.parse(localStorage.getItem('mapView') || '{}');
const map = new mapboxgl.Map({
  container: 'map',
  style: STYLE_URL,
  center: savedView.center || [0, 20],
  zoom: typeof savedView.zoom === 'number' ? savedView.zoom : 2,
  pitch: typeof savedView.pitch === 'number' ? savedView.pitch : 0,
  bearing: typeof savedView.bearing === 'number' ? savedView.bearing : 0
});
map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
map.on('moveend', () => {
  localStorage.setItem('mapView', JSON.stringify({
    center: map.getCenter().toArray(),
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing()
  }));
});

// ====== SEARCH (guarded) ======
if (typeof MapboxGeocoder !== 'undefined') {
  const geocoder = new MapboxGeocoder({
    accessToken: mapboxgl.accessToken, mapboxgl,
    marker: false, placeholder: 'Search', types: 'place,postcode,address,poi'
  });
  map.addControl(geocoder, 'top-left');
  geocoder.on('result', (e) =>
    map.easeTo({ center: e.result.center, zoom: 16, pitch: 60, bearing: -15 })
  );
}

// ====== STATE ======
let draw;
let siteBoundary = null;
let roads = [];
const $ = (id) => document.getElementById(id);
const setStats = (html) => { const el = $('stats'); if (el) el.innerHTML = html; };

// Small helpers
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
const fc = (features) => ({ type: 'FeatureCollection', features });

// ====== MAP LOAD ======
map.on('load', () => {
  // Site boundary (fill then line)
  map.addSource('site-view', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'site-fill', type: 'fill', source: 'site-view',
    paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.12 }
  });
  map.addLayer({
    id: 'site-view', type: 'line', source: 'site-view',
    paint: { 'line-color': '#16a34a', 'line-width': 4, 'line-opacity': 0.9 }
  });

  // Roads
  map.addSource('roads-view', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'roads-view', type: 'fill', source: 'roads-view',
    paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.6 }
  });

  // Homes (3D)
  map.addSource('homes', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'homes', type: 'fill-extrusion', source: 'homes',
    paint: {
      'fill-extrusion-color': '#6699ff',
      'fill-extrusion-height': ['coalesce', ['get','height'], 4],
      'fill-extrusion-opacity': 0.75
    }
  });

  // Draw
  draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: true, trash: true } });
  map.addControl(draw);

  tuneDrawStyles();
  map.on('styledata', tuneDrawStyles);
  map.on('draw.modechange', () => { map.getCanvas().style.cursor = ''; tuneDrawStyles(); });

  wireToolbar();

  // When a polygon is created, decide if it's site or road
  map.on('draw.create', (e) => {
    const feat = e.features[0];
    if (!feat || feat.geometry.type !== 'Polygon') return;

    if (!siteBoundary) {
      siteBoundary = feat;
      refreshSite();

      // Prefill rotation with auto (rows along long boundary)
      const auto = getLongestEdgeAngle(siteBoundary);
      const inp = $('rotationAngle');
      if (inp) inp.value = Number.isFinite(auto) ? auto.toFixed(1) : '';

      setStats('<p>Site boundary saved. Click <b>Draw Roads</b> to add road polygons, then <b>Fill with Homes</b>.</p>');
    } else {
      roads.push(feat);
      refreshRoads();
      setStats(`<p>Road added. Total roads: ${roads.length}. Click <b>Fill with Homes</b> when ready.</p>`);
    }
    draw.deleteAll();
    map.getCanvas().style.cursor = '';
  });

  // Rotation input — apply immediately on any change/typing/Enter
  const angleEl = $('rotationAngle');
  if (angleEl) {
    const apply = () => {
      if (!siteBoundary) return;
      const v = parseFloat(String(angleEl.value).trim());
      // allow empty -> auto; otherwise use the number
      doFill(Number.isFinite(v) ? v : undefined);
    };
    ['input','change','blur'].forEach(evt => angleEl.addEventListener(evt, apply));
    angleEl.addEventListener('keyup', (e) => { if (e.key === 'Enter') apply(); });
  }
});

// ====== Draw style tweaks ======
function tuneDrawStyles() {
  const edits = [
    ['gl-draw-polygon-stroke-active', 'line-color', '#16a34a'],
    ['gl-draw-polygon-stroke-active', 'line-width', 2],
    ['gl-draw-polygon-stroke-inactive', 'line-color', '#16a34a'],
    ['gl-draw-polygon-stroke-inactive', 'line-width', 4],
    ['gl-draw-polygon-fill-inactive', 'fill-color', '#16a34a'],
    ['gl-draw-polygon-fill-inactive', 'fill-opacity', 0.04]
  ];
  edits.forEach(([id, prop, val]) => {
    if (map.getLayer(id)) { try { map.setPaintProperty(id, prop, val); } catch {} }
  });
}

// ====== Toolbar ======
function wireToolbar() {
  $('drawSite').onclick = () => {
    draw.deleteAll(); siteBoundary = null; roads = [];
    refreshSite(); refreshRoads(); clearHomes();
    draw.changeMode('draw_polygon');
    map.getCanvas().style.cursor = 'crosshair';
    setStats('<p>Drawing site boundary… click to add points, double‑click to finish.</p>');
  };

  $('drawRoads').onclick = () => {
    if (!siteBoundary) { alert('Draw the site boundary first.'); return; }
    draw.changeMode('draw_polygon');
    map.getCanvas().style.cursor = 'crosshair';
    setStats('<p>Drawing roads… add one or more polygons inside the site, double‑click to finish each.</p>');
  };

  $('fillHomes').onclick = () => doFill();

  $('clearAll').onclick = () => {
    draw.deleteAll(); siteBoundary = null; roads = [];
    refreshSite(); refreshRoads(); clearHomes(); setStats('');
  };
}

// ====== Generate with optional manual angle ======
function doFill(manualAngle) {
  if (!siteBoundary) { alert('Draw the site boundary first.'); return; }

  const angleEl = $('rotationAngle');
  let angleToUse;
  if (typeof manualAngle === 'number') {
    angleToUse = manualAngle;
  } else {
    // read the field; if empty/NaN -> auto
    const v = parseFloat(String(angleEl?.value ?? '').trim());
    angleToUse = Number.isFinite(v) ? v : NaN;
  }

  const { stats } = fillHomes({
    map,
    siteBoundary,
    roads,
    rotationDegrees: angleToUse,   // NaN -> auto
    params: {
      // SHORT side faces the long boundary by design (handled in homes.js)
      homeWidthM: 6.5,
      homeDepthM: 10,
      homeHeightM: 4,
      gapSideM: 2,
      gapFrontM: 5,
      edgeMarginM: 0.6
    },
    targetSourceId: 'homes'
  });

  setStats(`
    <p><strong>Buildable area:</strong> ${Math.round(stats.areaM2).toLocaleString()} m² (${stats.ha.toFixed(2)} ha)</p>
    <p><strong>Homes placed:</strong> ${stats.count}</p>
    <p><strong>Rotation used:</strong> ${stats.angleUsed.toFixed(1)}°</p>
    <p><strong>Actual density:</strong> ${(stats.count / stats.ha || 0).toFixed(1)} homes/ha</p>
  `);
}

// ====== Render helpers ======
function refreshSite()  { map.getSource('site-view').setData(siteBoundary ? fc([siteBoundary]) : emptyFC()); }
function refreshRoads() { map.getSource('roads-view').setData(roads.length ? fc(roads) : emptyFC()); }
function clearHomes()   { map.getSource('homes').setData(emptyFC()); }
