import { $, emptyFC, fc, setStats, getLongestEdgeAngle } from './utils.js';
import { generatePlan } from './generatePlan.js';

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

  let draw, siteBoundary = null;

  map.on('load', () => {
    map.addSource('site-view', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'site-fill', type: 'fill', source: 'site-view',
      paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.12 }});
    map.addLayer({ id: 'site-view', type: 'line', source: 'site-view',
      paint: { 'line-color': '#16a34a', 'line-width': 4, 'line-opacity': 0.9 }});

    map.addSource('roads-view', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'roads-view', type: 'fill', source: 'roads-view',
      paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.55 }});

    map.addSource('homes', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'homes', type: 'fill-extrusion', source: 'homes',
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': 4,
        'fill-extrusion-opacity': 0.78
      }
    });

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

    wireToolbar();
  });

  function wireToolbar() {
    $('drawSite').onclick = () => {
      clearOutputs(); siteBoundary = null; refreshSite();
      draw.deleteAll(); draw.changeMode('draw_polygon');
    };
    $('fillHomes').onclick = () => generatePlan(map, siteBoundary);
    $('clearAll').onclick = () => { clearOutputs(); siteBoundary = null; refreshSite(); draw.deleteAll(); };

    // Live update
    ['rotationAngle', 'houseType', 'frontSetback', 'sideGap'].forEach(id => {
      $(id).addEventListener('input', () => { if (siteBoundary) generatePlan(map, siteBoundary); });
    });
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
