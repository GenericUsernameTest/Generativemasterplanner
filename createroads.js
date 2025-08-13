// createroads.js — build an access road from the user line and
// return: { roadsFC, junction, accessBearing }
export function createRoads(siteBoundary, entranceLine, opts = {}) {
  const meters = { units: 'meters' };
  const fc  = (features=[]) => ({ type:'FeatureCollection', features });
  const num = (v,d)=> Number.isFinite(+v) ? +v : d;
  const clamp=(n,a,b)=> Math.min(Math.max(n,a),b);

  // ---- options (meters) ----
  const accessW = clamp(num(opts.mainRoadWidth, 8), 3, 30);   // access road width
  const smoothSharp = 0.20; // light bezier

  // ---- guards ----
  if (!isPoly(siteBoundary) || !isLine(entranceLine)) return { roadsFC: fc([]), junction:null, accessBearing:NaN };

  // inset a little so roads don’t kiss the green edge
  const insidePoly = safe(() => turf.buffer(siteBoundary, -1.0, meters)) || siteBoundary;

  // smooth & clip the user line inside the (inset) site
  const smoothed = safe(() => turf.bezierSpline(entranceLine, { sharpness: smoothSharp, resolution: 10000 })) || entranceLine;
  const accessCenter = clipLineInside(smoothed, insidePoly) || smoothed;

  // If we don’t have at least 2 coords inside, bail gracefully
  const cs = (accessCenter.geometry && accessCenter.geometry.coordinates) || [];
  if (cs.length < 2) return { roadsFC: fc([]), junction:null, accessBearing:NaN };

  // Make a **rectangle** from the centerline so the end cap is FLAT
  const accessPoly = lineToRect(accessCenter, accessW);

  // Junction point = last coord of the access centerline
  const junction = turf.point(cs[cs.length - 1]);

  // Bearing at the end (use last segment)
  const accessBearing = turf.bearing(
    turf.point(cs[cs.length - 2]),
    turf.point(cs[cs.length - 1])
  );

  // Clip access polygon to site (robust)
  const accessInside = intersectSafe(accessPoly, siteBoundary);

  const out = [];
  if (accessInside) out.push(accessInside);

  return { roadsFC: fc(out), junction, accessBearing };

  // ---------- helpers ----------
  function isPoly(f){
    return f && f.type==='Feature' && f.geometry && (f.geometry.type==='Polygon' || f.geometry.type==='MultiPolygon');
  }
  function isLine(f){
    return f && f.type==='Feature' && f.geometry && f.geometry.type==='LineString' &&
           Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length>=2 &&
           f.geometry.coordinates.every(c=>Array.isArray(c)&&c.length===2&&isFinite(c[0])&&isFinite(c[1]));
  }
  function safe(fn){ try { return fn(); } catch { return null; } }
  function intersectSafe(a,b){ return safe(()=> turf.intersect(a,b)) || null; }

  // keep the longest piece that’s inside poly
  function clipLineInside(line, poly){
    const parts = safe(()=>turf.lineSplit(line, poly));
    if (!parts?.features?.length) return null;
    const inside = parts.features.filter(seg=>{
      const mid = turf.along(seg, turf.length(seg,{units:'kilometers'})/2, {units:'kilometers'});
      return turf.booleanPointInPolygon(mid, poly);
    });
    if (!inside.length) return null;
    let best=inside[0], bestLen=turf.length(best);
    for (let i=1;i<inside.length;i++){
      const L=turf.length(inside[i]);
      if (L>bestLen){ best=inside[i]; bestLen=L; }
    }
    return best;
  }

  // Build a rectangle polygon from a line (square ends)
  function lineToRect(line, widthM){
    const left  = turf.lineOffset(line,  +widthM/2, meters);
    const right = turf.lineOffset(line,  -widthM/2, meters);
    const ring = [
      ...left.geometry.coordinates,
      ...right.geometry.coordinates.slice().reverse(),
      left.geometry.coordinates[0]
    ];
    return turf.polygon([ring]);
  }
}
