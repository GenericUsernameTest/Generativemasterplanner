import { generateMasterplan, getLongestEdgeAngle } from './homes.js';

function $(id) { return document.getElementById(id); }
function setStats(html) { $('stats').innerHTML = html; }

/* ---------------- Mapbox token loader ----------------
   Paste your PUBLIC token (starts with pk.) below OR
   load the page once with ?token=pk.XXXX and we'll store it.
------------------------------------------------------- */
const TOKEN_KEY = 'mbx_token';
const TOKEN_HARDCODED = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw'; // <<< paste here (optional)

const fromQuery = new URLSearchParams(location.search).get('token');
if (fromQuery) localStorage.setItem(TOKEN_KEY, fromQuery);

mapboxgl.accessToken =
  fromQuery ||
  TOKEN_HARDCODED ||
  localStorage.getItem(TOKEN_KEY) || '';

if (!mapboxgl.accessToken) {
  const t = prompt('Paste your Mapbox PUBLIC token (starts with pk.):');
  if (t) {
    localStorage.setItem(TOKEN_KEY, t);
    mapboxgl.accessToken = t;
  } else {
    alert('Missing Mapbox token. Reload with ?token=pk... or paste when prompted.');
    throw new Error('Missing Mapbox token');
  }
}
/* ---------------- end token loader ------------------ */

// Map init
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/light-v11',
  center: [-0.1276, 51.5072],
  zoom: 13
});

const draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: true, trash: true } });
map.addControl(draw);
map.addControl(new MapboxGeocoder({ accessToken: mapboxgl.accessToken, mapboxgl }), 'top-left');

let siteBoundary = null;

function upsertSource(id, data) {
  if (map.getSource(id)) map.getSource(id).setData(data);
  else map.addSource(id, { type: 'geojson', data });
}

function ensureLayers() {
  if (!map.getLayer('roads-fill')) {
    map.addLayer({
      id: 'roads-fill',
      type: 'fill',
      source: 'roads',
      paint: { 'fill-color': '#bfc9d4', 'fill-opacity': 0.65 }
    });
  }
  if (!map.getLayer('homes-fill')) {
    map.addLayer({
      id: 'homes-fill',
      type: 'fill',
      source: 'homes',
      paint: { 'fill-color': '#60a5fa', 'fill-opacity': 0.35 }
    });
  }
  if (!map.getLayer('homes-extrude')) {
    map.addLayer({
      id: 'homes-extrude',
      type: 'fill-extrusion',
      source: 'homes',
      paint: {
        'fill-extrusion-color': '#3a82f7',
        'fill-extrusion-height': 4,
        'fill-extrusion-opacity': 0.9
      }
    });
  }
  if (!map.getLayer('homes-outline')) {
    map.addLayer({
      id: 'homes-outline',
      type: 'line',
      source: 'homes',
      paint: { 'line-color': '#1d4ed8', 'line-width': 1 }
    }, 'homes-extrude');
  }
  if (!map.getLayer('site-line')) {
    map.addLayer({
      id: 'site-line',
      type: 'line',
      source: 'site',
      paint: { 'line-color': '#2b8a3e', 'line-width': 2 }
    });
  }
}

map.on('load', () => {
  upsertSource('site',  { type:'FeatureCollection', features: [] });
  upsertSource('roads', { type:'FeatureCollection', features: [] });
  upsertSource('homes', { type:'FeatureCollection', features: [] });
  ensureLayers();
});

$('drawSite').onclick = () => {
  draw.deleteAll();
  siteBoundary = null;
  upsertSource('site',  { type:'FeatureCollection', features: [] });
  upsertSource('roads', { type:'FeatureCollection', features: [] });
  upsertSource('homes', { type:'FeatureCollection', features: [] });
  map.getCanvas().style.cursor = 'crosshair';
  draw.changeMode('draw_polygon');
};

$('clearAll').onclick = () => {
  draw.deleteAll();
  siteBoundary = null;
  upsertSource('site',  { type:'FeatureCollection', features: [] });
  upsertSource('roads', { type:'FeatureCollection', features: [] });
  upsertSource('homes', { type:'FeatureCollection', features: [] });
  setStats('');
};

map.on('draw.create', e => {
  siteBoundary = e.features[0];
  map.getCanvas().style.cursor = '';
  upsertSource('site', { type:'FeatureCollection', features:[siteBoundary] });
});

$('fillHomes').onclick = () => {
  if (!siteBoundary) { alert('Draw the site boundary first.'); return; }

  const opts = {
    rotationDeg: parseFloat($('rotationAngle').value) || getLongestEdgeAngle(siteBoundary),
    homeW: parseFloat($('homeWidth').value),
    homeD: parseFloat($('homeDepth').value),
    frontSetback: parseFloat($('frontSetback').value),
    sideGap: parseFloat($('sideGap').value),
    roadW: parseFloat($('roadWidth').value),
    lotsPerBlock: parseInt($('lotsPerBlock').value) || 5
  };

  const { roads, homes } = generateMasterplan(siteBoundary, opts);

  upsertSource('roads', roads);
  upsertSource('homes', homes);
  ensureLayers();

  setStats(`
    <p>
      ${homes.features.length.toLocaleString()} homes placed.<br>
      Roads: ${(turf.area(roads)/10000).toFixed(2)} ha<br>
      Density: ${(homes.features.length / (turf.area(siteBoundary) / 10000)).toFixed(1)} homes/ha
    </p>
  `);
};
