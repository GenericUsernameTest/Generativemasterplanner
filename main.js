// main.js

// ========== CONFIG ==========
mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

// ========== UTIL ==========
const $ = (id) => document.getElementById(id);
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
const fc = (features) => ({ type: 'FeatureCollection', features });

// Convert meters to degree deltas at given latitude
function metersToDegrees(latDeg) {
  const lat = latDeg * Math.PI / 180;
  const dLat = 1 / 110540;                 // deg latitude per meter
  const dLon = 1 / (111320 * Math.cos(lat)); // deg longitude per meter
  return { dLon, dLat };
}

// Bearing of longest site edge (deg, -180..180)
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

// ========== APP ==========
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

  let draw;
  let siteBoundary = null;

  map.on('load', () => {
    // Layers: site (fill then line), homes
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
        'fill-extrusion-height': ['coalesce', ['get','height'], 4],
        'fill-extrusion-opacity': 0.75
      }
    });

    // Draw
    draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: true, trash: true } });
    map.addControl(draw);

    // Make Draw look like your theme (after the style is ready)
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
          try { map.setPaintProperty(id, prop, val); } catch {}
        }
      });
    };
    tuneDrawStyles();
    map.on('styledata', tuneDrawStyles);
    map.on('draw.modechange', () => { map.getCanvas().style.cursor = ''; tuneDrawStyles(); });

    // Draw end -> capture site
    map.on('draw.create', (e) => {
      const feat = e.features[0];
      if (!feat || feat.geometry.type !== 'Polygon') return;

      siteBoundary = feat;
      refreshSite();
      // Pre-fill rotation with auto bearing
      const auto = getLongestEdgeAngle(siteBoundary);
      if ($('rotationAngle')) $('rotationAngle').value = auto.toFixed(1);

      setStats('<p>Site boundary saved. Adjust parameters and press <b>Generate Plan</b>.</p>');
      draw.deleteAll();
      map.getCanvas().style.cursor = '';
    });

    // Wire toolbar after DOM is ready (guard IDs)
    wireToolbar();

    // Immediate rerun on rotation change (if site exists)
    const angleEl = $('rotationAngle');
    if (angleEl) {
      const apply = () => { if (siteBoundary) generateHomes(map, siteBoundary); };
      ['input','change','blur'].forEach(evt => angleEl.addEventListener(evt, apply));
      angleEl.addEventListener('keyup', (e) => { if (e.key === 'Enter') apply(); });
    }
  });

  // ---- Toolbar wiring (safe) ----
  function wireToolbar() {
    const drawSiteBtn  = $('drawSite');
    const fillHomesBtn = $('fillHomes');
    const clearAllBtn  = $('clearAll');

    if (drawSiteBtn) {
      drawSiteBtn.onclick = () => {
        if (!draw) return;
        draw.deleteAll();
        siteBoundary = null;
        refreshSite();
        clearHomes();
        draw.changeMode('draw_polygon');
        map.getCanvas().style.cursor = 'crosshair';
        setStats('<p>Drawing site boundary… click to add points, double‑click to finish.</p>');
      };
    }

    if (fillHomesBtn) {
      fillHomesBtn.onclick = () => generateHomes(map, siteBoundary);
    }

    if (clearAllBtn) {
      clearAllBtn.onclick = () => {
        if (draw) draw.deleteAll();
        siteBoundary = null;
        refreshSite();
        clearHomes();
        setStats('');
      };
    }
  }

  // ---- Render helpers ----
  function refreshSite() {
    const src = map.getSource('site-view');
    if (src) src.setData(siteBoundary ? fc([siteBoundary]) : emptyFC());
  }
  function clearHomes() {
    const src = map.getSource('homes');
    if (src) src.setData(emptyFC());
  }
  function setStats(html) { const el = $('stats'); if (el) el.innerHTML = html; }

  // ---- Home generator (short edge along rotation) ----
  function generateHomes(map, site) {
    if (!site) { alert('Draw the site boundary first.'); return; }

    // Read UI params
    const homeWidthM   = parseFloat($('homeWidth')?.value)    || 9;  // short side/frontage
    const homeDepthM   = parseFloat($('homeDepth')?.value)    || 12; // long side
    const frontSetback = parseFloat($('frontSetback')?.value) || 5;  // gap front/back
    const sideGapM     = parseFloat($('sideGap')?.value)      || 2;  // gap left/right
    // These two are reserved for future (blocks/roads)
    const roadWidth    = parseFloat($('roadWidth')?.value)    || 9;
    const lotsPerBlock = parseFloat($('lotsPerBlock')?.value) || 5;

    // Rotation: manual or auto
    const manual = parseFloat(($('rotationAngle')?.value || '').trim());
    const angleDeg = Number.isFinite(manual) ? manual : getLongestEdgeAngle(site);

    // Buildable = site inset (so full rects fit). If you later add roads, subtract them here too.
    const edgeMarginM = 0.6; // clearance
    const halfMax = Math.max(homeWidthM, homeDepthM) / 2;
    let placementArea;
    try {
      placementArea = turf.buffer(site, -(halfMax + edgeMarginM), { units: 'meters' });
      if (!placementArea ||
          (placementArea.geometry.type !== 'Polygon' && placementArea.geometry.type !== 'MultiPolygon')) {
        placementArea = site;
      }
    } catch { placementArea = site; }

    // Stats
    const areaM2 = turf.area(placementArea);
    const ha = areaM2 / 10000;

    // meters → degrees (approx)
    const lat = turf.center(placementArea).geometry.coordinates[1];
    const { dLon, dLat } = metersToDegrees(lat);

    // We want short edge (width) along X in rotated frame; long edge (depth) along Y
    const widthLon = homeWidthM * dLon;
    const depthLat = homeDepthM * dLat;
    const stepLon  = (homeWidthM + sideGapM) * dLon;    // spacing left/right (between long sides)
    const stepLat  = (homeDepthM + frontSetback) * dLat; // spacing front/back (between short sides)

    // Rotate placement area into unrotated frame
    const pivot = turf.center(placementArea).geometry.coordinates;
    const rotatedArea = turf.transformRotate(placementArea, -angleDeg, { pivot });

    // Fill grid
    const [minX, minY, maxX, maxY] = turf.bbox(rotatedArea);
    const homes = [];
    for (let x = minX; x <= maxX; x += stepLon) {
      for (let y = minY; y <= maxY; y += stepLat) {
        const cx = x + stepLon / 2;
        const cy = y + stepLat / 2;

        const halfLon = widthLon / 2, halfLat = depthLat / 2;
        const rect = turf.polygon([[
          [cx - halfLon, cy - halfLat],
          [cx + halfLon, cy - halfLat],
          [cx + halfLon, cy + halfLat],
          [cx - halfLon, cy + halfLat],
          [cx - halfLon, cy - halfLat]
        ]], { height: 4 });

        if (!turf.booleanWithin(rect, rotatedArea)) continue;

        // Rotate back to map coords
        const rectBack = turf.transformRotate(rect, angleDeg, { pivot });
        homes.push(rectBack);
      }
    }

    // Update map + stats
    const src = map.getSource('homes');
    if (src) src.setData(fc(homes));
    setStats(`
      <p><strong>Buildable (inset) area:</strong> ${Math.round(areaM2).toLocaleString()} m² (${ha.toFixed(2)} ha)</p>
      <p><strong>Homes placed:</strong> ${homes.length}</p>
      <p><strong>Rotation used:</strong> ${angleDeg.toFixed(1)}°</p>
      <p><strong>Actual density:</strong> ${(homes.length / (ha || 1)).toFixed(1)} homes/ha</p>
    `);
  }
});
