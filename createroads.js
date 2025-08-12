// createroads.js — minimal, safe named export

export function createRoads(siteBoundary, entranceLine, opts = {}) {
  const fc = (features=[]) => ({ type: 'FeatureCollection', features });
  const meters = { units: 'meters' };

  // Guard inputs
  if (!isPoly(siteBoundary) || !isLine(entranceLine)) return fc([]);

  // widths (meters)
  const mainRoadWidth  = clamp(num(opts.mainRoadWidth, 8),  3, 30);
  const localRoadWidth = clamp(num(opts.localRoadWidth, 5),  3, 20);

  // 1) Smooth entrance a touch (safe)
  const smooth = tryBezier(entranceLine, 0.2);

  // 2) Clip the entrance inside the site (best effort)
  const inside = clipLineInside(smooth, siteBoundary) || smooth;

  // 3) Buffer to polygon and clip to site
  let mainPoly = null;
  try {
    const buf = turf.buffer(inside, mainRoadWidth / 2, meters);
    mainPoly = intersectSafe(buf, siteBoundary);
  } catch (e) {
    console.warn('buffer failed', e);
  }

  return fc(mainPoly ? [mainPoly] : []);

  // ---------- helpers ----------
  function num(v, d){ const n = Number(v); return Number.isFinite(n) ? n : d; }
  function clamp(n,a,b){ return Math.min(Math.max(n,a), b); }

  function isPoly(f){
    return f && f.type === 'Feature' && f.geometry &&
      (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
  }
  function isLine(f){
    return f && f.type === 'Feature' && f.geometry &&
      f.geometry.type === 'LineString' &&
      Array.isArray(f.geometry.coordinates) &&
      f.geometry.coordinates.length >= 2 &&
      f.geometry.coordinates.every(c => Array.isArray(c) && c.length === 2 && isFinite(c[0]) && isFinite(c[1]));
  }

  function tryBezier(line, sharpness=0.2){
    try { return turf.bezierSpline(line, { sharpness, resolution: 10000 }); }
    catch { return line; }
  }

  // keep longest segment inside polygon
  function clipLineInside(line, poly){
    try {
      const parts = turf.lineSplit(line, poly);
      if (!parts?.features?.length) return null;
      const inside = parts.features.filter(seg => {
        const mid = turf.along(seg, turf.length(seg, {units: 'kilometers'})/2, {units: 'kilometers'});
        return turf.booleanPointInPolygon(mid, poly);
      });
      if (!inside.length) return null;
      let best = inside[0], bestLen = turf.length(best);
      for (let i=1;i<inside.length;i++){
        const L = turf.length(inside[i]);
        if (L > bestLen){ best = inside[i]; bestLen = L; }
      }
      return best;
    } catch { return null; }
  }

  function intersectSafe(a, b){
    try { return turf.intersect(a, b) || null; } catch { return null; }
  }
}
