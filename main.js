// ====== CONFIG ======
mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

// ====== MAP INIT (remember last view) ======
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

// ====== SEARCH (guarded) ======
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
  console.warn('MapboxGeocoder script not loaded — search disabled.');
}

// ====== STATE ======
let draw;                  // Mapbox Draw
let siteBoundary = null;   // Feature<Polygon>
let roads = [];            // Feature<Polygon>[]
const $ = (id) => document.getElementById(id);
const setStats = (html) => { const el = $('stats'); if (el) el.innerHTML = html; };

// ====== MAP LOAD ======
map.on('load', () => {
  // Sources / layers
  map.addSource('site-view',  { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'site-view',
    type: 'line',
    source: 'site-view',
    paint: { 'line-color': '#16a34a', 'line-width': 10 } // final saved boundary thickness
  });

  map.addSource('roads-view', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'roads-view',
    type: 'fill',
    source: 'roads-view',
    paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.6 }
  });

  map.addSource('homes', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'homes',
    type: 'fill-extrusion',
    source: 'homes',
    paint: {
      'fill-extrusion-color': '#6699ff',
      'fill-extrusion-height': ['coalesce', ['get','height'], 4], // fallback 4 m
      'fill-extrusion-opacity': 0.75
    }
  });

  // ---- Draw (no custom styles here; we’ll tweak after) ----
  draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: { polygon: true, trash: true }
  });
  map.addControl(draw);

  // Tweak Mapbox Draw layer styles safely (after they exist)
  const tuneDrawStyles = () => {
    const edits = [
      // Active polygon stroke (green while drawing)
      ['gl-draw-polygon-stroke-active',   'line-color', '#16a34a'],
      ['gl-draw-polygon-stroke-active',   'line-width', 4],

      // Inactive polygon stroke (orange by default)
      ['gl-draw-polygon-stroke-inactive', 'line-color', '#16a34a'],
      ['gl-draw-polygon-stroke-inactive', 'line-width', 4],

      // Optional: soften inactive fill
      ['gl-draw-polygon-fill-inactive',   'fill-color', '#16a34a'],
      ['gl-draw-polygon-fill-inactive',   'fill-opacity', 0.04]
    ];
    edits.forEach(([id, prop, val]) => {
      if (map.getLayer(id)) {
        try { map.setPaintProperty(id, prop, val); } catch(e) {}
      }
    });
  };

  // Run once now, and again if the style reloads or modes change
  tuneDrawStyles();
  map.on('styledata', tuneDrawStyles);
  map.on('draw.modechange', () => {
    map.getCanvas().style.cursor = '';
    tuneDrawStyles();
  });

  wireToolbar();

  // When a polygon is created, decide if it's site or a road
  map.on('draw.create', (e) => {
    const feat = e.features[0];
    if (!feat || feat.geometry.type !== 'Polygon') return;

    if (!siteBoundary) {
      siteBoundary = feat;
      refreshSite();
      setStats('<p>Site boundary saved. Click <b>Draw Roads</b> to add road polygons, then <b>Fill with Homes</b>.</p>');
    } else {
      roads.push(feat);
      refreshRoads();
      setStats(`<p>Road added. Total roads: ${roads.length}. Click <b>Fill with Homes</b> when ready.</p>`);
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
    setStats('<p>Drawing site boundary… click to add points, double‑click to finish.</p>');
  };

  $('drawRoads').onclick = () => {
    if (!siteBoundary) { alert('Draw the site boundary first.'); return; }
    draw.changeMode('draw_polygon');
    map.getCanvas().style.cursor = 'crosshair';
    setStats('<p>Drawing roads… add one or more polygons inside the site, double‑click to finish each.</p>');
  };

  $('fillHomes').onclick = () => fillHomes();

  $('clearAll').onclick = () => {
    draw.deleteAll();
    siteBoundary = null;
    roads = [];
    refreshSite();
    refreshRoads();
    clearHomes();
    // leave stats empty
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
    catch (err) { console.warn('union failed on feature', i, err); }
  }
  return u;
}

// ====== Home generation (width, depth, gaps, height) ======
function fillHomes() {
  if (!siteBoundary) { alert('Draw the site boundary first.'); return; }

  // Buildable = site − union(roads)
  let buildable = siteBoundary;
  if (roads.length) {
    const roadsU = unionAll(roads);
    try { buildable = turf.difference(siteBoundary, roadsU) || siteBoundary; }
    catch (err) { console.warn('difference failed; using site as buildable', err); }
  }

  // --------- PARAMETERS ---------
  const homeWidthM   = 6.5;  // building width
  const homeDepthM   = 10;   // building depth
  const homeHeightM  = 4;    // extrusion height
  const gapSideM     = 2;    // gap left/right
  const gapFrontM    = 5;    // gap front/back
  const edgeMarginM  = 0.5;  // clearance from edges
  // ------------------------------

  // Inset buildable polygon so homes fit
  const halfMax = Math.max(homeWidthM, homeDepthM) / 2;
  let placementArea;
  try {
    placementArea = turf.buffer(buildable, -(halfMax + edgeMarginM), { units: 'meters' });
    if (!placementArea ||
        (placementArea.geometry.type !== 'Polygon' && placementArea.geometry.type !== 'MultiPolygon')) {
      placementArea = buildable;
    }
  } catch (e) {
    console.warn('inset buffer failed, placing on original buildable', e);
    placementArea = buildable;
  }

  const areaM2 = turf.area(buildable);
  const ha     = areaM2 / 10000;

  // meters → degrees at site latitude
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
