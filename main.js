// main.js (very top)
import { fillHomesOrientedToRoads } from './homes.js';


// ========= CONFIG =========
mapboxgl.accessToken =
  'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

// ========= SMALL UTILS =========
const $ = (id) => document.getElementById(id);
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
const fc = (features) => ({ type: 'FeatureCollection', features });

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
  if (!Array.isArray(features) || !features.length) return null;
  let u = features[0];
  for (let i = 1; i < features.length; i++) {
    try { u = turf.union(u, features[i]); }
    catch (e) { console.warn('union failed on feature', i, e); }
  }
  return u;
}

// ========= APP =========
document.addEventListener('DOMContentLoaded', () => {
  // Restore last view
  const savedView = JSON.parse(localStorage.getItem('mapView') || '{}');

  // Map init
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
  let roads = []; // reserved if you add a roads tool later

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
    draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: true, trash: true } });
    map.addControl(draw);

    // Match draw styles to your theme
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
      const autoA = getLongestEdgeAngle(siteBoundary);
      const angleEl = $('rotationAngle');
      if (angleEl) angleEl.value = autoA.toFixed(1);

      setStats('<p>Site boundary saved. Adjust parameters and press <b>Generate Plan</b>.</p>');
      draw.deleteAll();
      map.getCanvas().style.cursor = '';
    });

    // Wire toolbar
    wireToolbar();

    // Re-run on rotation change (if site exists)
    const angleEl = $('rotationAngle');
    if (angleEl) {
      const apply = () => { if (siteBoundary) generateHomesSafe(map, siteBoundary, roads); };
      ['input', 'change', 'blur'].forEach(evt => angleEl.addEventListener(evt, apply));
      angleEl.addEventListener('keyup', (e) => { if (e.key === 'Enter') apply(); });
    }
  });

  // ===== Toolbar wiring (safe) =====
  function wireToolbar() {
    const drawSiteBtn  = $('drawSite');
    const fillHomesBtn = $('fillHomes');
    const clearAllBtn  = $('clearAll');

    if (drawSiteBtn) {
      drawSiteBtn.onclick = () => {
        if (!draw) return;
        draw.deleteAll();
        siteBoundary = null;
        roads = [];
        refreshSite();
        clearHomes();
        draw.changeMode('draw_polygon');
        map.getCanvas().style.cursor = 'crosshair';
        setStats('<p>Drawing site boundary… click to add points, double‑click to finish.</p>');
      };
    }

    if (fillHomesBtn) {
      fillHomesBtn.onclick = () => {
        try {
          generateHomesSafe(map, siteBoundary, roads);
        } catch (err) {
          console.error('Generate Plan failed:', err);
          setStats('<p style="color:#b91c1c"><strong>Couldn’t generate.</strong> Open the console for details.</p>');
          alert('Generate Plan failed. See console for details.');
        }
      };
    }

    if (clearAllBtn) {
      clearAllBtn.onclick = () => {
        if (draw) draw.deleteAll();
        siteBoundary = null;
        roads = [];
        refreshSite();
        clearHomes();
        setStats('');
      };
    }
  }

  // ===== Rendering helpers =====
  function refreshSite() {
    map.getSource('site-view')?.setData(siteBoundary ? fc([siteBoundary]) : emptyFC());
  }
  function clearHomes() {
    map.getSource('homes')?.setData(emptyFC());
  }
  function setStats(html) {
    const el = $('stats');
    if (el) el.innerHTML = html;
  }

  // ===== Generate (robust) =====
  function generateHomesSafe(map, site, roads) {
    if (!site) { alert('Draw the site boundary first.'); return; }

    // 1) Inputs (guarded)
    const num = (id, def) => {
      const v = parseFloat($(id)?.value);
      return Number.isFinite(v) && v > 0 ? v : def;
    };
    const homeWidthM   = num('homeWidth', 9);     // short side/frontage
    const homeDepthM   = num('homeDepth', 12);    // long side
    const frontSetback = num('frontSetback', 5);  // gap front/back (between rows)
    const sideGapM     = num('sideGap', 2);       // gap left/right
    const edgeMarginM  = 0.6;                     // clearance from edges

    // Rotation (manual or auto)
    const rawAngle = parseFloat(String($('rotationAngle')?.value || '').trim());
    const angleDeg = Number.isFinite(rawAngle) ? rawAngle : getLongestEdgeAngle(site);

    // 2) Buildable = site − roads
    let buildable = site;
    if (Array.isArray(roads) && roads.length) {
      try {
        const roadsU = unionAll(roads);
        const diff = turf.difference(site, roadsU);
        if (diff) buildable = diff;
      } catch (err) {
        console.warn('Road difference failed; using full site.', err);
      }
    }

    // 3) Inset so full rectangles fit (your block)
    const halfMax = Math.max(homeWidthM, homeDepthM) / 2;
    let placementArea;
    try {
      placementArea = turf.buffer(buildable, -(halfMax + edgeMarginM), { units: 'meters' });
      if (
        !placementArea ||
        (placementArea.geometry.type !== 'Polygon' && placementArea.geometry.type !== 'MultiPolygon')
      ) {
        placementArea = buildable;
      }
    } catch (e) {
      placementArea = buildable;
    }

    if (turf.area(placementArea) < (homeWidthM * homeDepthM)) {
      map.getSource('homes')?.setData(emptyFC());
      setStats('<p><strong>Buildable area too small</strong> for one home with current sizes.</p>');
      return;
    }

    // 4) meters → degrees at site latitude (guard cos near poles)
    const lat = turf.center(placementArea).geometry.coordinates[1];
    const latR = lat * Math.PI / 180;
    const dLat = 1 / 110540;
    const cosLat = Math.max(0.0001, Math.cos(latR));
    const dLon = 1 / (111320 * cosLat);

    const widthLon = Math.max(1e-9, homeWidthM * dLon);
    const depthLat = Math.max(1e-9, homeDepthM * dLat);
    const stepLon  = Math.max(1e-9, (homeWidthM + sideGapM)    * dLon); // across short edges
    const stepLat  = Math.max(1e-9, (homeDepthM + frontSetback)* dLat); // along long edges

    // 5) Rotate area to axis frame, seed grid, rotate back
    const pivot = turf.center(placementArea).geometry.coordinates;
    const rotatedArea = turf.transformRotate(placementArea, -angleDeg, { pivot });

    const [minX, minY, maxX, maxY] = turf.bbox(rotatedArea);
    const cols = Math.ceil((maxX - minX) / stepLon);
    const rows = Math.ceil((maxY - minY) / stepLat);
    const cells = cols * rows;
    const MAX_CELLS = 50000;
    const scale = cells > MAX_CELLS ? Math.sqrt(cells / MAX_CELLS) : 1;

    const homes = [];
    for (let x = minX; x <= maxX; x += stepLon * scale) {
      for (let y = minY; y <= maxY; y += stepLat * scale) {
        const cx = x + (stepLon * scale) / 2;
        const cy = y + (stepLat * scale) / 2;

        const halfLon = widthLon / 2;
        const halfLat = depthLat / 2;

        const rect = turf.polygon([[
          [cx - halfLon, cy - halfLat],
          [cx + halfLon, cy - halfLat],
          [cx + halfLon, cy + halfLat],
          [cx - halfLon, cy + halfLat],
          [cx - halfLon, cy - halfLat]
        ]], { height: 4 });

        if (!turf.booleanWithin(rect, rotatedArea)) continue;

        const rectBack = turf.transformRotate(rect, angleDeg, { pivot });
        homes.push(rectBack);
      }
    }

    // 6) Render + stats (use buildable for density)
    const areaM2 = turf.area(buildable);
    const ha = areaM2 / 10000;
    map.getSource('homes')?.setData(fc(homes));
    setStats(`
      <p><strong>Buildable area (site − roads):</strong> ${Math.round(areaM2).toLocaleString()} m² (${ha.toFixed(2)} ha)</p>
      <p><strong>Homes placed:</strong> ${homes.length}</p>
      <p><strong>Rotation used:</strong> ${angleDeg.toFixed(1)}°</p>
      <p><strong>Actual density:</strong> ${(homes.length / (ha || 1)).toFixed(1)} homes/ha</p>
    `);
  }
});
