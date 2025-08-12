// top of main.js
import { createRoads } from './createroads.js'; // make sure the filename is lowercase

// inside DOMContentLoaded scope:
let draw, siteBoundary = null, entranceRoad = null;

// in map.on('load', ...) after your other sources:
map.addSource('entrance-road', { type: 'geojson', data: { type:'FeatureCollection', features:[] }});
map.addLayer({
  id: 'entrance-road',
  type: 'line',
  source: 'entrance-road',
  paint: {
    'line-color': '#111',
    'line-width': 3,
    'line-dasharray': [2, 2],
    'line-opacity': 0.8
  }
});

// keep your existing Polygon handler for site:
// map.on('draw.create', ...) — adjust to accept both polygon and line:
map.on('draw.create', (e) => {
  const feat = e.features?.[0];
  if (!feat) return;

  if (feat.geometry.type === 'Polygon') {
    siteBoundary = feat;
    refreshSite();
    // any auto-rotation you already do...
    setStats('<p>Site boundary saved. Adjust parameters.</p>');
    draw.deleteAll(); // clear the temp drawing
  }

  if (feat.geometry.type === 'LineString') {
    entranceRoad = feat;                                 // keep full polyline
    map.getSource('entrance-road')?.setData(fc([feat])); // show dashed preview
    setStats('<p>Entrance road saved.</p>');
    draw.trash(); // leave drawing mode
  }
});

// toolbar wiring (add two buttons you already have labels for)
$('pickEntrance').onclick = () => {
  draw.deleteAll();
  draw.changeMode('draw_line_string'); // user draws a curve with multiple vertices
};
$('clearEntrance').onclick = () => {
  entranceRoad = null;
  map.getSource('entrance-road')?.setData(emptyFC());
  setStats('<p>Entrance road cleared.</p>');
};

// when you generate:
$('fillHomes').onclick = () => generateNow();
function generateNow() {
  generatePlan(map, siteBoundary, entranceRoad); // pass the line in
}

// small helpers (you already have these in utils; inline if needed)
function fc(features) { return { type:'FeatureCollection', features: features || [] }; }
function emptyFC()     { return fc([]); }
