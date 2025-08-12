// ================= CONFIG =================
mapboxgl.accessToken =
  'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

// ================= UTILS ==================
const $ = (id) => document.getElementById(id);
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
const fc = (features) => ({ type: 'FeatureCollection', features });
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);

function setStats(html) { const el = $('stats'); if (el) el.innerHTML = html; }

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
    // Sources & layers
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
        // use per-feature colour if present
        'fill-extrusion-color': ['coalesce', ['get', 'colour'], '#6699ff'],
        'fill-extrusion-height': ['coalesce', ['get', 'height'], 4],
        'fill-extrusion-opacity': 0.78
      }
    });

    // Draw control (site only)
    draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: true, trash: true } });
    map.addControl(draw);

    // Light tweak to draw styles
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

    // Capture site polygon
    map.on('draw.create', (e) => {
      const feat = e.features?.[0];
      if (!feat || feat.geometry.type !== 'Polygon') return;

      siteBoundary = feat;
      refreshSite();

      // Prefill rotation with auto if input exists
      const angleEl = $('rotationAngle');
      if (angleEl && (angleEl.value ?? '') === '') {
        angleEl.value = getLongestEdgeAngle(siteBoundary).toFixed(1);
      }

      setStats('<p>Site boundary saved. Set parameters then click <b>Generate Plan</b>.</p>');
      draw.deleteAll();
      map.getCanvas().style.cursor = '';
    });

    wireToolbar();
    wireLiveEdits(); // re-generate on input changes
  });

  // -------- Toolbar wiring --------
  function wireToolbar() {
    const drawSiteBtn  = $('drawSite');
    const genBtn       = $('fillHomes');   // “Generate Plan”
    const clearBtn     = $('clearAll');

    if (drawSiteBtn) {
      drawSiteBtn.onclick = () => {
        if (!draw) return;
        clearOutputs();
        draw.deleteAll();
        siteBoundary = null;
        refreshSite();
        draw.changeMode('draw_polygon');
        map.getCanvas().style.cursor = 'crosshair';
        setStats('<p>Drawing site boundary… click to add points, double‑click to finish.</p>');
      };
    }

    if (genBtn) {
      genBtn.onclick = () => {
        try { generatePlan(); }
        catch (err) { console.error(err); alert('Generate Plan failed. Check console for details.'); }
      };
    }

    if (clearBtn) {
      clearBtn.onclick = () => {
        clearOutputs();
        siteBoundary = null;
        refreshSite();
        if (draw) draw.deleteAll();
      };
    }
  }

  function wireLiveEdits() {
    const ids = ['rotationAngle','houseType','frontSetback','sideGap'];
    let t;
    const debounced = () => {
      clearTimeout(t);
      t = setTimeout(() => { if (siteBoundary) try { generatePlan(); } catch(e){} }, 120);
    };
    ids.forEach(id => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', debounced);
      el.addEventListener('change', debounced);
      el.addEventListener('keyup', (e) => { if (e.key === 'Enter') debounced(); });
    });
  }

  function clearOutputs(){
    map.getSource('roads-view')?.setData(emptyFC());
    map.getSource('homes')?.setData(emptyFC());
    setStats('');
  }

  // -------- Rendering helpers --------
  function refreshSite() {
    map.getSource('site-view')?.setData(siteBoundary ? fc([siteBoundary]) : emptyFC());
  }

  // ============ CORE: Roads + Homes ============
  function generatePlan() {
    if (!siteBoundary) { alert('Draw the site boundary first.'); return; }

    // House type selector -> dimensions + colour
    const types = {
      t1: { w: 5,  d: 5,  colour: '#4CAF50' }, // green
      t2: { w: 5,  d: 8,  colour: '#FF9800' }, // orange
      t3: { w:10,  d: 8,  colour: '#2196F3' }  // blue
    };
    const chosen = types[$('houseType')?.value] || types.t1;

    // Inputs
    const num = (id, def) => {
      const v = parseFloat($(id)?.value);
      return Number.isFinite(v) && v > 0 ? v : def;
    };
    const homeW  = chosen.w;                 // short side / frontage
    const homeD  = chosen.d;                 // long side
    const front  = num('frontSetback', 5);   // row spacing
    const side   = num('sideGap', 2);        // sideways house gap
    const rWidth = 5;                         // fixed road width (m)
    const lotsPB = 5;                         // fixed lots per block

    // Rotation
    const rawAngle = parseFloat(String($('rotationAngle')?.value || '').trim());
    const angleDeg = Number.isFinite(rawAngle) ? rawAngle : getLongestEdgeAngle(siteBoundary);

    // Base geometries
    const site = siteBoundary;
    const lat  = turf.center(site).geometry.coordinates[1];
    const { dLat, dLon } = metersToDeg(lat);

    // 1) Build rotated frame
    const pivot = turf.center(site).geometry.coordinates;
    const siteRot = turf.transformRotate(site, -angleDeg, { pivot });

    // 2) Simple orthogonal road grid in rotated frame
    const blockPitchM = homeD + front;                 // depth of one row+front yard
    const roadPitchM  = rWidth + blockPitchM * 2;      // road every 2 rows
    const lotPitchM   = homeW + side;                  // along road: frontage + side gap
    const crossPitchM = lotsPB * lotPitchM + rWidth;   // distance between cross roads

    const lotPitchLon   = lotPitchM   * dLon;
    const crossPitchLon = crossPitchM * dLon;
    const roadPitchLat  = roadPitchM  * dLat;

    const [minX, minY, maxX, maxY] = turf.bbox(siteRot);
    const roadPolys = [];

    // Horizontal roads (y constant)
    for (let y = minY; y <= maxY; y += roadPitchLat) {
      const seg = turf.lineString([[minX - 1, y], [maxX + 1, y]]);
      const buf = turf.buffer(seg, rWidth / 2, { units: 'meters' });
      const inter = turf.intersect(buf, siteRot);
      if (inter) roadPolys.push(inter);
    }

    // Vertical roads (x constant)
    for (let x = minX; x <= maxX; x += crossPitchLon) {
      const seg = turf.lineString([[x, minY - 1], [x, maxY + 1]]);
      const buf = turf.buffer(seg, rWidth / 2, { units: 'meters' });
      const inter = turf.intersect(buf, siteRot);
      if (inter) roadPolys.push(inter);
    }

    // 3) Union roads and rotate back
    let roadsRot = emptyFC();
    if (roadPolys.length) {
      const u = unionAll(roadPolys);
      roadsRot = fc([u]);
    }

    const roadsBack = {
      type: 'FeatureCollection',
      features: (roadsRot.features || []).map(f => turf.transformRotate(f, angleDeg, { pivot }))
    };
    map.getSource('roads-view')?.setData(roadsBack);

    // 4) Buildable = site − roads (with tiny safety buffer)
    let buildable = site;
    if (roadsBack.features?.length) {
      const roadsBig = fc(roadsBack.features.map(f => turf.buffer(f, 0.25, { units: 'meters' })));
      const uRoads   = unionAll(roadsBig.features);
      try {
        const diff = turf.difference(site, uRoads);
        if (diff) buildable = diff;
      } catch (e) {
        console.warn('difference(site, roads) failed; using site as buildable', e);
      }
    }

    // 5) Inset buildable by half home size so full rectangles fit
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
    } catch (e) {
      placementArea = buildable;
    }

    // 6) Place homes on a straight grid aligned with roads
    const areaLat = turf.center(placementArea).geometry.coordinates[1];
    const { dLat: dLatP, dLon: dLonP } = metersToDeg(areaLat);

    const widthLon = Math.max(1e-9, homeW * dLonP);               // short side along X in rotated frame
    const depthLat = Math.max(1e-9, homeD * dLatP);
    const stepLon  = Math.max(1e-9, (homeW + side)  * dLonP);     // across short edges
    const stepLat  = Math.max(1e-9, (homeD + front) * dLatP);     // along long edges

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
        ]], { height: 4, colour: chosen.colour });

        if (!turf.booleanWithin(rect, placeRot)) continue;

        const rectBack = turf.transformRotate(rect, angleDeg, { pivot });
        homes.push(rectBack);
      }
    }

    // 7) Render + stats
    const buildableArea = turf.area(buildable);
    const ha = buildableArea / 10000;
    map.getSource('homes')?.setData(fc(homes));
    setStats(`
      <p><strong>Buildable area (site − roads):</strong> ${Math.round(buildableArea).toLocaleString()} m² (${ha.toFixed(2)} ha)</p>
      <p><strong>Homes placed:</strong> ${homes.length}</p>
      <p><strong>House type:</strong> ${$('houseType')?.value?.toUpperCase()}</p>
      <p><strong>Rotation used:</strong> ${angleDeg.toFixed(1)}°</p>
      <p><strong>Actual density:</strong> ${(homes.length / (ha || 1)).toFixed(1)} homes/ha</p>
    `);
  }
});
