// createroads.js
// Builds a simple, meter-accurate road network aligned to the entrance road.
// Returns a FeatureCollection of POLYGONS (buffered roads) ready for a fill layer.

export function createroads(site, entranceLine, opts = {}) {
  const {
    mainRoadWidth  = 8,   // m
    localRoadWidth = 5,   // m
    blockDepth     = 30,  // m (one row depth + front)
    blockWidth     = 30,  // m (lots across + side gaps)
    addBulbs       = true // cul-de-sac bulbs at ends
  } = opts;

  // ---------- helpers (local so this file is standalone) ----------
  const fc = (features) => ({ type: 'FeatureCollection', features });
  function unionAll(features) {
    if (!features?.length) return null;
    let u = features[0];
    for (let i = 1; i < features.length; i++) {
      try { u = turf.union(u, features[i]); } catch {}
    }
    return u;
  }
  function metersToDeg(latDeg){
    const latR = latDeg * Math.PI / 180;
    const dLat = 1 / 110540;
    const dLon = 1 / (111320 * Math.max(0.0001, Math.cos(latR)));
    return { dLat, dLon };
  }
  function safeIntersect(a, b){
    try { return turf.intersect(a, b) || null; } catch { return null; }
  }
  // ----------------------------------------------------------------

  // Guard
  if (!site || site.type !== 'Feature' || site.geometry?.type !== 'Polygon') {
    return fc([]);
  }
  if (!entranceLine || entranceLine.geometry?.type !== 'LineString') {
    return fc([]);
  }

  // Compute entrance bearing
  const coords = entranceLine.geometry.coordinates;
  const pStart = turf.point(coords[0]);
  const pEnd   = turf.point(coords[coords.length - 1]);
  let angle = turf.bearing(pStart, pEnd);

  // Pivot around site center and rotate site so entrance is (roughly) horizontal
  const pivot = turf.center(site).geometry.coordinates;
  const siteRot = turf.transformRotate(site, -angle, { pivot });

  // Buffer the entrance to a polygon and clip to site (in original frame)
  const entrancePolyRaw = turf.buffer(entranceLine, mainRoadWidth / 2, { units: 'meters' });
  const entrancePoly    = safeIntersect(entrancePolyRaw, site) ?? turf.buffer(entranceLine, mainRoadWidth / 2, { units: 'meters' });

  // Work in rotated space for grid
  const lat = turf.center(site).geometry.coordinates[1];
  const { dLat, dLon } = metersToDeg(lat);

  // Grid pitches (in meters)
  const pitchY = 2 * blockDepth + localRoadWidth; // horizontal roads every two rows + road width
  const pitchX = blockWidth + localRoadWidth;     // vertical roads between blocks + road width

  // Convert to deg (only to set sampling frequency; we still buffer in meters)
  const stepY = Math.max(1e-9, pitchY * dLat);
  const stepX = Math.max(1e-9, pitchX * dLon);

  const [minX, minY, maxX, maxY] = turf.bbox(siteRot);
  const roadPolysRot = [];

  // Horizontal locals (constant y), buffer then clip to rotated site
  for (let y = minY; y <= maxY; y += stepY) {
    const seg = turf.lineString([[minX - 1, y], [maxX + 1, y]]);
    const buf = turf.buffer(seg, localRoadWidth / 2, { units: 'meters' });
    const clip = safeIntersect(buf, siteRot);
    if (clip) roadPolysRot.push(clip);
  }

  // Vertical locals (constant x)
  const verticalEnds = []; // for bulbs
  for (let x = minX; x <= maxX; x += stepX) {
    const seg = turf.lineString([[x, minY - 1], [x, maxY + 1]]);
    const buf = turf.buffer(seg, localRoadWidth / 2, { units: 'meters' });
    const clip = safeIntersect(buf, siteRot);
    if (clip) {
      roadPolysRot.push(clip);

      // crude endpoints for bulbs (just band edges)
      verticalEnds.push([x, minY + localRoadWidth * dLat * 0.5]);
      verticalEnds.push([x, maxY - localRoadWidth * dLat * 0.5]);
    }
  }

  // Add cul‑de‑sac bulbs at vertical dead-ends near the site edge
  if (addBulbs && verticalEnds.length) {
    verticalEnds.forEach(c => {
      const bulb = turf.circle(c, Math.max(4, localRoadWidth * 0.9), { steps: 32, units: 'meters' });
      const clip = safeIntersect(bulb, siteRot);
      if (clip) roadPolysRot.push(clip);
    });
  }

  // Rotate the rotated roads back to original frame
  const roadsBack = roadPolysRot.map(p => turf.transformRotate(p, angle, { pivot }));

  // Include entrance (already in original frame) as polygon
  if (entrancePoly) roadsBack.push(entrancePoly);

  // Union them for a tidy single multipolygon
  let unioned = roadsBack.length ? roadsBack[0] : null;
  for (let i = 1; i < roadsBack.length; i++) {
    try { unioned = turf.union(unioned, roadsBack[i]); } catch {}
  }

  return unioned ? fc([unioned]) : fc([]);
}
