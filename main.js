// ================= CONFIG =================
mapboxgl.accessToken =
  'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

// ================= UTILS ==================
const $ = (id) => document.getElementById(id);
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
const fc = (features) => ({ type: 'FeatureCollection', features });

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
        // 🎨 Color by type (t1/t2/t3)
        'fill-extrusion-color': [
          'match', ['get', 'type'],
          't1', HOUSE_TYPES.t1.color,
          't2', HOUSE_TYPES.t2.color,
          't3', HOUSE_TYPES.t3.color,
          '#cccccc' // default
        ],
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
      const autoA = getLongestEdgeAngle(siteBoundary);
      const angleEl = $('rotationAngle');
      if (angleEl && (angleEl.value ?? '') === '') angleEl.value = autoA.toFixed(1);

      setStats('<p>Site boundary saved. Pick a house type and click <b>Generate Plan</b>.</p>');
      draw.deleteAll();
      map.getCanvas().style.cursor = '';
    });

    wireToolbar();
    wireLiveUpdates(); // live re-gen on parameter changes
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

  // Live updates when user tweaks controls
  function wireLiveUpdates() {
    const ids = ['rotationAngle', 'houseType', 'frontSetback', 'sideGap'];
    ids.forEach(id => {
      const el = $(id);
      if (!el) return;
      const apply = () => { if (siteBoundary) generatePlan(); };
      ['change','input','blur'].forEach(evt => el.addEventListener(evt, apply));
      el.addEventListener('keyup', (e) => { if (e.key === 'Enter') apply(); });
    });
  }

  function clearOutputs(){
    map.getSource('homes')?.setData(emptyFC());
    setStats('');
  }

  // -------- Rendering helpers --------
  function refreshSite() {
    map.getSource('site-view')?.setData(siteBoundary ? fc([siteBoundary]) : emptyFC());
  }

  // ============ CORE: Homes (by selected type) ============
  function generatePlan() {
    if (!siteBoundary) { alert('Draw the site boundary first.'); return; }

    // Inputs
    const typeKey = ($('houseType')?.value) || 't1';
    const { w: homeW, d: homeD } = HOUSE_TYPES[typeKey];
    const front  = parseFloat($('frontSetback')?.value) || 5; // row spacing
    const side   = parseFloat($('sideGap')?.value) || 2;      // sideways gap

    // Rotation
    const rawAngle = parseFloat(String($('rotationAngle')?.value || '').trim());
    const angleDeg = Number.isFinite(rawAngle) ? rawAngle : getLongestEdgeAngle(siteBoundary);

    // Base geometries
    const site = siteBoundary;
    const lat  = turf.center(site).geometry.coordinates[1];
    const { dLat, dLon } = metersToDeg(lat);

    // Inset buildable by half home size so full rectangles fit
    const edgeMarginM = 0.6;
    const halfMax = Math.max(homeW, homeD) / 2;
    let placementArea;
    try {
      const buf = turf.buffer(site, -(halfMax + edgeMarginM), { units: 'meters' });
      if (buf && (buf.geometry.type === 'Polygon' || buf.geometry.type === 'MultiPolygon')) {
        placementArea = buf;
      } else {
        placementArea = site;
      }
    } catch (e) {
      placementArea = site;
    }

    // Place homes on a straight grid aligned to angleDeg
    const { dLat: dLatP, dLon: dLonP } = metersToDeg(turf.center(placementArea).geometry.coordinates[1]);

    const widthLon = Math.max(1e-9, homeW * dLonP);
    const depthLat = Math.max(1e-9, homeD * dLatP);
    const stepLon  = Math.max(1e-9, (homeW + side)  * dLonP); // across short edges
    const stepLat  = Math.max(1e-9, (homeD + front) * dLatP); // along long edges

    const pivot = turf.center(placementArea).geometry.coordinates;
    const placeRot = turf.transformRotate(placementArea, -angleDeg, { pivot });
    const [px0, py0, px1, py1] = turf.bbox(placeRot);

    const homes = [];
    for (let x = px0; x <= px1; x += stepLon) {
      for (let y = py0; y <= py1; y += stepLat) {
        const cx = x + stepLon / 2;
        const cy = y + stepLat / 2;

        // axis-aligned rect in rotated frame (short edge along X)
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

        // rotate back to map frame + tag with type & height
        let rectBack = turf.transformRotate(rect, angleDeg, { pivot });
        rectBack.properties = {
          type: typeKey,
          w: homeW,
          d: homeD,
          height: 4 // keep consistent height, or vary by type if you prefer
        };
        homes.push(rectBack);
      }
    }

    // Render + stats
    const buildableArea = turf.area(placementArea); // close enough for feedback
    const ha = buildableArea / 10000;
    map.getSource('homes')?.setData(fc(homes));
    setStats(`
      <p><strong>House type:</strong> ${typeKey.toUpperCase()} — ${homeW}m × ${homeD}m</p>
      <p><strong>Homes placed:</strong> ${homes.length}</p>
      <p><strong>Buildable area (inset):</strong> ${Math.round(buildableArea).toLocaleString()} m² (${ha.toFixed(2)} ha)</p>
      <p><strong>Rotation used:</strong> ${angleDeg.toFixed(1)}°</p>
      <p><strong>Actual density:</strong> ${(homes.length / (ha || 1)).toFixed(1)} homes/ha</p>
    `);
  }
});
