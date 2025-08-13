// createroads.js — build a perpendicular spine off the user-drawn access road
// Exported: createRoads(siteBoundary, accessLine, opts?) -> { polys: FeatureCollection, spine: LineString }

export function createRoads(siteBoundary, accessLine, opts = {}) {
  const fc = (features = []) => ({ type: 'FeatureCollection', features });
  const meters = { units: 'meters' };

  // ---------- guards ----------
  if (!isPoly(siteBoundary) || !isLine(accessLine)) return { polys: fc([]), spine: null };

  // widths (meters)
  const mainRoadWidth  = clamp(num(opts.mainRoadWidth, 8),  3, 30);
  const spineRoadWidth = clamp(num(opts.spineRoadWidth, 6),  3, 20);

  // 1) Smooth access line slightly and clip inside site
  const accessSmooth = tryBezier(accessLine, 0.2);
  const accessInside = clipLineInside(accessSmooth, siteBoundary) || accessSmooth;
  if (!isLine(accessInside)) return { polys: fc([]), spine: null };

  // 2) Pick an anchor point along the access line (60% in from the outer end)
  const accLen = turf.length(accessInside, { units: 'meters' });
  const sAnchor = clamp(accLen * 0.6, 5, accLen - 5);
  const anchor  = turf.along(accessInside, sAnchor / 1000, { units: 'kilometers' });
  const accBear = tangentBearing(accessInside, sAnchor);

  // 3) Choose a perpendicular bearing that heads deeper into the site
  // Try +90 and -90; pick the one whose test point sits further inside.
  const bL = accBear + 90, bR = accBear - 90;
  const testL = turf.destination(anchor, 8, bL, meters);
  const testR = turf.destination(anchor, 8, bR, meters);
  const scoreL = insideScore(testL, siteBoundary);
  const scoreR = insideScore(testR, siteBoundary);
  const spineBearing = scoreL >= scoreR ? bL : bR;

  // 4) Grow the spine until it reaches the boundary
  const step = 8;           // meters per segment
  const maxLen = 1200;      // hard cap (m)
  const coords = [coord(anchor)];
  let traveled = 0;
  for (;;) {
    const last = coords[coords.length - 1];
    const next = coord(turf.destination(turf.point(last), step, spineBearing, meters));
    if (!goodCoord(next)) break;
    // stop if next goes outside the site
    const inside = safeInside(turf.point(next), siteBoundary);
    if (!inside || traveled > maxLen) break;
    coords.push(next);
    traveled += step;
  }

  // If we only have the anchor, try a single step so we at least get a short spine
  if (coords.length < 2) {
    const n2 = coord(turf.destination(anchor, 12, spineBearing, meters));
    if (goodCoord(n2)) coords.push(n2);
  }

  const spineLine = turf.lineString(coords);

  // 5) Buffer both access and spine to polygons, clip to site, and return
  const pieces = [];
  const accessPoly = clipBuffer(accessInside, mainRoadWidth / 2);
  if (accessPoly) pieces.push(accessPoly);
  const spinePoly  = clipBuffer(spineLine,  spineRoadWidth / 2);
  if (spinePoly) pieces.push(spinePoly);

  return { polys: fc(pieces), spine: spineLine };

  // ---------- helpers ----------
  function num(v, d){ const n = Number(v); return Number.isFinite(n) ? n : d; }
  function clamp(n,a,b){ return Math.min(Math.max(n,a), b); }
  function coord(pt){ return pt?.geometry?.coordinates || pt?.coordinates || pt || null; }
  function goodCoord(c){ return Array.isArray(c) && c.length === 2 && isFinite(c[0]) && isFinite(c[1]); }

  function isPoly(f){
    return f && f.type === 'Feature' && f.geometry &&
      (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
  }
  function isLine(f){
    return f && f.type === 'Feature' && f.geometry && f.geometry.type === 'LineString' &&
      Array.isArray(f.geometry.coordinates) &&
      f.geometry.coordinates.length >= 2 &&
      f.geometry.coordinates.every(c => Array.isArray(c) && c.length === 2 && isFinite(c[0]) && isFinite(c[1]));
  }

  function tryBezier(line, sharpness=0.2){
    try { return turf.bezierSpline(line, { sharpness, resolution: 10000 }); }
    catch { return line; }
  }

  function clipLineInside(line, poly){
    try {
      const parts = turf.lineSplit(line, poly);
      if (!parts?.features?.length) return null;
      const inside = parts.features.filter(seg => {
        const mid = turf.along(seg, turf.length(seg, {units:'kilometers'})/2, {units:'kilometers'});
        return turf.booleanPointInPolygon(mid, poly);
      });
      if (!inside.length) return null;
      // longest inside piece
      let best = inside[0], bestLen = turf.length(best);
      for (let i=1;i<inside.length;i++){
        const L = turf.length(inside[i]);
        if (L > bestLen){ best = inside[i]; bestLen = L; }
      }
      return best;
    } catch { return null; }
  }

  function clipBuffer(lineOrPoly, radius){
    try {
      const buf = turf.buffer(lineOrPoly, radius, meters);
      const inter = turf.intersect(buf, siteBoundary);
      return inter || null;
    } catch { return null; }
  }

  function tangentBearing(line, sMeters){
    const total = turf.length(line, { units:'meters' });
    if (!(total > 0)) return 0;
    const d = Math.min(2, Math.max(0.5, total * 0.01));
    const s0 = clamp(sMeters - d/2, 0, total);
    const s1 = clamp(sMeters + d/2, 0, total);
    const p0 = turf.along(line, s0/1000, { units:'kilometers' });
    const p1 = turf.along(line, s1/1000, { units:'kilometers' });
    const b  = turf.bearing(p0, p1);
    return Number.isFinite(b) ? b : 0;
  }

  function insideScore(point, poly){
    try { return turf.booleanPointInPolygon(point, poly) ? 1 : 0; } catch { return 0; }
  }

  function safeInside(point, poly){
    try { return turf.booleanPointInPolygon(point, poly); } catch { return false; }
  }
}
