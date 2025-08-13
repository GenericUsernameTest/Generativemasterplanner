import { $, emptyFC, fc, setStats } from './utils.js';
import { generatePlan } from './generateplan.js';
// ======= CONFIG =======
const MAPBOX_TOKEN = 'YOUR_MAPBOX_ACCESS_TOKEN_HERE';
const STYLE_URL = 'mapbox://styles/mapbox/light-v11'; // replace with your custom style if you have one
// ======= BOOT =======
mapboxgl.accessToken = MAPBOX_TOKEN;
document.addEventListener('DOMContentLoaded', () => {
  const map = new mapboxgl.Map({
    container: 'map',
    style: STYLE_URL,
    center: [-0.118, 51.505], // London-ish
    zoom: 12.6,
    pitch: 0,
    bearing: 0
  });
  map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
  // ---------- state ----------
  let draw;
  let siteBoundary = null;  // Feature<Polygon|MultiPolygon>
  let accessRoad   = null;  // Feature<LineString>
  let parksFC      = emptyFC(); // user-drawn parks
  let mode         = null;  // 'site' | 'access' | 'park' | null
  map.on('load', () => {
    // Sources
    map.addSource('site-view',   { type: 'geojson', data: emptyFC() });
    map.addSource('roads-view',  { type: 'geojson', data: emptyFC() });
    map.addSource('homes',       { type: 'geojson', data: emptyFC() });
    map.addSource('parks',       { type: 'geojson', data: emptyFC() });
    map.addSource('access-line', { type: 'geojson', data: emptyFC() });
    // Layers
    map.addLayer({ id: 'site-fill', type: 'fill', source: 'site-view',
      paint: { 'fill-color': '
#16a34a', 'fill-opacity': 0.10 }});
    map.addLayer({ id: 'site-outline', type: 'line', source: 'site-view',
      paint: { 'line-color': '
#16a34a', 'line-width': 4, 'line-opacity': 0.9 }});
    map.addLayer({ id: 'parks', type: 'fill', source: 'parks',
      paint: { 'fill-color': '
#22c55e', 'fill-opacity': 0.25 }});
    map.addLayer({ id: 'roads-view', type: 'fill', source: 'roads-view',
      paint: { 'fill-color': '
#9ca3af', 'fill-opacity': 0.55 }});
    map.addLayer({ id: 'access-line', type: 'line', source: 'access-line',
      paint: { 'line-color': '
#111827', 'line-width': 3, 'line-dasharray': [2,1], 'line-opacity': 0.85 }});
    map.addLayer({
      id: 'homes', type: 'fill-extrusion', source: 'homes',
      paint: {
        'fill-extrusion-color': ['coalesce', ['get','color'], '
#9fb7ff'],
        'fill-extrusion-height': 4,
        'fill-extrusion-opacity': 0.78
      }
    });
    // Draw control
    draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: false, line_string: false, trash: false }
    });
    map.addControl(draw);
    // Draw events
    map.on('draw.create', onDrawChange);
    map.on('draw.update', onDrawChange);
    // UI wiring
    wireUI();
    setStats('<p>1) Draw the <b>Site Boundary</b><br/>2) Draw the <b>Access Road</b><br/>3) (Optional) Draw one or more <b>Parks</b>, then <b>Generate</b>.</p>');
  });
  function onDrawChange(e) {
    const f = e.features?.[0];
    if (!f) return;
    if (mode === 'site' && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')) {
      siteBoundary = f;
      map.getSource('site-view')?.setData(fc([siteBoundary]));
      // tidy up drawing so the polygon tool doesn't stay active
      draw.deleteAll();
      draw.changeMode('simple_select');
      mode = null;
      setStats('<p>Site saved. Now click <b>Draw Access Road</b>.</p>');
    }
    if (mode === 'access' && f.geometry?.type === 'LineString') {
      accessRoad = f;
      map.getSource('access-line')?.setData(fc([accessRoad]));
      draw.deleteAll();
      draw.changeMode('simple_select');
      mode = null;
      setStats('<p>Access road saved. You can draw <b>Parks</b> (optional) or hit <b>Generate</b>.</p>');
    }
    if (mode === 'park' && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')) {
      parksFC.features.push(f);
      map.getSource('parks')?.setData(parksFC);
      draw.delete(f.id);
      draw.changeMode('draw_polygon'); // keep park mode active for multiple parks
      setStats(<p>Parks: ${parksFC.features.length}. Draw more parks or click <b>Generate</b>.</p>);
    }
  }
  function wireUI() {
    // Buttons
    $('drawSite').onclick = () => {
      mode = 'site';
      parksFC = emptyFC(); map.getSource('parks')?.setData(parksFC);
      accessRoad = null;   map.getSource('access-line')?.setData(emptyFC());
      map.getSource('roads-view')?.setData(emptyFC());
      map.getSource('homes')?.setData(emptyFC());
      draw.deleteAll();
      draw.changeMode('draw_polygon');
      setStats('<p>Draw the site boundary: click to add vertices, double‑click to finish.</p>');
    };
    $('pickAccess').onclick = () => {
      if (!siteBoundary) { alert('Draw the site boundary first.'); return; }
      mode = 'access';
      draw.deleteAll();
      draw.changeMode('draw_line_string');
      setStats('<p>Draw the main access road (line). Double‑click to finish.</p>');
    };
    $('drawPark').onclick = () => {
      if (!siteBoundary) { alert('Draw the site boundary first.'); return; }
      mode = 'park';
      draw.changeMode('draw_polygon');
      setStats('<p>Draw a park polygon inside the site. Double‑click to finish. (You can draw multiple.)</p>');
    };
    $('clearParks').onclick = () => {
      parksFC = emptyFC();
      map.getSource('parks')?.setData(parksFC);
      setStats('<p>Parks cleared. You can draw new ones or Generate.</p>');
      // re-run with parks cleared
      if (siteBoundary) generatePlan(map, siteBoundary, accessRoad, parksFC);
    };
    $('generate').onclick = () => {
      generatePlan(map, siteBoundary, accessRoad, parksFC);
    };
    $('clearAll').onclick = () => {
      mode = null;
      siteBoundary = null;
      accessRoad = null;
      parksFC = emptyFC();
      draw.deleteAll();
      map.getSource('site-view')?.setData(emptyFC());
      map.getSource('access-line')?.setData(emptyFC());
      map.getSource('parks')?.setData(emptyFC());
      map.getSource('roads-view')?.setData(emptyFC());
      map.getSource('homes')?.setData(emptyFC());
      setStats('<p>Cleared. Start again with <b>Draw Site Boundary</b>.</p>');
    };
    // Live updates on inputs
    ['houseType','frontSetback','sideGap'].forEach(id => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', () => {
        if (siteBoundary) generatePlan(map, siteBoundary, accessRoad, parksFC);
      });
    });
  }
});
