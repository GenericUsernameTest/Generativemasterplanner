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

  // -------- state --------
  let draw;
  let siteBoundary = null;
  let entranceRoad = null;         // LineString feature
  let pickingEntrance = false;     // flag while drawing entrance

  map.on('load', () => {
    // site
    map.addSource('site-view', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'site-fill', type: 'fill', source: 'site-view',
      paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.12 }});
    map.addLayer({ id: 'site-view', type: 'line', source: 'site-view',
      paint: { 'line-color': '#16a34a', 'line-width': 4, 'line-opacity': 0.9 }});

    // roads (generated)
    map.addSource('roads-view', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'roads-view', type: 'fill', source: 'roads-view',
      paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.55 }});

    // homes
    map.addSource('homes', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'homes', type: 'fill-extrusion', source: 'homes',
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': 4,
        'fill-extrusion-opacity': 0.78
      }
    });

    // entrance road (user line)
    map.addSource('entrance-src', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'entrance-line',
      type: 'line',
      source: 'entrance-src',
      paint: {
        'line-color': '#0ea5e9',
        'line-width': 4,
        'line-dasharray': [2, 2]
      }
    });

    // draw control
    draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, trash: true }
    });
    map.addControl(draw);

    // Handle new drawings (site or entrance)
    map.on('draw.create', (e) => {
      const feat = e.features?.[0];
      if (!feat) return;

      if (pickingEntrance && feat.geometry.type === 'LineString') {
        // Save entrance, clean up temp drawing
        entranceRoad = feat;
        pickingEntrance = false;
        updateEntranceLayer();
        // remove the temp feature from draw so it doesn't stick around
        try { draw.delete(feat.id); } catch {}
        map.getCanvas().style.cursor = '';

        // Generate using current site + entrance (3rd arg is optional in your function)
        if (siteBoundary) generatePlan(map, siteBoundary, entranceRoad);
        return;
      }

      if (feat.geometry.type === 'Polygon') {
        siteBoundary = feat;
        updateSite();
        // seed rotation
        const autoA = getLongestEdgeAngle(siteBoundary);
        const angleEl = $('rotationAngle');
        if (angleEl && angleEl.value === '') angleEl.value = autoA.toFixed(1);
        setStats('<p>Site boundary saved. Adjust parameters.</p>');
        // tidy the draw canvas
        try { draw.deleteAll(); } catch {}
        map.getCanvas().style.cursor = '';
      }
    });

    wireToolbar();
  });

  function wireToolbar() {
    const drawBtn     = $('drawSite');
    const genBtn      = $('fillHomes');
    const clearBtn    = $('clearAll');
    const pickEntBtn  = $('pickEntrance');
    const clearEntBtn = $('clearEntrance');

    if (drawBtn) {
      drawBtn.onclick = () => {
        clearOutputs();
        siteBoundary = null;
        updateSite();
        try { draw.deleteAll(); } catch {}
        draw.changeMode('draw_polygon');
        map.getCanvas().style.cursor = 'crosshair';
        setStats('<p>Drawing site boundary… click to add points, double‑click to finish.</p>');
      };
    }

    if (genBtn) {
      genBtn.onclick = () => {
        if (!siteBoundary) return alert('Draw the site boundary first.');
        generatePlan(map, siteBoundary, entranceRoad);
      };
    }

    if (clearBtn) {
      clearBtn.onclick = () => {
        pickingEntrance = false;
        entranceRoad = null;
        siteBoundary = null;
        try { draw.deleteAll(); } catch {}
        clearOutputs();
        updateSite();
        updateEntranceLayer();
        setStats('');
      };
    }

    if (pickEntBtn) {
      pickEntBtn.onclick = () => {
        if (!siteBoundary) return alert('Draw the site boundary first.');
        pickingEntrance = true;
        // switch to line drawing mode
        draw.changeMode('draw_line_string');
        map.getCanvas().style.cursor = 'crosshair';
        setStats('<p>Pick entrance: click start on site edge, click inside to set direction, double‑click to finish.</p>');
      };
    }

    if (clearEntBtn) {
      clearEntBtn.onclick = () => {
        entranceRoad = null;
        pickingEntrance = false;
        updateEntranceLayer();
        setStats('<p>Entrance road cleared.</p>');
      };
    }

    // Live updates
    ['rotationAngle', 'houseType', 'frontSetback', 'sideGap'].forEach(id => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', () => {
        if (siteBoundary) generatePlan(map, siteBoundary, entranceRoad);
      });
    });
  }

  // helpers
  function updateSite() {
    map.getSource('site-view')?.setData(siteBoundary ? fc([siteBoundary]) : emptyFC());
  }
  function updateEntranceLayer() {
    map.getSource('entrance-src')?.setData(entranceRoad ? fc([entranceRoad]) : emptyFC());
  }
  function clearOutputs() {
    map.getSource('roads-view')?.setData(emptyFC());
    map.getSource('homes')?.setData(emptyFC());
    map.getSource('entrance-src')?.setData(emptyFC());
  }
});
