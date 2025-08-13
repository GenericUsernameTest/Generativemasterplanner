// main.js — wire UI + Mapbox Draw for site (polygon) and access road (line)
import { $, emptyFC, fc, setStats } from './utils.js';
import { generatePlan } from './generateplan.js';

mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';

// Use your custom style or swap to a stock one if needed
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';
// const STYLE_URL = 'mapbox://styles/mapbox/light-v11';

document.addEventListener('DOMContentLoaded', () => {
  const savedView = JSON.parse(localStorage.getItem('mapView') || '{}');

  const map = new mapboxgl.Map({
    container: 'map',
    style: STYLE_URL,
    center: savedView.center || [0, 20],
    zoom: typeof savedView.zoom === 'number' ? savedView.zoom : 2,
    pitch: savedView.pitch || 0,
    bearing: savedView.bearing || 0
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

  // ---------- state ----------
  let draw;
  let siteBoundary = null;   // Feature<Polygon|MultiPolygon>
  let accessRoad   = null;   // Feature<LineString>

  map.on('load', () => {
    // Sources
    map.addSource('site-view',   { type: 'geojson', data: emptyFC() });
    map.addSource('roads-view',  { type: 'geojson', data: emptyFC() });
    map.addSource('homes',       { type: 'geojson', data: emptyFC() });
    map.addSource('access-line', { type: 'geojson', data: emptyFC() });

    // Layers
    map.addLayer({ id: 'site-fill', type: 'fill', source: 'site-view',
      paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.12 }});
    map.addLayer({ id: 'site-outline', type: 'line', source: 'site-view',
      paint: { 'line-color': '#16a34a', 'line-width': 4, 'line-opacity': 0.9 }});

    map.addLayer({ id: 'roads-fill', type: 'fill', source: 'roads-view',
      paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.55 }});

    map.addLayer({ id: 'access-line-layer', type: 'line', source: 'access-line',
      paint: { 'line-color': '#111827', 'line-width': 3, 'line-dasharray': [2,1], 'line-opacity': 0.9 }});

    map.addLayer({
      id: 'homes-extrude', type: 'fill-extrusion', source: 'homes',
      paint: {
        'fill-extrusion-color': ['coalesce', ['get', 'color'], '#6699ff'],
        'fill-extrusion-height': 4,
        'fill-extrusion-opacity': 0.78
      }
    });

    // Draw control (we trigger modes via our buttons)
    draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {}, // no built-in buttons; we use our own
      defaultMode: 'simple_select'
    });
    map.addControl(draw);

    // React to drawings
    map.on('draw.create', onDrawChange);
    map.on('draw.update', onDrawChange);

    // Wire toolbar buttons
    wireToolbar();
    setStats('<p>Draw the <b>Site Boundary</b> to begin.</p>');
  });

  function onDrawChange(e){
    const f = e.features?.[0];
    if (!f || !f.geometry) return;

    if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
      siteBoundary = f;
      map.getSource('site-view')?.setData(fc([siteBoundary]));
      setStats('<p>Site saved. Now click <b>Draw Roads</b> and sketch the access road (line). Double‑click to finish.</p>');
      // Leave feature on the map; switch back to select so user can click Draw Roads next
      draw.changeMode('simple_select');
    }

    if (f.geometry.type === 'LineString') {
      accessRoad = f;
      map.getSource('access-line')?.setData(fc([accessRoad]));
      setStats('<p>Access road captured. Click <b>Fill with Homes</b> to generate.</p>');
      draw.changeMode('simple_select');
    }
  }

  function wireToolbar() {
    $('drawSite').onclick = () => {
      clearOutputs();
      siteBoundary = null;
      accessRoad   = null;
      map.getSource('site-view')?.setData(emptyFC());
      map.getSource('access-line')?.setData(emptyFC());
      draw.deleteAll();
      draw.changeMode('draw_polygon');
      setStats('<p>Draw the site boundary: click to add points, double‑click to finish.</p>');
    };

    $('drawRoads').onclick = () => {
      if (!siteBoundary) { alert('Draw the site boundary first.'); return; }
      draw.changeMode('draw_line_string');
      setStats('<p>Draw the access road as a line into the site. Double‑click to finish.</p>');
    };

    $('fillHomes').onclick = () => {
      if (!siteBoundary) { alert('Draw the site boundary first.'); return; }
      try {
        generatePlan(map, siteBoundary, accessRoad);
      } catch (err) {
        console.error(err);
        alert('Generate Plan failed. Check console for details.');
      }
    };

    $('clearAll').onclick = () => {
      clearOutputs();
      siteBoundary = null;
      accessRoad   = null;
      map.getSource('site-view')?.setData(emptyFC());
      map.getSource('access-line')?.setData(emptyFC());
      draw.deleteAll();
      setStats('<p>Cleared. Draw the <b>Site Boundary</b> to begin.</p>');
    };

    // Live updates on rotation if you keep that input
    const rot = $('rotationAngle');
    if (rot) {
      rot.addEventListener('input', () => {
        if (siteBoundary) {
          try { generatePlan(map, siteBoundary, accessRoad); } catch(e){ console.error(e); }
        }
      });
    }
  }

  function clearOutputs() {
    map.getSource('roads-view')?.setData(emptyFC());
    map.getSource('homes')?.setData(emptyFC());
  }
});
