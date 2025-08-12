// createroads.js — organic access road from a user‑drawn LineString
// Exported API:
//   createRoads(siteBoundary: Feature<Polygon|MultiPolygon>,
//               entranceLine: Feature<LineString>,
//               opts?: { mainRoadWidth })

export function createRoads(siteBoundary, entranceLine, opts = {}) {
  const fc = (features=[]) => ({ type:'FeatureCollection', features });
  const clamp = (n,a,b)=>Math.min(Math.max(n,a),b);

  // ---- guards ----
  if (!isPoly(siteBoundary) || !isLine(entranceLine)) return fc();

  const mainRoadWidth = clamp(
    Number.isFinite(+opts.mainRoadWidth) ? +opts.mainRoadWidth : 8,
    3, 20
  );

  // 1) Smooth the user line a bit (keeps curves but reduces kinks)
  const raw = entranceLine;
  const smooth = tryBezier(raw, 0.25);

  // 2) Keep only the portion inside the site (if any)
  const centerlineInside = clipLineInside(smooth, siteBoundary) || smooth;

  // 3) Buffer to a polygon road and clip to site
  let roadPoly = null;
  try {
    const buf = turf.buffer(centerlineInside, mainRoadWidth / 2, { units: 'meters' });
    roadPoly = safeIntersectPoly(buf, siteBoundary);
  } catch { /* ignore */ }

  return roadPoly ? fc([roadPoly]) : fc();

  // ---------- helpers ----------
  function isPoly(f){
    return f && f.type==='Feature' && f.geometry &&
      (f.geometry.type==='Polygon' || f.geometry.type==='MultiPolygon');
  }
  function isLine(f){
    return f && f.type==='Feature' && f.geometry &&
      f.geometry.type==='LineString' &&
      Array.isArray(f.geometry.coordinates) &&
      f.geometry.coordinates.length >= 2 &&
      f.geometry.coordinates.every(c => Array.isArray(c) && c.length===2 &&
        Number.isFinite(c[0]) && Number.isFinite(c[1]));
  }

  function tryBezier(line, sharpness=0.25){
    try {
      return turf.bezierSpline(line, { sharpness, resolution: 10000 });
    } catch { return line; }
  }

  // Clip a line to the interior of a polygon; keep longest inside piece
  function clipLineInside(line, poly){
    try {
      const parts = turf.lineSplit(line, poly);
      if (!parts?.features?.length) return null;
      const inside = parts.features.filter(seg => {
        const mid = turf.along(seg, turf.length(seg, { units:'kilometers' })/2, { units:'kilometers' });
        return turf.booleanPointInPolygon(mid, poly);
      });
      if (!inside.length) return null;
      let best = inside[0], bestL = turf.length(best, { units:'meters' });
      for (let i=1;i<inside.length;i++){
        const L = turf.length(inside[i], { units:'meters' });
        if (L > bestL){ best = inside[i]; bestL = L; }
      }
      return best;
    } catch { return null; }
  }

  function safeIntersectPoly(a, b){
    try {
      const inter = turf.intersect(a, b);
      return inter || null;
    } catch { return null; }
  }
}
