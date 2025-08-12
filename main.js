// main.js
import { $, emptyFC, fc, setStats, getLongestEdgeAngle } from './utils.js';
import { generatePlan } from './generateplan.js';
import { createRoads } from './createroads.js';

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

  // ---- App state ----
  let draw = null;                 // Mapbox Draw (for site polygon)
  let siteBoundary = null;         // Polygon
  let entranceRoad = null;         // LineString (two-point)
  let pickingEntrance = false;     // picking mode toggle
  let entrancePts = [];            // clicked points while picking

  map.on('load', () => {
    // Sources & layers
    map.addSource('site-view', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'site-fill', type: 'fill', source: 'site-view',
      paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.12 }});
    map.addLayer({ id: 'site-view-line', type: 'line', source: 'site-view',
      paint: { 'line-color': '#16a34a', 'line-width': 4, 'line-opacity': 0.9 }});

    map.addSource('roads-view', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'roads-view', type: 'fill', source: 'roads-view',
      paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.55 }});

    // Entrance line preview
    map.addSource('entrance-view', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'entrance-line', type: 'line', source: 'entrance-view',
      paint: { 'line-color': '#111827', 'line-width': 4, 'line-dasharray': [2,2] }});

    map.addSource('homes', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'homes', type: 'fill-extrusion', source: 'homes',
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': 4,
        'fill-extrusion-opacity': 0.78
      }
    });

    // Draw control: polygon for site
    // (Kept simple: polygon + trash)
    // If you hit CSP warnings, switch to mapbox-gl-csp build as we discussed.
    // eslint-disable-next-line no-undef
    draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: true, trash: true } });
    map.addControl(draw);

    map.on('draw.create', (e) => {
      const feat = e.features?.[0];
      if (!feat || feat.geometry.type !== 'Polygon') return;
      siteBoundary = feat;
      refreshSite();
      const autoA = getLongestEdgeAngle(siteBoundary);
      if ($('rotationAngle').value === '') $('rotationAngle').value = autoA.toFixed(1);
      setStats('<p>Site boundary saved. Adjust parameters.</p>');
      draw.deleteAll();
    });

    // Mouse clicks for entrance picking
    map.on('click', (ev) => {
      if (!pickingEntrance) return;
      const ll = [ev.lngLat.lng, ev.lngLat.lat];

      // First click: start point
      if (entrancePts.length === 0) {
        entrancePts.push(ll);
        map.getCanvas().style.cursor = 'crosshair';
        previewEntrance();
        return;
      }
      // Second click: end point -> finalize
      if (entrancePts.length === 1) {
        entrancePts.push(ll);
        finalizeEntrance();
        return;
      }
    });

    wireToolbar();
  });

  // ----- Toolbar wiring -----
  function wireToolbar() {
    $('drawSite').onclick = () => {
      clearOutputs(); siteBoundary = null; refreshSite();
      draw.deleteAll(); draw.changeMode('draw_polygon');
      map.getCanvas().style.cursor = 'crosshair';
      setStats('<p>Drawing site boundary… click to add points, double‑click to finish.</p>');
    };

    $('fillHomes').onclick = () => generateNow();
    $('clearAll').onclick = () => {
      clearOutputs();
      siteBoundary = null; refreshSite();
      draw.deleteAll();
      exitEntranceMode();
    };

    const pickBtn = $('pickEntrance');
    const clearEntrBtn = $('clearEntrance');
    if (pickBtn)  pickBtn.onclick = () => enterEntranceMode();
    if (clearEntrBtn) clearEntrBtn.onclick = () => { entranceRoad = null; entrancePts = []; previewEntrance(); };

    // Live update
    ['rotationAngle','houseType','frontSetback','sideGap'].forEach(id => {
      const el = $(id); if (!el) return;
      el.addEventListener('input', () => { if (siteBoundary) generateNow(); });
    });
  }

  // ----- Helpers -----
  function refreshSite() {
    map.getSource('site-view')?.setData(siteBoundary ? fc([siteBoundary]) : emptyFC());
  }
  function clearOutputs() {
    map.getSource('roads-view')?.setData(emptyFC());
    map.getSource('homes')?.setData(emptyFC());
    map.getSource('entrance-view')?.setData(emptyFC());
    setStats('');
  }
  function generateNow() {
    try {
      generatePlan(map, siteBoundary, entranceRoad || null);
    } catch (e) {
      console.error(e);
      alert('Generate Plan failed. Check console.');
    }
  }

  // Entrance picking UX
  function enterEntranceMode() {
    if (!siteBoundary) { alert('Draw the site boundary first.'); return; }
    pickingEntrance = true;
    entrancePts = [];
    map.getCanvas().style.cursor = 'crosshair';
    setStats('<p>Click a start point for the entrance road, then click the end point.</p>');
    previewEntrance();
  }
  function exitEntranceMode() {
    pickingEntrance = false;
    entrancePts = [];
    map.getCanvas().style.cursor = '';
    previewEntrance();
  }
  function previewEntrance() {
    if (entrancePts.length === 0 && !entranceRoad) {
      map.getSource('entrance-view')?.setData(emptyFC());
      return;
    }
    const coords = entranceRoad
      ? entranceRoad.geometry.coordinates
      : entrancePts;
    const feat = (coords.length >= 2)
      ? turf.lineString(coords)
      : (coords.length === 1 ? turf.point(coords[0]) : null);

    map.getSource('entrance-view')?.setData(feat ? fc([feat]) : emptyFC());
  }
  function finalizeEntrance() {
    if (entrancePts.length < 2) return;
    // snap the two points as a LineString
    entranceRoad = turf.lineString([entrancePts[0], entrancePts[1]]);
    previewEntrance();
    exitEntranceMode();
    setStats('<p>Entrance road set. Click <b>Generate Plan</b> to build roads & homes.</p>');
  }
});
