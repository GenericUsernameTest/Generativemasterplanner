// ========= CONFIG =========
mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

// ========= MAP INIT (remember last view) =========
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

// ========= STATE =========
let draw;                        // Mapbox Draw
let siteBoundary = null;         // Feature<Polygon>
let roads = [];                  // Feature<Polygon>[]
const $ = (id) => document.getElementById(id);
const setStats = (html) => { const el = $('stats'); if (el) el.innerHTML = html; };

// ========= MAP LOAD =========
map.on('load', () => {
  // Site boundary (fill first, line second so stroke sits above)
  map.addSource('site-view', { type: 'geojson', data: emptyFC() });
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

  // Roads
  map.addSource('roads-view', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'roads-view',
    type: 'fill',
    source: 'roads-view',
    paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.6 }
  });

  // Homes (3D extrusions)
  map.addSource('homes', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'homes',
    type: 'fill-extrusion',
    source: 'homes',
    paint: {
      'fill-extrusion-color': '#6699ff',
      'fill-extrusion-height': ['coalesce', ['get','height'], 4],
      'fill-extrusion-opacity': 0.75
    }
  });

  // Draw control
  draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: { polygon: true, trash: true }
  });
  map.addControl(draw);

  // Make draw styles match your theme (after layers exist)
  const tuneDrawStyles = () => {
    const edits = [
      ['gl-draw-polygon-stroke-active',   'line-color', '#16a34a'],
      ['gl-draw-polygon-stroke-active',   'line-width', 2],
      ['gl-draw-polygon-stroke-inactive', 'line-color', '#16a34a'],
      ['gl-draw-polygon-stroke-inactive', 'line-width', 3],
      ['gl-draw-polygon-fill-inactive',   'fill-color', '#16a34a'],
      ['gl-draw-polygon-fill-inactive',   'fill-opacity', 0.05]
    ];
    edits.forEach(([id, prop, val]) => {
      if (map.getLayer(id)) {
        try { map.setPaintProperty(id, prop, val); } catch (_) {}
      }
    });
  };
  tuneDrawStyles();
  map.on('styledata', tuneDrawStyles);
  map.on('draw.modechange', () => { map.getCanvas().style.cursor = ''; tuneDrawStyles(); });

  // Toolbar
  wireToolbar();

  // When a polygon is created, decide if it's the site or a road
  map.on('draw.create', (e) => {
    const feat = e.features[0];
    if (!feat || feat.geometry.type !== 'Polygon') return;

    if (!siteBoundary) {
      siteBoundary = feat;
      refreshSite();

      // Pre-fill rotation input with longest-edge auto angle (handy to tweak)
      const autoAngle = getLongestEdgeAngle(siteBoundary);
      const angleInput = $('rotationAngle');
      if (angleInput) angleInput.value = autoAngle.toFixed(1);

      setStats('<p>Site boundary saved. Click <b>Draw Roads</b> to add road polygons, then <b>Fill with Homes</b>.</p>');
    } else {
      roads.push(feat);
      refreshRoads();
      setStats(`<p>Road added. Total roads: ${roads.length}. Click <b>Fill with Homes</b> when ready.</p>`);
    }

    draw.deleteAll();
    map.getCanvas().style.cursor = '';
  });

  // Re-generate on manual rotation change (if any)
  const angleInput = $('rotationAngle');
  if (angleInput) {
    ['change','input'].forEach(evt =>
      angleInput.addEventListener(evt, () => siteBoundary && generateHomes())
    );
  }
});

// ========= Toolbar =========
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

  $('fillHomes').onclick = generateHomes;

  $('clearAll').onclick = () => {
    draw.deleteAll();
    siteBoundary = null;
    roads = [];
    refreshSite();
    refreshRoads();
    clearHomes();
  };
}

// ========= Rendering helpers =========
function refreshSite()   { map.getSource('site-view').setData(siteBoundary ? fc([siteBoundary]) : emptyFC()); }
function refreshRoads()  { map.getSource('roads-view').setData(roads.length ? fc(roads) : emptyFC()); }
function clearHomes()    { map.getSource('homes').setData(emptyFC()); }
function fc(features)    { return { type: 'FeatureCollection', features }; }
function emptyFC()       { return { type: 'FeatureCollection', features: [] }; }

// ========= Geometry helpers =========
function unionAll(features) {
  if (!features?.length) return null;
  let u = features[0];
  for (let i = 1; i < features.length; i++) {
    try { u = turf.union(u, features[i]); }
    catch (err) { console.warn('union failed on feature', i, err); }
  }
  return u;
}
function getLongestEdgeAngle(polygon){
  const coords = polygon.geometry.coordinates[0];
  let longestAngle = 0, longestDist = 0;
  for (let i=0;i<coords.length-1;i++){
    const p1 = turf.point(coords[i]);
    const p2 = turf.point(coords[i+1]);
    const d  = turf.distance(p1,p2,{units:'meters'});
    if (d > longestDist){
      longestDist = d;
      longestAngle = turf.bearing(p1,p2);
    }
  }
  return longestAngle;
}

// ========= HOME GENERATION (short edge along nearest road) =========
function generateHomes() {
  if (!siteBoundary) { alert('Draw the site boundary first.'); return; }

  // Read manual rotation (for fallback)
  const manualAngle = parseFloat($('rotationAngle')?.value);
  const fallbackAngle = Number.isFinite(manualAngle) ? manualAngle : getLongestEdgeAngle(siteBoundary);

  fillHomesOrientedToRoads({
    map,
    siteBoundary,
    roads,
    getRotationDeg: () => fallbackAngle,
    setStats
  });
}

/**
 * Places a grid of homes across the buildable area, then rotates EACH home so its
 * short edge (frontage) runs parallel to the nearest road segment. If there are
 * no roads, all homes use the fallback (manual/auto) rotation.
 */
function fillHomesOrientedToRoads({ map, siteBoundary, roads, getRotationDeg, setStats }) {
  // ---------- Parameters you can tweak ----------
  const homeWidthM   = 6.5; // short side (frontage) — runs along the road
  const homeDepthM   = 10;  // long side (back-to-front)
  const homeHeightM  = 4;   // extrusion height
  const sideGapM     = 2;   // left/right gap between houses
  const frontGapM    = 5;   // front/back gap between rows
  const edgeMarginM  = 0.5; // safety margin from edges
  // ----------------------------------------------

  // Buildable = site − roads
  let buildable = siteBoundary;
  if (roads?.length) {
    try {
      const u = unionAll(roads);
      const diff = turf.difference(siteBoundary, u);
      if (diff) buildable = diff;
    } catch (e) {
      console.warn('difference failed; using whole site as buildable', e);
    }
  }

  // Inset so full rectangles fit
  const halfMax = Math.max(homeWidthM, homeDepthM) / 2;
  let placementArea;
  try {
    placementArea = turf.buffer(buildable, -(halfMax + edgeMarginM), { units: 'meters' });
    if (!placementArea ||
       (placementArea.geometry.type !== 'Polygon' && placementArea.geometry.type !== 'MultiPolygon')) {
      placementArea = buildable;
    }
  } catch (e) {
    placementArea = buildable;
  }

  // Stats
  const areaM2 = turf.area(buildable);
  const ha     = areaM2 / 10000;

  // meters → degrees at site latitude
  const lat   = turf.center(buildable).geometry.coordinates[1];
  const dLat  = 1 / 110540;
  const dLon  = 1 / (111320 * Math.cos(lat * Math.PI / 180));

  const widthLon = homeWidthM * dLon;
  const depthLat = homeDepthM * dLat;
  const stepLon  = (homeWidthM + sideGapM) * dLon;   // spacing across short edges
  const stepLat  = (homeDepthM + frontGapM) * dLat;  // spacing along long edges

  // Global fallback rotation
  const fallbackAngle = (getRotationDeg?.() ?? getLongestEdgeAngle(siteBoundary));

  // Road lines for local orientation
  const roadLines = buildRoadLines(roads);

  // Seed a grid in fallback frame, then rotate back
  const pivot        = turf.center(placementArea).geometry.coordinates;
  const rotatedArea  = turf.transformRotate(placementArea, -fallbackAngle, { pivot });
  const bbox         = turf.bbox(rotatedArea);

  const homes = [];
  for (let x = bbox[0]; x < bbox[2]; x += stepLon) {
    for (let y = bbox[1]; y < bbox[3]; y += stepLat) {
      const cx = x + stepLon / 2, cy = y + stepLat / 2;

      // Axis‑aligned rect in rotated frame (width on X, depth on Y)
      const halfLon = widthLon / 2, halfLat = depthLat / 2;
      const rect = turf.polygon([[
        [cx - halfLon, cy - halfLat],
        [cx + halfLon, cy - halfLat],
        [cx + halfLon, cy + halfLat],
        [cx - halfLon, cy + halfLat],
        [cx - halfLon, cy - halfLat]
      ]], { height: homeHeightM });

      if (!turf.booleanWithin(rect, rotatedArea)) continue;

      // Base rect back to map space with fallback angle
      let rectBack = turf.transformRotate(rect, fallbackAngle, { pivot });

      // If we have roads, orient the short edge to the nearest road segment
      if (roadLines.length) {
        const center = turf.center(rectBack);
        const localBearing = getNearestRoadBearing(roadLines, center);

        // We created the rect in the rotated frame; to align width with the road,
        // rotate the original rect by (localBearing) instead of fallbackAngle:
        const rectAligned = turf.transformRotate(rect, localBearing, { pivot });
        rectBack = rectAligned; // already in map space since bearing is absolute
      }

      homes.push(rectBack);
    }
  }

  map.getSource('homes').setData(fc(homes));

  setStats?.(`
    <p><strong>Buildable area:</strong> ${Math.round(areaM2).toLocaleString()} m² (${ha.toFixed(2)} ha)</p>
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Actual density:</strong> ${(homes.length / ha || 0).toFixed(1)} homes/ha</p>
  `);
}

// ---- small helpers used above ----
function buildRoadLines(roads){
  if (!roads?.length) return [];
  const lines = [];
  roads.forEach(r => {
    const ln = turf.polygonToLine(r);
    if (ln.geometry.type === 'LineString') {
      lines.push(ln);
    } else if (ln.geometry.type === 'MultiLineString') {
      ln.geometry.coordinates.forEach(c => lines.push(turf.lineString(c)));
    }
  });
  return lines;
}

function getNearestRoadBearing(roadLines, point){
  let best = { dist: Infinity, bearing: null };
  roadLines.forEach(line => {
    const snap = turf.nearestPointOnLine(line, point, { units: 'meters' });
    const idx  = snap.properties.index;
    const coords = line.geometry.coordinates;
    if (idx >= 0 && idx < coords.length - 1) {
      const b = turf.bearing(
        turf.point(coords[idx]),
        turf.point(coords[idx+1])
      );
      const d = snap.properties.dist || 0;
      if (d < best.dist) best = { dist: d, bearing: b };
    }
  });
  return Number.isFinite(best.bearing) ? best.bearing : 0;
}
