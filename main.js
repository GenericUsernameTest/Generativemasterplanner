// main.js — wire UI + Mapbox Draw for polygon (site) and line (access road)
import { $, emptyFC, fc, setStats, getLongestEdgeAngle } from './utils.js';
import { generatePlan } from './generateplan.js';

mapboxgl.accessToken =
  'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

document.addEventListener('DOMContentLoaded', () => {
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

  // ---------- state ----------
  let draw;
  let siteBoundary = null;   // Feature<Polygon|MultiPolygon>
  let entranceRoad = null;   // Feature<LineString>

  map.on('load', () => {
    // Sources
    map.addSource('site-view',   { type: 'geojson', data: emptyFC() });
    map.addSource('roads-view',  { type: 'geojson', data: emptyFC() });
    map.addSource('homes',       { type: 'geojson', data: emptyFC() });
    map.addSource('access-line', { type: 'geojson', data: emptyFC() });

    // Layers
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

    // Handle drawings
    map.on('draw.create', onDrawChange);
    map.on('draw.update', onDrawChange);
    map.on('draw.modechange', () => { map.getCanvas().style.cursor = ''; });

    wireToolbar();
  });

  function onDrawChange(e){
    const f = e.features?.[0];
    if (!f) return;

    if (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon') {
      siteBoundary = f;
      refreshSite();

      // Auto-rotation hint
      const autoA = getLongestEdgeAngle(siteBoundary);
      const angleEl = $('rotationAngle');
      if (angleEl && (angleEl.value ?? '') === '') angleEl.value = autoA.toFixed(1);

      setStats('<p>Site saved. Now click <b>Pick Access Road</b> and draw your entrance line (curves allowed), then <b>Generate Plan</b>.</p>');

      // Keep the polygon visible via our layer; clear Draw canvas to avoid accidental edits
      draw.deleteAll();
    }

    if (f.geometry?.type === 'LineString') {
      entranceRoad = f;
      map.getSource('access-line')?.setData(fc([entranceRoad]));
      setStats('<p>Access road saved. Click <b>Generate Plan</b> to build the spine and homes.</p>');
    }
  }

  function wireToolbar() {
    const drawSiteBtn = $('drawSite');
    const pickBtn     = $('pickEntrance');
    const genBtn      = $('fillHomes');
    const clearBtn    = $('clearAll');

    if (drawSiteBtn) {
      drawSiteBtn.onclick = () => {
        clearOutputs();
        siteBoundary = null;
        entranceRoad = null;
        refreshSite();
        map.getSource('access-line')?.setData(emptyFC());
        draw.deleteAll();
        draw.changeMode('draw_polygon');
        map.getCanvas().style.cursor = 'crosshair';
        setStats('<p>Draw the site boundary: click to add points, double‑click to finish.</p>');
      };
    }

    if (pickBtn) {
      pickBtn.onclick = () => {
        if (!siteBoundary) { alert('Draw the site boundary first.'); return; }
        draw.changeMode('draw_line_string');
        map.getCanvas().style.cursor = 'crosshair';
        setStats('<p>Draw the main access road (curved allowed). Double‑click to finish.</p>');
      };
    }

    if (genBtn) {
      genBtn.onclick = () => generateNow();
    }

    if (clearBtn) {
      clearBtn.onclick = () => {
        clearOutputs();
        siteBoundary = null;
        entranceRoad = null;
        refreshSite();
        map.getSource('access-line')?.setData(emptyFC());
        if (draw) draw.deleteAll();
      };
    }

    // Live updates when parameters change
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
