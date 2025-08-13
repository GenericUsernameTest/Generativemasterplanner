// main.js  (use with <script type="module" src="main.js"></script>)
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
  let currentMode = null; // 'site' | 'access' | 'park'
  let siteBoundary = null;              // Feature<Polygon|MultiPolygon>
  let accessRoad   = null;              // Feature<LineString>
  let parksFC      = emptyFC();         // FeatureCollection<Polygon>

  map.on('load', () => {
    // Sources
    map.addSource('site-view',   { type: 'geojson', data: emptyFC() });
    map.addSource('roads-view',  { type: 'geojson', data: emptyFC() });
    map.addSource('homes',       { type: 'geojson', data: emptyFC() });
    map.addSource('access-line', { type: 'geojson', data: emptyFC() });
    map.addSource('parks',       { type: 'geojson', data: emptyFC() });

    // Layers
    map.addLayer({ id: 'site-fill', type: 'fill', source: 'site-view',
      paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.12 }});
    map.addLayer({ id: 'site-outline', type: 'line', source: 'site-view',
      paint: { 'line-color': '#16a34a', 'line-width': 4, 'line-opacity': 0.9 }});

    map.addLayer({ id: 'roads-fill', type: 'fill', source: 'roads-view',
      paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.55 }});

    map.addLayer({ id: 'access-line-view', type: 'line', source: 'access-line',
      paint: { 'line-color': '#111827', 'line-width': 3, 'line-dasharray': [2,1], 'line-opacity': 0.85 }});

    map.addLayer({ id: 'parks-fill', type: 'fill', source: 'parks',
      paint: { 'fill-color': '#34d399', 'fill-opacity': 0.35 }});

    map.addLayer({
      id: 'homes-3d', type: 'fill-extrusion', source: 'homes',
      paint: {
        'fill-extrusion-color': ['coalesce', ['get', 'color'], '#6699ff'],
        'fill-extrusion-height': ['coalesce', ['get', 'height'], 4],
        'fill-extrusion-opacity': 0.78
      }
    });

    // Draw control
    draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: false, line_string: false, trash: false } // we’ll switch modes programmatically
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

    if (currentMode === 'site' && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')) {
      siteBoundary = f;
      map.getSource('site-view')?.setData(fc([siteBoundary]));

      // Optional: prefill rotation hint if you keep that input around
      const autoA = getLongestEdgeAngle(siteBoundary);
      const angleEl = $('rotationAngle');
      if (angleEl && (angleEl.value ?? '') === '') angleEl.value = autoA.toFixed(1);

      setStats('<p>Site saved. Draw your <b>Access Road</b> next.</p>');
      // Clear the canvas so users don’t accidentally edit the polygon
      draw.deleteAll();
      currentMode = null;
      return;
    }

    if (currentMode === 'access' && f.geometry?.type === 'LineString') {
      accessRoad = f;
      map.getSource('access-line')?.setData(fc([accessRoad]));
      // keep the line on screen; do not delete
      currentMode = null;
      return;
    }

    if (currentMode === 'park' && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')) {
      // Store as a simple polygon (if MultiPolygon, push each polygon’s outer)
      if (f.geometry.type === 'Polygon') {
        parksFC.features.push(f);
      } else {
        // MultiPolygon => split into Polygons
        for (const poly of f.geometry.coordinates) {
          parksFC.features.push({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: poly }
          });
        }
      }
      map.getSource('parks')?.setData(parksFC);
      // remove the temporary draw feature so only our styled layer remains
      try { draw.delete(f.id); } catch {}
      currentMode = null;

      // Auto-regenerate if we already have site + access
      if (siteBoundary && accessRoad) safeGenerate();
      return;
    }
  }

  function wireToolbar() {
    // Draw Site
    const siteBtn = $('drawSite');
    if (siteBtn) {
      siteBtn.onclick = () => {
        clearOutputs();
        siteBoundary = null;
        accessRoad   = null;
        parksFC      = emptyFC();
        refreshSources();
        draw.deleteAll();
        currentMode = 'site';
        draw.changeMode('draw_polygon');
        setStats('<p>Draw the <b>Site Boundary</b> (click to add points, double‑click to finish).</p>');
      };
    }

    // Draw Access Road (line)
    const roadsBtn = $('drawRoads');
    if (roadsBtn) {
      roadsBtn.onclick = () => {
        if (!siteBoundary) { alert('Draw the site boundary first.'); return; }
        currentMode = 'access';
        draw.changeMode('draw_line_string');
        setStats('<p>Draw the <b>Access Road</b>. Double‑click to finish.</p>');
      };
    }

    // Draw Park polygon
    // (Add a <button id="drawPark">Draw Park</button> to your HTML to show this in the UI)
    const parkBtn = $('drawPark');
    if (parkBtn) {
      parkBtn.onclick = () => {
        if (!siteBoundary) { alert('Draw the site boundary first.'); return; }
        currentMode = 'park';
        draw.changeMode('draw_polygon');
        setStats('<p>Draw a <b>Park</b> polygon inside the site. You can add multiple.</p>');
      };
    }

    // Fill with Homes
    const fillBtn = $('fillHomes');
    if (fillBtn) {
      fillBtn.onclick = () => safeGenerate();
    }

    // Clear All
    const clearBtn = $('clearAll');
    if (clearBtn) {
      clearBtn.onclick = () => {
        siteBoundary = null;
        accessRoad   = null;
        parksFC      = emptyFC();
        clearOutputs();
        refreshSources();
        draw.deleteAll();
        currentMode = null;
      };
    }

    // If you keep rotation/house controls, you can live‑regenerate on change:
    ['rotationAngle', 'houseType', 'frontSetback', 'sideGap'].forEach(id => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', () => {
        if (siteBoundary && accessRoad) safeGenerate();
      });
    });
  }

  function safeGenerate() {
    try {
      generatePlan(map, siteBoundary, accessRoad, parksFC);
    } catch (err) {
      console.error(err);
      alert('Generate Plan failed. Check console for details.');
    }
  }

  function refreshSources() {
    map.getSource('site-view')?.setData(siteBoundary ? fc([siteBoundary]) : emptyFC());
    map.getSource('access-line')?.setData(accessRoad ? fc([accessRoad]) : emptyFC());
    map.getSource('parks')?.setData(parksFC || emptyFC());
  }

  function clearOutputs() {
    map.getSource('roads-view')?.setData(emptyFC());
    map.getSource('homes')?.setData(emptyFC());
    setStats('');
  }
});
