// homes.js  (ES module)
// Requires Turf to be loaded globally (via <script src="https://unpkg.com/@turf/turf@6/turf.min.js"></script>).

/**
 * Compute the bearing (deg) of the longest edge of a polygon (outer ring).
 * Returned in the range [-180, 180].
 */
export function getLongestEdgeAngle(polygon) {
  const ring = polygon?.geometry?.coordinates?.[0] || [];
  let longest = 0;
  let angle = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = turf.point(ring[i]);
    const p2 = turf.point(ring[i + 1]);
    const dist = turf.distance(p1, p2, { units: 'meters' });
    if (dist > longest) {
      longest = dist;
      angle = turf.bearing(p1, p2); // [-180,180]
    }
  }
  return angle;
}

/**
 * Union an array of polygons. Returns null for empty.
 */
function unionAll(polys) {
  if (!polys || !polys.length) return null;
  let out = polys[0];
  for (let i = 1; i < polys.length; i++) {
    try { out = turf.union(out, polys[i]); }
    catch (e) { console.warn('union failed at', i, e); }
  }
  return out;
}

/**
 * Convert meters to degree deltas at a given latitude.
 * Returns { dLon, dLat } such that meters * dLon -> degrees lon, meters * dLat -> degrees lat.
 */
function metersToDegrees(latDeg) {
  const lat = latDeg * Math.PI / 180;
  const dLat = 1 / 110540;                 // deg latitude per meter
  const dLon = 1 / (111320 * Math.cos(lat)); // deg longitude per meter
  return { dLon, dLat };
}

/**
 * Simple FC builder.
 */
function fc(features) {
  return { type: 'FeatureCollection', features: features || [] };
}

/**
 * Fill the (site - roads) with rectangles (homes) aligned in straight rows.
 * Short edge (width) runs parallel to the site's longest edge by default.
 *
 * options = {
 *   map,                          // mapboxgl.Map
 *   siteBoundary,                 // Feature<Polygon>
 *   roads,                        // Feature<Polygon>[]
 *   statsEl,                      // HTMLElement for stats (optional)
 *   rotationInput,                // <input type="number"> for manual rotation (optional)
 *   homesSourceId: 'homes',       // Mapbox source id to write to
 *   params: {                     // OPTIONAL tuning
 *     homeWidthM: 6.5,
 *     homeDepthM: 10,
 *     homeHeightM: 4,
 *     gapSideM: 2,
 *     gapFrontM: 5,
 *     edgeMarginM: 0.5
 *   }
 * }
 */
export function fillHomes(options) {
  const {
    map,
    siteBoundary,
    roads = [],
    statsEl,
    rotationInput,
    homesSourceId = 'homes',
    params = {}
  } = options || {};

  if (!map || !siteBoundary) {
    console.warn('fillHomes: missing map or siteBoundary');
    return;
  }

  // ---------- Parameters ----------
  const homeWidthM  = params.homeWidthM  ?? 6.5; // short edge (frontage)
  const homeDepthM  = params.homeDepthM  ?? 10;  // long edge (depth)
  const homeHeightM = params.homeHeightM ?? 4;
  const gapSideM    = params.gapSideM    ?? 2;   // gap left/right (between long sides)
  const gapFrontM   = params.gapFrontM   ?? 5;   // gap front/back (between short sides)
  const edgeMarginM = params.edgeMarginM ?? 0.5; // inset from edges

  // ---------- Buildable area = site - roads ----------
  let buildable = siteBoundary;
  if (roads && roads.length) {
    const roadsU = unionAll(roads);
    try { buildable = turf.difference(siteBoundary, roadsU) || siteBoundary; }
    catch (e) { console.warn('difference failed; using site', e); }
  }

  // Inset so houses fit fully
  const halfMax = Math.max(homeWidthM, homeDepthM) / 2;
  let placementArea;
  try {
    placementArea = turf.buffer(buildable, -(halfMax + edgeMarginM), { units: 'meters' });
    if (!placementArea) placementArea = buildable;
  } catch (e) {
    console.warn('buffer failed, using buildable polygon', e);
    placementArea = buildable;
  }

  // ---------- Stats ----------
  const areaM2 = turf.area(buildable);
  const ha = areaM2 / 10000;

  // ---------- Rotation ----------
  // Default: ALIGN short edge (width) with longest boundary edge.
  // That means rows run parallel to the long edge, depth goes inward (perpendicular).
  let angleDeg = getLongestEdgeAngle(siteBoundary);
  if (rotationInput) {
    const user = parseFloat(rotationInput.value);
    if (!Number.isNaN(user)) angleDeg = user;
  }

  // Rotate to an unrotated frame, grid align there, then rotate homes back.
  const pivot = turf.center(placementArea).geometry.coordinates;
  const rotatedArea = turf.transformRotate(placementArea, -angleDeg, { pivot });

  // ---------- Grid setup ----------
  const latCenter = turf.center(buildable).geometry.coordinates[1];
  const { dLon, dLat } = metersToDegrees(latCenter);

  // Short edge (width) runs along X; long edge (depth) runs along Y in rotated frame.
  const widthLon = homeWidthM * dLon;
  const depthLat = homeDepthM * dLat;
  const stepLon  = (homeWidthM + gapSideM) * dLon;  // spacing along X (between long sides)
  const stepLat  = (homeDepthM + gapFrontM) * dLat; // spacing along Y (between short sides)

  const [minX, minY, maxX, maxY] = turf.bbox(rotatedArea);
  const homes = [];

  for (let x = minX; x < maxX; x += stepLon) {
    for (let y = minY; y < maxY; y += stepLat) {
      const cx = x + stepLon / 2;
      const cy = y + stepLat / 2;

      // Axis-aligned rectangle (rotated frame): width along X, depth along Y
      const halfLon = widthLon / 2;
      const halfLat = depthLat / 2;

      const rect = turf.polygon([[
        [cx - halfLon, cy - halfLat],
        [cx + halfLon, cy - halfLat],
        [cx + halfLon, cy + halfLat],
        [cx - halfLon, cy + halfLat],
        [cx - halfLon, cy - halfLat]
      ]], { height: homeHeightM });

      // Keep only rectangles fully inside the rotated placement area
      if (turf.booleanWithin(rect, rotatedArea)) {
        // Rotate the rectangle back to map coords
        const rectBack = turf.transformRotate(rect, angleDeg, { pivot });
        homes.push(rectBack);
      }
    }
  }

  // ---------- Write to map ----------
  const source = map.getSource(homesSourceId);
  if (source) source.setData(fc(homes));
  else console.warn(`fillHomes: source '${homesSourceId}' not found`);

  // ---------- Update stats ----------
  if (statsEl) {
    statsEl.innerHTML = `
      <p><strong>Buildable area:</strong> ${Math.round(areaM2).toLocaleString()} m² (${ha.toFixed(2)} ha)</p>
      <p><strong>Homes placed:</strong> ${homes.length}</p>
      <p><strong>Rotation used:</strong> ${angleDeg.toFixed(1)}°</p>
      <p><strong>Actual density:</strong> ${(homes.length / (ha || 1)).toFixed(1)} homes/ha</p>
    `;
  }
}
