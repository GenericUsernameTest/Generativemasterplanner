// main.js
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

  // ---- State ----
  let draw;
  let siteBoundary = null;   // Polygon
  let entranceRoad = null;   // LineString (user-drawn main entrance)

  // Expose for easy debugging in console (optional)
  window.appState = { get siteBoundary(){return siteBoundary;}, get entranceRoad(){return entranceRoad;} };

  map.on('load', () => {
    // Sources & layers
    map.addSource('site-view',   { type: 'geojson', data: emptyFC() });
    map.addSource('roads-view',  { type: 'geojson', data: emptyFC() });
    map.addSource('homes',       { type: 'geojson', data: emptyFC() });

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

    map.addLayer({
      id: 'roads-view',
      type: 'fill',
      source: 'roads-view',
      paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.55 }
    });

    map.addLayer({
      id: 'homes',
      type: 'fill-extrusion',
      source: 'homes',
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': 4,
        'fill-extrusion-opacity': 0.78
      }
    });

    // Draw control — add line tool so you can draw the entrance road
    draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, line_string: true, trash: true }
    });
    map.addControl(draw);

    // Handle new drawings
    map.on('draw.create', (e) => {
      const feat = e.features?.[0];
      if (!feat) return;

      if (feat.geometry.type === 'Polygon') {
        // Site boundary
        siteBoundary = feat;
        entranceRoad = null; // reset entrance when site changes
        refreshSite();
        const autoA = getLongestEdgeAngle(siteBoundary);
        const rot = $('rotationAngle');
        if (rot && (rot.value ?? '') === '') rot.value = autoA.toFixed(1);
        setStats('<p>Site saved. Now draw a <b>Line</b> for the main entrance road (from the site edge inward), then click <b>Generate Plan</b>.</p>');
        draw.trash(); // clear drawn geometry from draw layer
      } else if (feat.geometry.type === 'LineString') {
        // Entrance road (user line)
        if (!siteBoundary) {
          setStats('<p>Please draw the <b>site boundary</b> first, then draw the entrance road.</p>');
          draw.trash();
          return;
        }
        entranceRoad = feat;
        setStats('<p>Entrance road set. Click <b>Generate Plan</b> or tweak parameters.</p>');
        draw.trash();
      }
    });

    wireToolbar();
  });

  function wireToolbar() {
    $('drawSite').onclick = () => {
      clearOutputs();
      siteBoundary = null;
      entranceRoad = null;
      refreshSite();
      draw.deleteAll();
      draw.changeMode('draw_polygon');
      setStats('<p>Drawing site boundary… click to add points, double‑click to finish. Then use the <b>Line</b> tool to draw the entrance road.</p>');
    };

    $('fillHomes').onclick = () => {
      generatePlan(map, siteBoundary, entranceRoad);
    };

    $('clearAll').onclick = () => {
      clearOutputs();
      siteBoundary = null;
      entranceRoad = null;
      refreshSite();
      draw.deleteAll();
      setStats('');
    };

    // Live update on change (if site exists)
    ['rotationAngle', 'houseType', 'frontSetback', 'sideGap'].forEach(id => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', () => {
        if (siteBoundary) generatePlan(map, siteBoundary, entranceRoad);
      });
    });
  }

  function refreshSite() {
    map.getSource('site-view')?.setData(siteBoundary ? fc([siteBoundary]) : emptyFC());
  }
  function clearOutputs() {
    map.getSource('roads-view')?.setData(emptyFC());
    map.getSource('homes')?.setData(emptyFC());
  }
});
