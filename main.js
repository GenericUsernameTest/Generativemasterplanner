// ====== IMPORTS ======
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

// ====== SEARCH ======
if (typeof MapboxGeocoder !== 'undefined') {
  const geocoder = new MapboxGeocoder({
    accessToken: mapboxgl.accessToken,
    mapboxgl,
    marker: false,
    placeholder: 'Search for a place',
    types: 'place,postcode,address,poi',
    language: 'en'
  });
  map.addControl(geocoder, 'top-left');
  geocoder.on('result', (e) =>
    map.easeTo({ center: e.result.center, zoom: 16, pitch: 60, bearing: -15 })
  );
} else {
  console.warn('MapboxGeocoder script not loaded — search disabled.');
}

// ====== STATE ======
let draw;                        
let siteBoundary = null;         
let roads = [];                  
const $ = (id) => document.getElementById(id);
const setStats = (html) => { const el = $('stats'); if (el) el.innerHTML = html; };

// ====== MAP LOAD ======
map.on('load', () => {
  // Site boundary
  map.addSource('site-view', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'site-fill',
    type: 'fill',
    source: 'site-view',
    paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.12 }
  });
  map.addLayer({
    id: 'site-view',
    type: 'line',
    source: 'site-view',
    paint: { 'line-color': '#16a34a', 'line-width': 4, 'line-opacity': 0.9 }
  });

  // Roads
  map.addSource('roads-view', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'roads-view',
    type: 'fill',
    source: 'roads-view',
    paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.6 }
  });

  // Homes
  map.addSource('homes', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'homes',
    type: 'fill-extrusion',
    source: 'homes',
    paint: {
      'fill-extrusion-color': '#6699ff',
      'fill-extrusion-height': ['coalesce', ['get','height'], 4],
      'fill-extrusion-opacity': 0.75
    }
  });

  // Draw control
  draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: { polygon: true, trash: true }
  });
  map.addControl(draw);

  tuneDrawStyles();
  map.on('styledata', tuneDrawStyles);
  map.on('draw.modechange', () => { map.getCanvas().style.cursor = ''; tuneDrawStyles(); });

  wireToolbar();

  // When polygon is created
  map.on('draw.create', (e) => {
    const feat = e.features[0];
    if (!feat || feat.geometry.type !== 'Polygon') return;

    if (!siteBoundary) {
      siteBoundary = feat;
      refreshSite();

      // Pre-fill rotation input
      const autoAngle = getLongestEdgeAngle(siteBoundary);
      const angleInput = $('rotationAngle');
      if (angleInput) angleInput.value = autoAngle.toFixed(1);

      setStats('<p>Site boundary saved. Click <b>Draw Roads</b> to add road polygons, then <b>Fill with Homes</b>.</p>');
    } else {
      roads.push(feat);
      refreshRoads();
      setStats(`<p>Road added. Total roads: ${roads.length}. Click <b>Fill with Homes</b> when ready.</p>`);
    }

    draw.deleteAll();
    map.getCanvas().style.cursor = '';
  });

  // Manual rotation
  const angleInput = $('rotationAngle');
  if (angleInput) {
    ['change', 'input'].forEach(evt => {
      angleInput.addEventListener(evt, () => {
        if (siteBoundary) {
          fillHomes({ map, siteBoundary, roads, setStats, manualAngle: parseFloat(angleInput.value) });
        }
      });
    });
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
    if (map.getLayer(id)) {
      try { map.setPaintProperty(id, prop, val); } catch {}
    }
  });
}

// ====== Toolbar ======
function wireToolbar() {
  $('drawSite').onclick = () => {
    draw.deleteAll();
    siteBoundary = null;
    roads = [];
    refreshSite();
    refreshRoads();
    clearHomes();
    draw.changeMode('draw_polygon');
    map.getCanvas().style.cursor = 'crosshair';
    setStats('<p>Drawing site boundary…</p>');
  };

  $('drawRoads').onclick = () => {
    if (!siteBoundary) { alert('Draw the site boundary first.'); return; }
    draw.changeMode('draw_polygon');
    map.getCanvas().style.cursor = 'crosshair';
    setStats('<p>Drawing roads…</p>');
  };

  $('fillHomes').onclick = () => {
    fillHomes({ map, siteBoundary, roads, setStats, manualAngle: parseFloat($('rotationAngle')?.value) });
  };

  $('clearAll').onclick = () => {
    draw.deleteAll();
    siteBoundary = null;
    roads = [];
    refreshSite();
    refreshRoads();
    clearHomes();
  };
}

// ====== Rendering helpers ======
function refreshSite()   { map.getSource('site-view').setData(siteBoundary ? fc([siteBoundary]) : emptyFC()); }
function refreshRoads()  { map.getSource('roads-view').setData(roads.length ? fc(roads) : emptyFC()); }
function clearHomes()    { map.getSource('homes').setData(emptyFC()); }
function fc(features)    { return { type: 'FeatureCollection', features }; }
function emptyFC()       { return { type: 'FeatureCollection', features: [] }; }
