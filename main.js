// ================= CONFIG =================
mapboxgl.accessToken =
  'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

// ================= UTILS ==================
const $ = (id) => document.getElementById(id);
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
const fc = (features) => ({ type: 'FeatureCollection', features });
function clamp(n, a, b) { return Math.min(Math.max(n, a), b); }
function setStats(html) { const el = $('stats'); if (el) el.innerHTML = html; }

function getLongestEdgeAngle(polygon) {
  const ring = polygon?.geometry?.coordinates?.[0] || [];
  let bestDist = 0, bestAngle = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = turf.point(ring[i]);
    const p2 = turf.point(ring[i + 1]);
    const dist = turf.distance(p1, p2, { units: 'meters' });
    if (dist > bestDist) { bestDist = dist; bestAngle = turf.bearing(p1, p2); }
  }
  return bestAngle;
}

function unionAll(features) {
  if (!Array.isArray(features) || !features.length) return null;
  let u = features[0];
  for (let i = 1; i < features.length; i++) {
    try { u = turf.union(u, features[i]); }
    catch (e) { console.warn('union failed', i, e); }
  }
  return u;
}

function metersToDeg(latDeg) {
  const latR = latDeg * Math.PI / 180;
  const dLat = 1 / 110540;
  const dLon = 1 / (111320 * Math.max(0.0001, Math.cos(latR)));
  return { dLat, dLon };
}

// ================= APP ====================
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
    $('fillHomes').onclick = () => generatePlan();
    $('clearAll').onclick = () => { clearOutputs(); siteBoundary = null; refreshSite(); draw.deleteAll(); };

    // Live update on change
    ['rotationAngle', 'houseType', 'frontSetback', 'sideGap'].forEach(id => {
      $(id).addEventListener('input', () => { if (siteBoundary) generatePlan(); });
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

  function generatePlan() {
    if (!siteBoundary) return alert('Draw the site boundary first.');

    const houseType = $('houseType').value;
    let homeW, homeD, color;
    if (houseType === 't1') { homeW = 5; homeD = 5; color = '#ff9999'; }
    if (houseType === 't2') { homeW = 5; homeD = 8; color = '#99ff99'; }
    if (houseType === 't3') { homeW = 10; homeD = 8; color = '#9999ff'; }

    const front = parseFloat($('frontSetback').value) || 5;
    const side  = parseFloat($('sideGap').value) || 2;
    const rWidth = 5; // fixed road width

    const rawAngle = parseFloat($('rotationAngle').value);
    const angleDeg = Number.isFinite(rawAngle) ? rawAngle : getLongestEdgeAngle(siteBoundary);

    const site = siteBoundary;
    const lat  = turf.center(site).geometry.coordinates[1];
    const { dLat, dLon } = metersToDeg(lat);
    const pivot = turf.center(site).geometry.coordinates;
    const siteRot = turf.transformRotate(site, -angleDeg, { pivot });

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
      const inter = turf.intersect(buf, siteRot); if (inter) roadPolys.push(inter);
    }
    for (let x = minX; x <= maxX; x += crossPitchLon) {
      const seg = turf.lineString([[x, minY - 1], [x, maxY + 1]]);
      const buf = turf.buffer(seg, rWidth / 2, { units: 'meters' });
      const inter = turf.intersect(buf, siteRot); if (inter) roadPolys.push(inter);
    }

    let roadsBack = emptyFC();
    if (roadPolys.length) {
      const u = unionAll(roadPolys);
      const roadsRot = fc([u]);
      roadsBack = fc(roadsRot.features.map(f => turf.transformRotate(f, angleDeg, { pivot })));
    }
    map.getSource('roads-view')?.setData(roadsBack);

    let buildable = site;
    if (roadsBack.features.length) {
      const roadsBig = fc(roadsBack.features.map(f => turf.buffer(f, 0.25, { units: 'meters' })));
      const uRoads = unionAll(roadsBig.features);
      const diff = turf.difference(site, uRoads);
      if (diff) buildable = diff;
    }

    const edgeMarginM = 0.6;
    const halfMax = Math.max(homeW, homeD) / 2;
    let placementArea = buildable;
    try {
      const buf = turf.buffer(buildable, -(halfMax + edgeMarginM), { units: 'meters' });
      if (buf && (buf.geometry.type === 'Polygon' || buf.geometry.type === 'MultiPolygon')) {
        placementArea = buf;
      }
    } catch {}

    const { dLat: dLatP, dLon: dLonP } = metersToDeg(turf.center(placementArea).geometry.coordinates[1]);
    const widthLon = homeW * dLonP;
    const depthLat = homeD * dLatP;
    const stepLon  = (homeW + side)  * dLonP;
    const stepLat  = (homeD + front) * dLatP;

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
        ]], { height: 4, color });
        if (!turf.booleanWithin(rect, placeRot)) continue;
        homes.push(turf.transformRotate(rect, angleDeg, { pivot }));
      }
    }

    const ha = turf.area(buildable) / 10000;
    map.getSource('homes')?.setData(fc(homes));
    setStats(`
      <p><strong>Homes placed:</strong> ${homes.length}</p>
      <p><strong>Rotation:</strong> ${angleDeg.toFixed(1)}°</p>
      <p><strong>Density:</strong> ${(homes.length / (ha || 1)).toFixed(1)} homes/ha</p>
    `);
  }
});
