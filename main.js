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

  let draw;
  let siteBoundary = null;

  map.on('load', () => {
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

    map.addSource('roads-view', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'roads-view',
      type: 'fill',
      source: 'roads-view',
      paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.55 }
    });

    map.addSource('homes', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'homes',
      type: 'fill-extrusion',
      source: 'homes',
      paint: {
        'fill-extrusion-color': '#6699ff',
        'fill-extrusion-height': ['coalesce', ['get', 'height'], 4],
        'fill-extrusion-opacity': 0.78
      }
    });

    draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: true, trash: true } });
    map.addControl(draw);

    const tuneDrawStyles = () => {
      const edits = [
        ['gl-draw-polygon-stroke-active', 'line-color', '#16a34a'],
        ['gl-draw-polygon-stroke-active', 'line-width', 2],
        ['gl-draw-polygon-stroke-inactive', 'line-color', '#16a34a'],
        ['gl-draw-polygon-stroke-inactive', 'line-width', 3],
        ['gl-draw-polygon-fill-inactive', 'fill-color', '#16a34a'],
        ['gl-draw-polygon-fill-inactive', 'fill-opacity', 0.05]
      ];
      edits.forEach(([id, prop, val]) => {
        if (map.getLayer(id)) { try { map.setPaintProperty(id, prop, val); } catch {} }
      });
    };
    tuneDrawStyles();
    map.on('styledata', tuneDrawStyles);
    map.on('draw.modechange', () => { map.getCanvas().style.cursor = ''; tuneDrawStyles(); });

    map.on('draw.create', (e) => {
      const feat = e.features?.[0];
      if (!feat || feat.geometry.type !== 'Polygon') return;

      siteBoundary = feat;
      refreshSite();

      const autoA = getLongestEdgeAngle(siteBoundary);
      const angleEl = $('rotationAngle');
      if (angleEl && (angleEl.value ?? '') === '') angleEl.value = autoA.toFixed(1);

      setStats('<p>Site boundary saved. Set parameters or adjust inputs for live updates.</p>');
      draw.deleteAll();
      map.getCanvas().style.cursor = '';
      generatePlan(); // run immediately on site draw
    });

    wireToolbar();
  });

  function wireToolbar() {
    const drawSiteBtn = $('drawSite');
    const genBtn = $('fillHomes');
    const clearBtn = $('clearAll');

    if (drawSiteBtn) {
      drawSiteBtn.onclick = () => {
        if (!draw) return;
        clearOutputs();
        draw.deleteAll();
        siteBoundary = null;
        refreshSite();
        draw.changeMode('draw_polygon');
        map.getCanvas().style.cursor = 'crosshair';
        setStats('<p>Drawing site boundary… click to add points, double-click to finish.</p>');
      };
    }

    if (genBtn) genBtn.onclick = generatePlan;
    if (clearBtn) {
      clearBtn.onclick = () => {
        clearOutputs();
        siteBoundary = null;
        refreshSite();
        if (draw) draw.deleteAll();
      };
    }

    // Live updates for all number inputs
    document.querySelectorAll('#toolbar input[type="number"]').forEach(inp => {
      ['input', 'change'].forEach(evt => {
        inp.addEventListener(evt, () => { if (siteBoundary) generatePlan(); });
      });
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
    if (!siteBoundary) return;

    const num = (id, def) => {
      const v = parseFloat($(id)?.value);
      return Number.isFinite(v) && v > 0 ? v : def;
    };
    const homeW = num('homeWidth', 9);
    const homeD = num('homeDepth', 12);
    const front = num('frontSetback', 5);
    const side = num('sideGap', 2);
    const rWidth = clamp(num('roadWidth', 5), 4, 60);
    const lotsPB = clamp(num('lotsPerBlock', 5), 1, 20);

    const rawAngle = parseFloat(String($('rotationAngle')?.value || '').trim());
    const angleDeg = Number.isFinite(rawAngle) ? rawAngle : getLongestEdgeAngle(siteBoundary);

    const site = siteBoundary;
    const lat = turf.center(site).geometry.coordinates[1];
    const { dLat, dLon } = metersToDeg(lat);

    const pivot = turf.center(site).geometry.coordinates;
    const siteRot = turf.transformRotate(site, -angleDeg, { pivot });

    const blockPitchM = homeD + front;
    const roadPitchM = rWidth + blockPitchM * 2;
    const lotPitchM = homeW + side;
    const crossPitchM = lotsPB * lotPitchM + rWidth;

    const lotPitchLon = lotPitchM * dLon;
    const crossPitchLon = crossPitchM * dLon;
    const roadPitchLat = roadPitchM * dLat;

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

    let roadsRot = emptyFC();
    if (roadPolys.length) roadsRot = fc([unionAll(roadPolys)]);
    const roadsBack = {
      type: 'FeatureCollection',
      features: (roadsRot.features || []).map(f => turf.transformRotate(f, angleDeg, { pivot }))
    };
    map.getSource('roads-view')?.setData(roadsBack);

    let buildable = site;
    if (roadsBack.features?.length) {
      const roadsBig = fc(roadsBack.features.map(f => turf.buffer(f, 0.25, { units: 'meters' })));
      const uRoads = unionAll(roadsBig.features);
      try {
        const diff = turf.difference(site, uRoads);
        if (diff) buildable = diff;
      } catch (e) {
        console.warn('difference(site, roads) failed', e);
      }
    }

    const edgeMarginM = 0.6;
    const halfMax = Math.max(homeW, homeD) / 2;
    let placementArea;
    try {
      const buf = turf.buffer(buildable, -(halfMax + edgeMarginM), { units: 'meters' });
      placementArea = (buf && (buf.geometry.type === 'Polygon' || buf.geometry.type === 'MultiPolygon')) ? buf : buildable;
    } catch {
      placementArea = buildable;
    }

    const { dLat: dLatP, dLon: dLonP } = metersToDeg(turf.center(placementArea).geometry.coordinates[1]);
    const widthLon = homeW * dLonP;
    const depthLat = homeD * dLatP;
    const stepLon = (homeW + side) * dLonP;
    const stepLat = (homeD + front) * dLatP;

    const placeRot = turf.transformRotate(placementArea, -angleDeg, { pivot });
    const [px0, py0, px1, py1] = turf.bbox(placeRot);

    const homes = [];
    for (let x = px0; x <= px1; x += stepLon) {
      for (let y = py0; y <= py1; y += stepLat) {
        const cx = x + stepLon / 2;
        const cy = y + stepLat / 2;
        const rect = turf.polygon([[
          [cx - widthLon / 2, cy - depthLat / 2],
          [cx + widthLon / 2, cy - depthLat / 2],
          [cx + widthLon / 2, cy + depthLat / 2],
          [cx - widthLon / 2, cy + depthLat / 2],
          [cx - widthLon / 2, cy - depthLat / 2]
        ]], { height: 4 });

        if (!turf.booleanWithin(rect, placeRot)) continue;
        homes.push(turf.transformRotate(rect, angleDeg, { pivot }));
      }
    }

    const buildableArea = turf.area(buildable);
    const ha = buildableArea / 10000;
    map.getSource('homes')?.setData(fc(homes));
    setStats(`
      <p><strong>Buildable area:</strong> ${Math.round(buildableArea).toLocaleString()} m² (${ha.toFixed(2)} ha)</p>
      <p><strong>Homes placed:</strong> ${homes.length}</p>
      <p><strong>Rotation:</strong> ${angleDeg.toFixed(1)}°</p>
      <p><strong>Density:</strong> ${(homes.length / (ha || 1)).toFixed(1)} homes/ha</p>
    `);
  }
});
