// createroads.js — organic roads from a user‑picked entrance
// Exported API:
//   createRoads(siteBoundary: Feature<Polygon|MultiPolygon>,
//               entranceLine: Feature<LineString>,
//               opts?: { mainRoadWidth, localRoadWidth, spurEvery, spurLength, spurJitter, bendFactor, culdesacRadius, alternateSides })

export function createRoads(siteBoundary, entranceLine, opts = {}) {
  // --------- options (meters) with clamps ---------
  const mainRoadWidth  = clamp(num(opts.mainRoadWidth, 8),  4, 18);
  const localRoadWidth = clamp(num(opts.localRoadWidth, 5),  3, 12);
  const spurEvery      = clamp(num(opts.spurEvery, 100),    30, 300);
  const spurLength     = clamp(num(opts.spurLength, 120),   40, 300);
  const spurJitter     = clamp(num(opts.spurJitter, 20),     0, 60);
  const bendFactor     = clamp(num(opts.bendFactor, 0.35),   0, 0.9);
  const culdesacRadius = clamp(num(opts.culdesacRadius, 12), 6, 24);
  const alternateSides = opts.alternateSides ?? true;

  // ---------- safety guards ----------
  if (!isPoly(siteBoundary)) return fc([]);
  if (!isLine(entranceLine)) return fc([]);

  // 1) Smooth the entrance and clip inside site
  const rawMain = tryBezier(entranceLine, 0.25);
  const mainInside = clipLineInside(rawMain, siteBoundary) || rawMain;

  // If the line is degenerate, bail gracefully
  if (!isLine(mainInside) || mainInside.geometry.coordinates.length < 2) {
    return fc([]);
  }

  // Buffer main to polygon and clip
  const mainPoly = safeInterPoly(
    turf.buffer(mainInside, mainRoadWidth / 2, { units: 'meters' }),
    siteBoundary
  );

  const roads = [];
  if (mainPoly) roads.push(mainPoly);

  // 2) Generate spurs along the main line
  const mainLenM = turf.length(mainInside, { units: 'meters' });
  // place from a bit in from the end, to a bit before the other end
  const startAt = Math.max(20, spurEvery * 0.4);
  const endAt   = Math.max(0, mainLenM - Math.max(20, spurEvery * 0.4));

  if (mainLenM > 5 && endAt > startAt) {
    let s = startAt;
    let leftSide = true;

    while (s < endAt) {
      const base = turf.along(mainInside, s / 1000, { units: 'kilometers' });
      const tBear = tangentBearing(mainInside, s);
      if (Number.isFinite(tBear)) {
        const norm = (leftSide ? tBear + 90 : tBear - 90);

        // jitter and gentle skew
        const L     = clamp(spurLength + rand(-spurJitter, spurJitter), 10, 2000);
        const skew  = rand(-10, 10) * bendFactor;
        const ctrlD = L * (0.45 + 0.2 * bendFactor);

        const p0 = coord(base);
        const p1 = coord(turf.destination(base, ctrlD, norm + skew, { units: 'meters' }));
        const p2 = coord(turf.destination(base, L,     norm,         { units: 'meters' }));

        if (goodCoord(p0) && goodCoord(p1) && goodCoord(p2)) {
          const spurRough = turf.lineString([p0, p1, p2]);
          const spurLine  = tryBezier(spurRough, 0.4);

          // buffer spur and clip to site
          const spurPoly = safeInterPoly(
            turf.buffer(spurLine, localRoadWidth / 2, { units: 'meters' }),
            siteBoundary
          );
          if (spurPoly) roads.push(spurPoly);

          // cul‑de‑sac bulb at end
          const bulb = safeInterPoly(
            turf.circle(turf.point(p2), culdesacRadius, { steps: 32, units: 'meters' }),
            siteBoundary
          );
          if (bulb) roads.push(bulb);
        }
      }
      s += spurEvery;
      if (alternateSides) leftSide = !leftSide;
    }
  }

  // 3) Cul‑de‑sacs at each end of the main
  const mCoords = mainInside.geometry.coordinates;
  const first = mCoords[0];
  const last  = mCoords[mCoords.length - 1];
  if (goodCoord(first)) {
    const bulbA = safeInterPoly(turf.circle(turf.point(first), culdesacRadius, { steps: 32, units: 'meters' }), siteBoundary);
    if (bulbA) roads.push(bulbA);
  }
  if (goodCoord(last)) {
    const bulbB = safeInterPoly(turf.circle(turf.point(last),  culdesacRadius, { steps: 32, units: 'meters' }), siteBoundary);
    if (bulbB) roads.push(bulbB);
  }

  // 4) Return as a FeatureCollection of polygons (skip union for robustness)
  return fc(roads);

  // ================= helpers =================
  function num(v, d){ return Number.isFinite(+v) ? +v : d; }
  function clamp(n,a,b){ return Math.min(Math.max(n,a),b); }
  function rand(a,b){ return a + Math.random()*(b-a); }
  function fc(features){ return { type:'FeatureCollection', features: features || [] }; }

  function isPoly(f){
    return f && f.type === 'Feature' && f.geometry &&
      (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
  }
  function isLine(f){
    return f && f.type === 'Feature' && f.geometry &&
      f.geometry.type === 'LineString' &&
      Array.isArray(f.geometry.coordinates) &&
      f.geometry.coordinates.length >= 2;
  }
  function coord(ptOrFeat){
    if (!ptOrFeat) return null;
    if (Array.isArray(ptOrFeat)) return ptOrFeat;
    if (ptOrFeat.type === 'Feature' && ptOrFeat.geometry?.type === 'Point') {
      return ptOrFeat.geometry.coordinates;
    }
    if (ptOrFeat.type === 'Point') return ptOrFeat.coordinates;
    return null;
  }
  function goodCoord(c){
    return Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]);
  }

  function tryBezier(line, sharpness=0.25){
    try {
      return turf.bezierSpline(line, { sharpness, resolution: 10000 });
    } catch { return line; }
  }

  // estimate bearing at s meters along line using a small delta
  function tangentBearing(line, sMeters){
    const total = turf.length(line, { units: 'meters' });
    if (!Number.isFinite(total) || total <= 0) return NaN;
    const d = Math.min(2, Math.max(0.5, total * 0.01)); // small sample segment (m)
    const s0 = clamp(sMeters - d/2, 0, total);
    const s1 = clamp(sMeters + d/2, 0, total);
    const p0 = turf.along(line, s0 / 1000, { units:'kilometers' });
    const p1 = turf.along(line, s1 / 1000, { units:'kilometers' });
    const b  = turf.bearing(p0, p1);
    return Number.isFinite(b) ? b : NaN;
  }

  // Clip a line to the interior of a polygon; returns the longest inside piece
  function clipLineInside(line, poly){
    try {
      const splitted = turf.lineSplit(line, poly);
      if (!splitted?.features?.length) {
        // If line starts outside and ends inside (or vice‑versa), try intersecting
        const clipped = turf.lineIntersect(line, poly);
        if (!clipped || !clipped.features?.length) return null;
        // fallback: keep original
        return line;
      }
      // keep segments whose midpoint is inside
      const inside = splitted.features.filter(seg => {
        const mid = turf.along(seg, turf.length(seg, { units:'kilometers' })/2, { units:'kilometers' });
        return turf.booleanPointInPolygon(mid, poly);
      });
      if (!inside.length) return null;
      // choose the longest
      let best = inside[0], bestLen = turf.length(best);
      for (let i=1;i<inside.length;i++){
        const L = turf.length(inside[i]);
        if (L > bestLen){ best = inside[i]; bestLen = L; }
      }
      return best;
    } catch { return null; }
  }

  function safeInterPoly(a, b){
    try {
      const inter = turf.intersect(a, b);
      return inter || null;
    } catch { return null; }
  }
}
