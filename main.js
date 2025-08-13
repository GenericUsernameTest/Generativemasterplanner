import { $, emptyFC } from './utils.js';
import { generatePlan } from './generateplan.js';

mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n',
  center: [-0.12, 51.5],
  zoom: 14
});

const draw = new MapboxDraw({
  displayControlsDefault: false,
  controls: {},
  defaultMode: 'simple_select'
});
map.addControl(draw);

let siteBoundary = null;
let accessRoad = null;
let parksFC = emptyFC();

// ===== Draw Site =====
$('drawSite').onclick = () => {
  draw.changeMode('draw_polygon');
};

// ===== Draw Roads =====
$('drawRoads').onclick = () => {
  draw.changeMode('draw_line_string');
};

// ===== Fill Homes =====
$('fillHomes').onclick = () => {
  generatePlan(map, siteBoundary, accessRoad, parksFC);
};

// ===== Clear =====
$('clearAll').onclick = () => {
  draw.deleteAll();
  siteBoundary = null;
  accessRoad = null;
  parksFC = emptyFC();
  map.getSource('roads-view')?.setData(emptyFC());
  map.getSource('homes')?.setData(emptyFC());
};

// ===== Capture draw create events =====
map.on('draw.create', (e) => {
  const f = e.features[0];
  if (!f) return;

  if (f.geometry.type === 'Polygon' && !siteBoundary) {
    siteBoundary = f;
    draw.changeMode('simple_select'); // ✅ stop polygon mode
  }
  else if (f.geometry.type === 'LineString' && !accessRoad) {
    accessRoad = f;
    draw.changeMode('simple_select'); // ✅ stop line mode
  }
  else if (f.geometry.type === 'Polygon' && siteBoundary && !turf.booleanEqual(f, siteBoundary)) {
    parksFC.features.push(f); // treat as park
    draw.changeMode('simple_select'); // ✅ stop polygon mode
  }
});

// ===== Sources for visualization =====
map.on('load', () => {
  map.addSource('roads-view', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'roads-layer',
    type: 'fill',
    source: 'roads-view',
    paint: { 'fill-color': '#ddd', 'fill-opacity': 0.8 }
  });

  map.addSource('homes', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'homes-layer',
    type: 'fill',
    source: 'homes',
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': 0.9
    }
  });
});
