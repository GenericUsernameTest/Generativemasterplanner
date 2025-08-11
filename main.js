// main.js — site → roads → homes, homes oriented to roads

// ========= CONFIG =========
mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

// ========= SMALL UTILS =========
const $ = (id) => document.getElementById(id);
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
const fc = (features) => ({ type: 'FeatureCollection', features });

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
  if (!Array.isArray(features) || !features.length) return null;
  let u = features[0];
  for (let i = 1; i < features.length; i++) {
    try { u = turf.union(u, features[i]); }
    catch (e) { console.warn('union failed on feature', i, e); }
  }
  return u;
}

// Build road *corridors* as polygons by laying parallel bands in a rotated frame.
function buildRoads(sitePolygon, angleDeg, roadWidthM, blockDepthM) {
  const pivot = turf.center(sitePolygon).geometry.coordinates;
  const rotated = turf.transformRotate(sitePolygon, -angleDeg, { pivot });
  const bbox = turf.bbox(rotated);

  // meters→degrees at site latitude
  const lat = pivot[1] || turf.center(rotated).geometry.coordinates[1];
  const dLat = 1 / 110540;
  const dLon = 1 / (111320 * Math.max(0.0001, Math.cos(lat * Math.PI / 180)));

  const roadHalfLon = (roadWidthM * dLon) / 2;
  const spacingLat = blockDepthM * dLat;

  const roads = [];

  // Longitudinal streets (bands perpendicular to Y, i.e., vary along Y)
  for (let y = bbox[1]; y <= bbox[3]; y += spacingLat) {
    const band = turf.polygon([[
      [bbox[0]-10, y - (roadHalfLon*0) - (roadWidthM*dLat)/2],
      [bbox[2]+10, y - (roadHalfLon*0) - (roadWidthM*dLat)/2],
      [bbox[2]+10, y + (roadWidthM*dLat)/2],
      [bbox[0]-10, y + (roadWidthM*dLat)/2],
      [bbox[0]-10, y - (roadWidthM*dLat)/2]
    ]]);

    try {
      const seg = turf.intersect(rotated, band);
      if (seg) roads.push(seg);
    } catch {}
  }

  // One or two cross streets to break up blocks (optional)
  const crossEvery = 3; // every N longitudinal gaps, drop one cross street
  const totalSpanX = bbox[2] - bbox[0];
  const crossCount = Math.max(1, Math.floor(totalSpanX / ((roadWidthM+blockDepthM) * dLon * 6)));
  for (let i = 1; i <= crossCount; i++) {
    const x = bbox[0] + (i * totalSpanX) / (crossCount + 1);
    const band = turf.polygon([[
      [x - (roadWidthM*dLon)/2, bbox[1]-10],
      [x + (roadWidthM*dLon)/2, bbox[1]-10],
      [x + (roadWidthM*dLon)/2, bbox[3]+10],
      [x - (roadWidthM*dLon)/2, bbox[3]+10],
      [x - (roadWidthM*dLon)/2, bbox[1]-10]
    ]]);
    try {
      const seg = turf.intersect(rotated, band);
      if (seg) roads.push(seg);
    } catch {}
  }

  // Rotate roads back into map space
  return roads.map(r => turf.transformRotate(r, angleDeg, { pivot }));
}

function polygonToLines(features) {
  if (!features || !features.length) return [];
  const lines = [];
  for (const f of features) {
    const ln = turf.polygonToLine(f);
    if (!ln) continue;
    if (ln.geometry.type === 'LineString') lines.push(ln);
    else if (ln.geometry.type === 'MultiLineString') {
      for (const c of ln.geometry.coordinates) lines.push(turf.lineString(c));
    }
  }
  return lines;
}

function nearestSegmentBearing(lines, point) {
  let best = { d: Infinity, b: 0 };
  for (const line of lines) {
    const snap = turf.nearestPointOnLine(line, point, { units: 'meters' });
    const idx = snap.properties.index;
    const coords = line.geometry.coordinates;
    if (idx >= 0 && idx < coords.length - 1) {
      const b = turf.bearing(turf.point(coords[idx]), turf.point(coords[idx+1]));
      const d = snap.properties.dist || 0;
      if (d < best.d) best = { d, b };
    }
  }
  return best.b;
}

// ========= APP =========
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
  let roads = [];

  map.on('load', () => {
    // Sources/layers
    map.addSource('site-view', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'site-fill', type: 'fill', source: 'site-view',
      paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.12 }});
    map.addLayer({ id: 'site-view', type: 'line', source: 'site-view',
      paint: { 'line-color': '#16a34a', 'line-width': 4, 'line-opacity': 0.9 }});

    map.addSource('roads-view', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'roads-view', type: 'fill', source: 'roads-view',
      paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.55 }});

    map.addSource('homes', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'homes', type: 'fill-extrusion', source: 'homes',
      paint: {
        'fill-extrusion-color': '#6699ff',
        'fill-extrusion-height': ['coalesce', ['get','height'], 4],
        'fill-extrusion-opacity': 0.8
      }
    });

    // Draw control
    draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: true, trash: true }});
    map.addControl(draw);

    // Tidy Draw colours
    const tidy = () => {
      const edits = [
        ['gl-draw-polygon-stroke-active', 'line-color', '#16a34a'],
        ['gl-draw-polygon-stroke-active', 'line-width', 2],
        ['gl-draw-polygon-stroke-inactive', 'line-color', '#16a34a'],
        ['gl-draw-polygon-stroke-inactive', 'line-width', 3],
        ['gl-draw-polygon-fill-inactive', 'fill-color', '#16a34a'],
        ['gl-draw-polygon-fill-inactive', 'fill-opacity', 0.05],
      ];
      edits.forEach(([id, prop, val]) => { if (map.getLayer(id)) try{ map.setPaintProperty(id, prop, val);}catch{} });
    };
    tidy(); map.on('styledata', tidy); map.on('draw.modechange', tidy);

    // Capture site
    map.on('draw.create', (e) => {
      const feat = e.features?.[0];
      if (!feat || feat.geometry.type !== 'Polygon') return;
      siteBoundary = feat;
      roads = [];
      map.getSource('site-view').setData(fc([siteBoundary]));
      map.getSource('roads-view').setData(emptyFC());
      map.getSource('homes').setData(emptyFC());

      const autoA = getLongestEdgeAngle(siteBoundary);
      const angleEl = $('rotationAngle');
      if (angleEl) angleEl.value = autoA.toFixed(1);
      setStats('<p>Site boundary saved. Adjust parameters then <b>Generate Plan</b>.</p>');

      draw.deleteAll();
    });

    wireToolbar();
  });

  function wireToolbar() {
    const drawSiteBtn  = $('drawSite');
    const genBtn       = $('fillHomes'); // "Generate Plan"
    const clearBtn     = $('clearAll');

    if (drawSiteBtn) {
      drawSiteBtn.onclick = () => {
        if (!draw) return;
        draw.deleteAll();
        siteBoundary = null;
        roads = [];
        map.getSource('site-view').setData(emptyFC());
        map.getSource('roads-view').setData(emptyFC());
        map.getSource('homes').setData(emptyFC());
        draw.changeMode('draw_polygon');
        setStats('<p>Drawing site boundary… click to add points, double‑click to finish.</p>');
      };
    }

    if (genBtn) {
      genBtn.onclick = () => {
        try { generatePlan(); }
        catch (e) {
          console.error(e);
          setStats('<p style="color:#b91c1c">Couldn’t generate. See console.</p>');
          alert('Generate failed. Check console.');
        }
      };
    }

    if (clearBtn) {
      clearBtn.onclick = () => {
        if (draw) draw.deleteAll();
        siteBoundary = null;
        roads = [];
        map.getSource('site-view').setData(emptyFC());
        map.getSource('roads-view').setData(emptyFC());
        map.getSource('homes').setData(emptyFC());
        setStats('');
      };
    }

    // Live re-gen when rotation changes
    const angleEl = $('rotationAngle');
    if (angleEl) ['change','input','blur'].forEach(ev => angleEl.addEventListener(ev, () => { if (siteBoundary) generatePlan(); }));
  }

  function num(id, def) {
    const v = parseFloat($(id)?.value);
    return Number.isFinite(v) && v > 0 ? v : def;
  }

  function generatePlan() {
    if (!siteBoundary) { alert('Draw the site boundary first.'); return; }

    // Inputs
    const homeWidthM   = num('homeWidth', 9);      // short side (frontage)
    const homeDepthM   = num('homeDepth', 12);     // long side
    const frontSetback = num('frontSetback', 5);   // gap front/back (between rows)
    const sideGapM     = num('sideGap', 2);        // gap left/right
    const roadWidthM   = num('roadWidth', 9);
    const lotsPerBlock = Math.max(1, Math.floor(num('lotsPerBlock', 5)));
    const rawAngle     = parseFloat(String($('rotationAngle')?.value || '').trim());
    const angleDeg     = Number.isFinite(rawAngle) ? rawAngle : getLongestEdgeAngle(siteBoundary);

    // Roads: spacing is based on block depth = N lots + roads
    const blockDepthM = lotsPerBlock * (homeDepthM + frontSetback) + roadWidthM;
    roads = buildRoads(siteBoundary, angleDeg, roadWidthM, blockDepthM);

    map.getSource('roads-view').setData(fc(roads));

    // Buildable = site − union(roads)
    let buildable = siteBoundary;
    if (roads.length) {
      try {
        const u = unionAll(roads);
        const diff = turf.difference(siteBoundary, u);
        if (diff) buildable = diff;
      } catch (e) {
        console.warn('difference failed, using full site as buildable', e);
      }
    }

    // Inset buildable so houses fully fit
    const edgeMarginM = 0.6;
    const halfMax = Math.max(homeWidthM, homeDepthM) / 2;
    let placementArea;
    try {
      placementArea = turf.buffer(buildable, -(halfMax + edgeMarginM), { units: 'meters' });
      if (!placementArea ||
          (placementArea.geometry.type !== 'Polygon' && placementArea.geometry.type !== 'MultiPolygon')) {
        placementArea = buildable;
      }
    } catch { placementArea = buildable; }

    // meters→degrees
    const lat = turf.center(placementArea).geometry.coordinates[1];
    const dLat = 1 / 110540;
    const dLon = 1 / (111320 * Math.max(0.0001, Math.cos(lat * Math.PI / 180)));
    const widthLon = homeWidthM * dLon;
    const depthLat = homeDepthM * dLat;
    const stepLon  = (homeWidthM + sideGapM) * dLon;      // across frontage
    const stepLat  = (homeDepthM + frontSetback) * dLat;  // along depth

    // Seed grid in fallback frame then orient per nearest road
    const pivot = turf.center(placementArea).geometry.coordinates;
    const rotatedArea = turf.transformRotate(placementArea, -angleDeg, { pivot });
    const [minX, minY, maxX, maxY] = turf.bbox(rotatedArea);

    const roadLines = polygonToLines(roads);

    const homes = [];
    for (let x = minX; x <= maxX; x += stepLon) {
      for (let y = minY; y <= maxY; y += stepLat) {
        const cx = x + stepLon/2, cy = y + stepLat/2;

        // Axis‑aligned rect (frontage along X, depth along Y)
        const rect = turf.polygon([[
          [cx - widthLon/2, cy - depthLat/2],
          [cx + widthLon/2, cy - depthLat/2],
          [cx + widthLon/2, cy + depthLat/2],
          [cx - widthLon/2, cy + depthLat/2],
          [cx - widthLon/2, cy - depthLat/2],
        ]], { height: 4 });

        if (!turf.booleanWithin(rect, rotatedArea)) continue;

        // Rotate back to map space with fallback
        let rectBack = turf.transformRotate(rect, angleDeg, { pivot });

        // Snap orientation to nearest road so the *short edge/frontage* runs along it
        if (roadLines.length) {
          const c = turf.center(rectBack);
          const roadBearing = nearestSegmentBearing(roadLines, c);
          const delta = roadBearing - angleDeg; // how much to rotate from fallback
          // Recreate from rotated frame to avoid compounding tiny numeric errors:
          rectBack = turf.transformRotate(rect, delta, { pivot });
          rectBack = turf.transformRotate(rectBack, angleDeg, { pivot });
        }

        homes.push(rectBack);
      }
    }

    // Render + stats
    const areaM2 = turf.area(buildable);
    const ha = areaM2 / 10000;
    map.getSource('homes').setData(fc(homes));
    setStats(`
      <p><strong>Buildable area (site − roads):</strong> ${Math.round(areaM2).toLocaleString()} m² (${ha.toFixed(2)} ha)</p>
      <p><strong>Homes placed:</strong> ${homes.length}</p>
      <p><strong>Rotation used:</strong> ${angleDeg.toFixed(1)}°</p>
      <p><strong>Actual density:</strong> ${(homes.length / (ha || 1)).toFixed(1)} homes/ha</p>
    `);
  }

  function setStats(html){ const el = $('stats'); if (el) el.innerHTML = html; }
});
