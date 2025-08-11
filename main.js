// ====== CONFIG ======
mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

// ====== MAP INIT ======
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

// ====== SEARCH ======
if (typeof MapboxGeocoder !== 'undefined') {
  const geocoder = new MapboxGeocoder({
    accessToken: mapboxgl.accessToken,
    mapboxgl,
    marker: false,
    placeholder: 'Search for a place',
    types: 'place,postcode,address,poi',
    language: 'en'
  });
  map.addControl(geocoder, 'top-left');
  geocoder.on('result', (e) =>
    map.easeTo({ center: e.result.center, zoom: 16, pitch: 60, bearing: -15 })
  );
} else {
  console.warn('MapboxGeocoder not loaded — search disabled.');
}

// ====== STATE ======
let draw;
let siteBoundary = null;
let roads = [];
const $ = (id) => document.getElementById(id);
const setStats = (html) => { const el = $('stats'); if (el) el.innerHTML = html; };

// ====== MAP LOAD ======
map.on('load', () => {
  // Site boundary
  map.addSource('site-view', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'site-fill',
    type: 'fill',
    source: 'site-view',
    paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.2 }
  });
  map.addLayer({
    id: 'site-outline',
    type: 'line',
    source: 'site-view',
    paint: { 'line-color': '#16a34a', 'line-width': 4 }
  });

  // Roads
  map.addSource('roads-view', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'roads-view',
    type: 'fill',
    source: 'roads-view',
    paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.6 }
  });

  // Homes
  map.addSource('homes', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'homes',
    type: 'fill-extrusion',
    source: 'homes',
    paint: {
      'fill-extrusion-color': '#6699ff',
      'fill-extrusion-height': ['coalesce', ['get', 'height'], 4],
      'fill-extrusion-opacity': 0.75
    }
  });

  // Draw control
  draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: { polygon: true, trash: true }
  });
  map.addControl(draw);

  // Style tweaks
  const tuneDrawStyles = () => {
    const edits = [
      ['gl-draw-polygon-stroke-active',   'line-color', '#16a34a'],
      ['gl-draw-polygon-stroke-active',   'line-width', 2],
      ['gl-draw-polygon-stroke-inactive', 'line-color', '#16a34a'],
      ['gl-draw-polygon-stroke-inactive', 'line-width', 4],
      ['gl-draw-polygon-fill-inactive',   'fill-color', '#16a34a'],
      ['gl-draw-polygon-fill-inactive',   'fill-opacity', 0.04]
    ];
    edits.forEach(([id, prop, val]) => {
      if (map.getLayer(id)) {
        try { map.setPaintProperty(id, prop, val); } catch(e) {}
      }
    });
  };
  tuneDrawStyles();
  map.on('styledata', tuneDrawStyles);
  map.on('draw.modechange', () => {
    map.getCanvas().style.cursor = '';
    tuneDrawStyles();
  });

  wireToolbar();

  // Handle draw complete
  map.on('draw.create', (e) => {
    const feat = e.features[0];
    if (!feat || feat.geometry.type !== 'Polygon') return;
    if (!siteBoundary) {
      siteBoundary = feat;
      refreshSite();
      setStats('<p>Site boundary saved. Click <b>Draw Roads</b> next.</p>');
    } else {
      roads.push(feat);
      refreshRoads();
      setStats(`<p>Road added. Total roads: ${roads.length}.</p>`);
    }
    draw.deleteAll();
    map.getCanvas().style.cursor = '';
  });
});

// ====== Toolbar ======
function wireToolbar() {
  $('drawSite').onclick = () => {
    draw.deleteAll();
    siteBoundary = null;
    roads = [];
    refreshSite();
    refreshRoads();
    clearHomes();
    draw.changeMode('draw_polygon');
    map.getCanvas().style.cursor = 'crosshair';
    setStats('<p>Drawing site boundary…</p>');
  };
  $('drawRoads').onclick = () => {
    if (!siteBoundary) { alert('Draw the site boundary first.'); return; }
    draw.changeMode('draw_polygon');
    map.getCanvas().style.cursor = 'crosshair';
    setStats('<p>Drawing roads…</p>');
  };
  $('fillHomes').onclick = () => fillHomes();
  $('clearAll').onclick = () => {
    draw.deleteAll();
    siteBoundary = null;
    roads = [];
    refreshSite();
    refreshRoads();
    clearHomes();
  };
}

// ====== Rendering helpers ======
function refreshSite()   { map.getSource('site-view').setData(siteBoundary ? fc([siteBoundary]) : emptyFC()); }
function refreshRoads()  { map.getSource('roads-view').setData(roads.length ? fc(roads) : emptyFC()); }
function clearHomes()    { map.getSource('homes').setData(emptyFC()); }
function fc(features)    { return { type: 'FeatureCollection', features }; }
function emptyFC()       { return { type: 'FeatureCollection', features: [] }; }

// ====== Geometry helpers ======
function unionAll(features) {
  if (!features.length) return null;
  let u = features[0];
  for (let i = 1; i < features.length; i++) {
    try { u = turf.union(u, features[i]); }
    catch (err) { console.warn('union failed', err); }
  }
  return u;
}

// ====== Home generation ======
function fillHomes() {
  if (!siteBoundary) { alert('Draw the site boundary first.'); return; }

  // Buildable area
  let buildable = siteBoundary;
  if (roads.length) {
    const roadsU = unionAll(roads);
    try { buildable = turf.difference(siteBoundary, roadsU) || siteBoundary; }
    catch (err) { console.warn('difference failed', err); }
  }

  // Parameters
  const homeWidthM   = 6.5;
  const homeDepthM   = 10;
  const homeHeightM  = 4;
  const gapSideM     = 2;
  const gapFrontM    = 5;
  const edgeMarginM  = 0.5;

  // Inset buildable area
  const halfMax = Math.max(homeWidthM, homeDepthM) / 2;
  let placementArea;
  try {
    placementArea = turf.buffer(buildable, -(halfMax + edgeMarginM), { units: 'meters' });
    if (!placementArea ||
        (placementArea.geometry.type !== 'Polygon' && placementArea.geometry.type !== 'MultiPolygon')) {
      placementArea = buildable;
    }
  } catch (e) {
    console.warn('buffer failed', e);
    placementArea = buildable;
  }

  const areaM2 = turf.area(buildable);
  const ha     = areaM2 / 10000;

  // Step sizes
  const lat      = turf.center(buildable).geometry.coordinates[1];
  const dLat     = 1 / 110540;
  const dLon     = 1 / (111320 * Math.cos(lat * Math.PI / 180));
  const widthLon = homeWidthM * dLon;
  const depthLat = homeDepthM * dLat;
  const stepLon  = (homeWidthM + gapSideM) * dLon;
  const stepLat  = (homeDepthM + gapFrontM) * dLat;

  const bbox  = turf.bbox(buildable);
  const homes = [];

  for (let x = bbox[0]; x < bbox[2]; x += stepLon) {
    for (let y = bbox[1]; y < bbox[3]; y += stepLat) {
      const cx = x + stepLon / 2, cy = y + stepLat / 2;
      const halfLon = widthLon / 2, halfLat = depthLat / 2;
      const homePoly = turf.polygon([[
        [cx - halfLon, cy - halfLat],
        [cx + halfLon, cy - halfLat],
        [cx + halfLon, cy + halfLat],
        [cx - halfLon, cy + halfLat],
        [cx - halfLon, cy - halfLat]
      ]], { height: homeHeightM });
      if (turf.booleanWithin(homePoly, placementArea)) {
        homes.push(homePoly);
      }
    }
  }

  map.getSource('homes').setData(fc(homes));

  setStats(`
    <p><strong>Buildable area:</strong> ${Math.round(areaM2).toLocaleString()} m² (${ha.toFixed(2)} ha)</p>
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Actual density:</strong> ${(homes.length / ha || 0).toFixed(1)} homes/ha</p>
  `);
}
