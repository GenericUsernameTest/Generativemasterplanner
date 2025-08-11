// homes.js — home infill + geometry helpers

// Public: longest-edge bearing (degrees)
export function getLongestEdgeAngle(polygon) {
  const coords = polygon.geometry.coordinates[0];
  let longestAngle = 0, longestDist = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = turf.point(coords[i]);
    const p2 = turf.point(coords[i + 1]);
    const dist = turf.distance(p1, p2, { units: 'meters' });
    if (dist > longestDist) {
      longestDist = dist;
      longestAngle = turf.bearing(p1, p2);
    }
  }
  return longestAngle;
}

// Public: place homes (short/front along longest edge)
export function fillHomes({ map, siteBoundary, roads, setStats }) {
  if (!siteBoundary) { alert('Draw the site boundary first.'); return; }

  // Buildable = site − union(roads)
  let buildable = siteBoundary;
  if (roads?.length) {
    const roadsU = unionAll(roads);
    try { buildable = turf.difference(siteBoundary, roadsU) || siteBoundary; }
    catch (err) { console.warn('difference failed; using site as buildable', err); }
  }

  // --------- PARAMETERS ---------
  const HOME_FRONT_M  = 6.5;  // short edge (frontage) ALONG boundary
  const HOME_DEPTH_M  = 10;   // long edge (depth) PERPENDICULAR
  const HOME_HEIGHT_M = 4;    // extrusion height

  const GAP_SIDE_M    = 2;    // gap between frontages (left/right)
  const GAP_FRONT_M   = 5;    // gap between rows (front/back)
  const EDGE_MARGIN_M = 0.5;  // inset from edges
  // ------------------------------

  // Inset so homes fit fully
  const halfMax = Math.max(HOME_FRONT_M, HOME_DEPTH_M) / 2;
  let placementArea;
  try {
    placementArea = turf.buffer(buildable, -(halfMax + EDGE_MARGIN_M), { units: 'meters' });
    if (!placementArea ||
        (placementArea.geometry.type !== 'Polygon' && placementArea.geometry.type !== 'MultiPolygon')) {
      placementArea = buildable;
    }
  } catch (e) {
    console.warn('buffer failed, using original buildable', e);
    placementArea = buildable;
  }

  // Stats
  const areaM2 = turf.area(buildable);
  const ha     = areaM2 / 10000;

  // meters → degrees at site latitude (approx)
  const lat   = turf.center(buildable).geometry.coordinates[1];
  const dLat  = 1 / 110540;
  const dLon  = 1 / (111320 * Math.cos(lat * Math.PI / 180));

  // FRONT along X (boundary direction), DEPTH along Y
  const frontLon = HOME_FRONT_M * dLon;
  const depthLat = HOME_DEPTH_M * dLat;

  const stepLon  = (HOME_FRONT_M + GAP_SIDE_M)  * dLon; // spacing left/right
  const stepLat  = (HOME_DEPTH_M + GAP_FRONT_M) * dLat; // spacing front/back

  // Rotation: manual (if typed) else auto longest-edge
  const manualAngle = parseFloat(document.getElementById('rotationAngle')?.value);
  const angle = isNaN(manualAngle) ? getLongestEdgeAngle(siteBoundary) : manualAngle;

  // Work in rotated frame where rows are axis-aligned, then rotate homes back
  const pivot = turf.center(placementArea).geometry.coordinates;
  const rotatedArea = turf.transformRotate(placementArea, -angle, { pivot });

  const bbox  = turf.bbox(rotatedArea);
  const homes = [];

  for (let x = bbox[0]; x < bbox[2]; x += stepLon) {
    for (let y = bbox[1]; y < bbox[3]; y += stepLat) {
      const cx = x + stepLon / 2, cy = y + stepLat / 2;

      // Rectangle in rotated space (FRONT along X, DEPTH along Y)
      const halfLon = frontLon / 2, halfLat = depthLat / 2;
      const rect = turf.polygon([[
        [cx - halfLon, cy - halfLat],
        [cx + halfLon, cy - halfLat],
        [cx + halfLon, cy + halfLat],
        [cx - halfLon, cy + halfLat],
        [cx - halfLon, cy - halfLat]
      ]], { height: HOME_HEIGHT_M });

      if (turf.booleanWithin(rect, rotatedArea)) {
        const rectBack = turf.transformRotate(rect, angle, { pivot });
        homes.push(rectBack);
      }
    }
  }

  map.getSource('homes').setData(fc(homes));

  setStats?.(`
    <p><strong>Buildable area:</strong> ${Math.round(areaM2).toLocaleString()} m² (${ha.toFixed(2)} ha)</p>
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Rotation used:</strong> ${angle.toFixed(1)}°</p>
    <p><strong>Actual density:</strong> ${(homes.length / ha || 0).toFixed(1)} homes/ha</p>
  `);
}

// ----- internal helpers (kept private to this module) -----
function unionAll(features) {
  if (!features?.length) return null;
  let u = features[0];
  for (let i = 1; i < features.length; i++) {
    try { u = turf.union(u, features[i]); }
    catch (err) { console.warn('union failed on feature', i, err); }
  }
  return u;
}
function fc(features) { return { type: 'FeatureCollection', features }; }
