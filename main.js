// main.js — wire UI + Mapbox Draw for polygon (site) and line (access road)
import { $, emptyFC, fc, setStats, getLongestEdgeAngle } from './utils.js';
import { generatePlan } from './generateplan.js';

mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

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
  let siteBoundary = null;     // Feature<Polygon|MultiPolygon>
  let entranceRoad = null;     // Feature<LineString>

  map.on('load', () => {
    // Sources & layers
    map.addSource('site-view',   { type: 'geojson', data: emptyFC() });
    map.addSource('roads-view',  { type: 'geojson', data: emptyFC() });
    map.addSource('homes',       { type: 'geojson', data: emptyFC() });
    map.addSource('access-line', { type: 'geojson', data: emptyFC() });

    map.addLayer({ id: 'site-fill', type: 'fill', source: 'site-view',
      paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.12 }});
    map.addLayer({ id: 'site-view', type: 'line', source: 'site-view',
      paint: { 'line-color': '#16a34a', 'line-width': 4, 'line-opacity': 0.9 }});

    map.addLayer({ id: 'roads-view', type: 'fill', source: 'roads-view',
      paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.55 }});

    map.addLayer({ id: 'access-line', type: 'line', source: 'access-line',
      paint: { 'line-color': '#111827', 'line-width': 3, 'line-dasharray': [2,1], 'line-opacity': 0.85 }});

    map.addLayer({
      id: 'homes', type: 'fill-extrusion', source: 'homes',
      paint: {
        'fill-extrusion-color': ['coalesce', ['get', 'color'], '#6699ff'],
        'fill-extrusion-height': 4,
        'fill-extrusion-opacity': 0.78
      }
    });

    // Draw control: polygon + line
    draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, line_string: true, trash: true }
    });
    map.addControl(draw);

    // Handle new drawings
    map.on('draw.create', onDrawChange);
    map.on('draw.update', onDrawChange);

    wireToolbar();
  });

  function onDrawChange(e){
    const f = e.features?.[0];
    if (!f) return;

    if (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon') {
      siteBoundary = f;
      refreshSite();
      // auto-rotation hint
      const autoA = getLongestEdgeAngle(siteBoundary);
      const angleEl = $('rotationAngle');
      if (angleEl && (angleEl.value ?? '') === '') angleEl.value = autoA.toFixed(1);
      setStats('<p>Site saved. Now draw your <b>Access Road</b> (Line), then Generate.</p>');
      // keep the polygon, but clear draw canvas to avoid accidental edits
      draw.deleteAll();
    }

    if (f.geometry?.type === 'LineString') {
      entranceRoad = f;
      map.getSource('access-line')?.setData(fc([entranceRoad]));
      // don’t delete line — show it for clarity
    }
  }

  function wireToolbar() {
    $('drawSite').onclick = () => {
      clearOutputs();
      siteBoundary = null;
      entranceRoad = null;
      refreshSite();
      map.getSource('access-line')?.setData(emptyFC());
      draw.deleteAll();
      draw.changeMode('draw_polygon');
      setStats('<p>Draw the site boundary: click to add points, double‑click to finish.</p>');
    };

    const pickBtn = document.getElementById('pickEntrance');
    if (pickBtn) {
      pickBtn.onclick = () => {
        if (!siteBoundary) { alert('Draw the site boundary first.'); return; }
        draw.changeMode('draw_line_string');
        setStats('<p>Draw the main access road (curved allowed). Double‑click to finish.</p>');
      };
    }

    $('fillHomes').onclick = () => generateNow();
    $('clearAll').onclick = () => {
      clearOutputs();
      siteBoundary = null;
      entranceRoad = null;
      refreshSite();
      map.getSource('access-line')?.setData(emptyFC());
      draw.deleteAll();
    };

    // Live updates when parameters change (if we have a site)
    ['rotationAngle', 'houseType', 'frontSetback', 'sideGap'].forEach(id => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', () => {
        if (siteBoundary) generateNow();
      });
    });
  }

  function generateNow(){
    try {
      generatePlan(map, siteBoundary, entranceRoad);
    } catch (err) {
      console.error(err);
      alert('Generate Plan failed. Check console for details.');
    }
  }

  function clearOutputs() {
    map.getSource('roads-view')?.setData(emptyFC());
    map.getSource('homes')?.setData(emptyFC());
    setStats('');
  }

  function refreshSite() {
    map.getSource('site-view')?.setData(siteBoundary ? fc([siteBoundary]) : emptyFC());
  }
});
