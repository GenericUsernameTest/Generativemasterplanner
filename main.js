// ================= CONFIG =================
mapboxgl.accessToken =
  'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

// ================= UTILS ==================
const $ = (id) => document.getElementById(id);
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
const fc = (features) => ({ type: 'FeatureCollection', features });

function setStats(html) { const el = $('stats'); if (el) el.innerHTML = html; }
function clamp(n, a, b){ return Math.min(Math.max(n, a), b); }

// Bearing of the longest site edge (deg)
function getLongestEdgeAngle(polygon) {
  const ring = polygon?.geometry?.coordinates?.[0] || [];
  let bestDist = 0, bestAngle = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = turf.point(ring[i]);
    const p2 = turf.point(ring[i + 1]);
    const dist = turf.distance(p1, p2, { units: 'meters' });
    if (dist > bestDist) {
      bestDist = dist;
      bestAngle = turf.bearing(p1, p2);
    }
  }
  return bestAngle;
}

function unionAll(features) {
  if (!Array.isArray(features) || features.length === 0) return null;
  let u = features[0];
  for (let i = 1; i < features.length; i++) {
    try { u = turf.union(u, features[i]); }
    catch (e) { console.warn('union failed on feature', i, e); }
  }
  return u;
}

// meters→degrees helpers at a latitude
function metersToDeg(latDeg){
  const latR = latDeg * Math.PI / 180;
  const dLat = 1 / 110540;
  const dLon = 1 / (111320 * Math.max(0.0001, Math.cos(latR)));
  return { dLat, dLon };
}

// Standard house types
const HOUSE_TYPES = {
  t1: { w: 5,  d: 5,  color: '#ff6666' }, // red
  t2: { w: 5,  d: 8,  color: '#66cc66' }, // green
  t3: { w: 10, d: 8,  color: '#6699ff' }  // blue
};

// ================= APP ====================
document.addEventListener('DOMContentLoaded', () => {
  // Remember last view
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

  // State
  let draw;
  let siteBoundary = null;

  map.on('load', () => {
    // Site boundary
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
      paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.55 }
    });

    // Homes
    map.addSource('homes', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'homes',
      type: 'fill-extrusion',
      source: 'homes',
      paint: {
        'fill-extrusion-color': [
          'match', ['get', 'type'],
          't1', HOUSE_TYPES.t1.color,
          't2', HOUSE_TYPES.t2.color,
          't3', HOUSE_TYPES.t3.color,
          '#cccccc'
        ],
        'fill-extrusion-height': ['coalesce', ['get', 'height'], 4],
        'fill-extrusion-opacity': 0.78
      }
    });

    // Draw control (site only)
    draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: true, trash: true } });
    map.addControl(draw);

    // Capture site polygon
    map.on('draw.create', (e) => {
      const feat = e.features?.[0];
      if (!feat || feat.geometry.type !== 'Polygon') return;

      siteBoundary = feat;
      refreshSite();

      const autoA = getLongestEdgeAngle(siteBoundary);
      const angleEl = $('rotationAngle');
      if (angleEl && (angleEl.value ?? '') === '') angleEl.value = autoA.toFixed(1);

      setStats('<p>Site boundary saved. Pick a house type and click <b>Generate Plan</b>.</p>');
      draw.deleteAll();
      map.getCanvas().style.cursor = '';
    });

    wireToolbar();
  });

  // -------- Toolbar wiring --------
  function wireToolbar() {
    $('drawSite').onclick = () => {
      clearOutputs();
      draw.deleteAll();
      siteBoundary = null;
      refreshSite();
      draw.changeMode('draw_polygon');
      map.getCanvas().style.cursor = 'crosshair';
      setStats('<p>Drawing site boundary… click to add points, double-click to finish.</p>');
    };

    $('fillHomes').onclick = () => {
      try { generatePlan(); }
      catch (err) { console.error(err); alert('Generate Plan failed.'); }
    };

    $('clearAll').onclick = () => {
      clearOutputs();
      siteBoundary = null;
      refreshSite();
      draw.deleteAll();
    };
  }

  function clearOutputs(){
    map.getSource('roads-view')?.setData(emptyFC());
    map.getSource('homes')?.setData(emptyFC());
    setStats('');
  }

  function refreshSite() {
    map.getSource('site-view')?.setData(siteBoundary ? fc([siteBoundary]) : emptyFC());
  }

  // -------- Plan generation (roads + homes) --------
  function generatePlan() {
    if (!siteBoundary) { alert('Draw the site boundary first.'); return; }

    const typeKey = $('houseType').value || 't1';
    const { w: homeW, d: homeD } = HOUSE_TYPES[typeKey];
    const front  = parseFloat($('frontSetback')?.value) || 5;
    const side   = parseFloat($('sideGap')?.value) || 2;
    const rWidth = 5; // fixed road width

    const rawAngle = parseFloat(String($('rotationAngle')?.value || '').trim());
    const angleDeg = Number.isFinite(rawAngle) ? rawAngle : getLongestEdgeAngle(siteBoundary);

    const pivot = turf.center(siteBoundary).geometry.coordinates;
    const siteRot = turf.transformRotate(siteBoundary, -angleDeg, { pivot });

    const lat  = turf.center(siteBoundary).geometry.coordinates[1];
    const { dLat, dLon } = metersToDeg(lat);

    // Road grid spacing
    const blockPitchM = homeD + front;
    const roadPitchM  = rWidth + blockPitchM * 2;
    const lotPitchM   = homeW + side;
    const crossPitchM = 5 * lotPitchM + rWidth;

    const lotPitchLon   = lotPitchM   * dLon;
    const crossPitchLon = crossPitchM * dLon;
    const roadPitchLat  = roadPitchM  * dLat;

    const [minX, minY, maxX, maxY] = turf.bbox(siteRot);
    const roadPolys = [];

    for (let y = minY; y <= maxY; y += roadPitchLat) {
      const seg = turf.lineString([[minX - 1, y], [maxX + 1, y]]);
      const buf = turf.buffer(seg, rWidth / 2, { units: 'meters' });
      const inter = turf.intersect(buf, siteRot);
      if (inter) roadPolys.push(inter);
    }

    for (let x = minX; x <= maxX; x += crossPitchLon) {
      const seg = turf.lineString([[x, minY - 1], [x, maxY + 1]]);
      const buf = turf.buffer(seg, rWidth / 2, { units: 'meters' });
      const inter = turf.intersect(buf, siteRot);
      if (inter) roadPolys.push(inter);
    }

    let roadsBack = emptyFC();
    if (roadPolys.length) {
      const u = unionAll(roadPolys);
      const r = fc([u]);
      roadsBack = {
        type: 'FeatureCollection',
        features: r.features.map(f => turf.transformRotate(f, angleDeg, { pivot }))
      };
    }
    map.getSource('roads-view')?.setData(roadsBack);

    // Buildable area = site minus roads
    let buildable = siteBoundary;
    if (roadsBack.features.length) {
      const roadsBig = fc(roadsBack.features.map(f => turf.buffer(f, 0.25, { units: 'meters' })));
      const uRoads   = unionAll(roadsBig.features);
      try {
        const diff = turf.difference(siteBoundary, uRoads);
        if (diff) buildable = diff;
      } catch {}
    }

    // Inset buildable for home placement
    const edgeMarginM = 0.6;
    const halfMax = Math.max(homeW, homeD) / 2;
    let placementArea;
    try {
      const buf = turf.buffer(buildable, -(halfMax + edgeMarginM), { units: 'meters' });
      if (buf && (buf.geometry.type === 'Polygon' || buf.geometry.type === 'MultiPolygon')) {
        placementArea = buf;
      } else {
        placementArea = buildable;
      }
    } catch {
      placementArea = buildable;
    }

    // Place homes
    const { dLat: dLatP, dLon: dLonP } = metersToDeg(turf.center(placementArea).geometry.coordinates[1]);
    const widthLon = Math.max(1e-9, homeW * dLonP);
    const depthLat = Math.max(1e-9, homeD * dLatP);
    const stepLon  = Math.max(1e-9, (homeW + side)  * dLonP);
    const stepLat  = Math.max(1e-9, (homeD + front) * dLatP);

    const placeRot = turf.transformRotate(placementArea, -angleDeg, { pivot });
    const [px0, py0, px1, py1] = turf.bbox(placeRot);

    const homes = [];
    for (let x = px0; x <= px1; x += stepLon) {
      for (let y = py0; y <= py1; y += stepLat) {
        const cx = x + stepLon / 2;
        const cy = y + stepLat / 2;

        const halfLon = widthLon / 2;
        const halfLat = depthLat / 2;
        const rect = turf.polygon([[
          [cx - halfLon, cy - halfLat],
          [cx + halfLon, cy - halfLat],
          [cx + halfLon, cy + halfLat],
          [cx - halfLon, cy + halfLat],
          [cx - halfLon, cy - halfLat]
        ]]);

        if (!turf.booleanWithin(rect, placeRot)) continue;

        const rectBack = turf.transformRotate(rect, angleDeg, { pivot });
        rectBack.properties = { type: typeKey, w: homeW, d: homeD, height: 4 };
        homes.push(rectBack);
      }
    }

    const buildableArea = turf.area(buildable);
    const ha = buildableArea / 10000;
    map.getSource('homes')?.setData(fc(homes));
    setStats(`
      <p><strong>House type:</strong> ${typeKey.toUpperCase()} — ${homeW}m × ${homeD}m</p>
      <p><strong>Homes placed:</strong> ${homes.length}</p>
      <p><strong>Buildable area (site − roads):</strong> ${Math.round(buildableArea).toLocaleString()} m² (${ha.toFixed(2)} ha)</p>
      <p><strong>Rotation used:</strong> ${angleDeg.toFixed(1)}°</p>
      <p><strong>Actual density:</strong> ${(homes.length / (ha || 1)).toFixed(1)} homes/ha</p>
    `);
  }
});
