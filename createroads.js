// createroads.js — organic roads from a user‑picked entrance
// Export:
//   createRoads(siteBoundary: Feature<Polygon|MultiPolygon>,
//               entranceLine: Feature<LineString>,
//               opts?: { mainRoadWidth, localRoadWidth, spurEvery, spurLength,
//                       spurJitter, bendFactor, culdesacRadius, alternateSides })

export function createRoads(siteBoundary, entranceLine, opts = {}) {
  // --------- options (meters) tuned for visible spurs ----------
  const mainRoadWidth  = clamp(num(opts.mainRoadWidth, 8),  4, 18);
  const localRoadWidth = clamp(num(opts.localRoadWidth, 5),  3, 12);

  // Defaults push toward organic + frequent branches
  const defSpurEvery   = 70;   // target spacing
  const defSpurLen     = 100;  // typical spur length
  const spurEvery      = clamp(num(opts.spurEvery,  defSpurEvery), 40, 220);
  const spurLength     = clamp(num(opts.spurLength, defSpurLen),   60, 220);
  const spurJitter     = clamp(num(opts.spurJitter, 18),            0, 60);
  const bendFactor     = clamp(num(opts.bendFactor, 0.5),           0, 0.9);
  const culdesacRadius = clamp(num(opts.culdesacRadius, 12),        6, 24);
  const alternateSides = opts.alternateSides ?? true;

  // ---------- guards ----------
  if (!isPoly(siteBoundary) || !isLine(entranceLine)) return fc([]);

  // 1) Smooth entrance, keep as much as possible *inside* site
  const rawMain = tryBezier(entranceLine, 0.25);
  const mainInside = clipLineMostlyInside(rawMain, siteBoundary) || rawMain;

  if (!isLine(mainInside) || mainInside.geometry.coordinates.length < 2) {
    return fc([]);
  }

  // Buffer main carriageway and clip
  const mainPoly = safeInterPoly(
    turf.buffer(mainInside, mainRoadWidth / 2, { units: 'meters' }),
    siteBoundary
  );

  const roads = [];
  if (mainPoly) roads.push(mainPoly);

  // 2) Spurs along the main — adaptive spacing to guarantee some show up
  const Lm = turf.length(mainInside, { units: 'meters' });

  // keep a little margin so bulbs don’t poke out
  const margin = Math.max(20, Math.min(40, 0.08 * Lm));
  const startAt = margin;
  const endAt   = Math.max(startAt, Lm - margin);

  if (endAt > startAt + 10) {
    // compute a *target* count, enforce a minimum of 4 spurs if the line allows it
    const rawCount = Math.floor((endAt - startAt) / spurEvery);
    const minCount = 4;
    const maxCount = 14; // keep things sane
    const count = clamp(rawCount, Math.min(minCount, Math.floor((endAt-startAt)/40)), maxCount);

    // recompute spacing based on chosen count (>=1 to avoid div by 0)
    const n = Math.max(1, count);
    const spacing = (endAt - startAt) / (n + 1);

    let leftSide = true;
    for (let i = 1; i <= n; i++) {
      const s = startAt + spacing * i;

      const base = turf.along(mainInside, s / 1000, { units: 'kilometers' });
      const tb   = tangentBearing(mainInside, s);
      if (!Number.isFinite(tb)) continue;

      const normal = leftSide ? tb + 90 : tb - 90;

      const L   = clamp(spurLength + rand(-spurJitter, spurJitter), 40, 1000);
      const skew = rand(-10, 10) * bendFactor;
      const ctrlD = L * (0.45 + 0.25 * bendFactor);

      const p0 = toCoord(base);
      const p1 = toCoord(turf.destination(base, ctrlD, normal + skew, { units: 'meters' }));
      const p2 = toCoord(turf.destination(base, L,     normal,        { units: 'meters' }));
      if (!goodCoord(p0) || !goodCoord(p1) || !goodCoord(p2)) continue;

      const spurRough = turf.lineString([p0, p1, p2]);
      const spurCurvy = tryBezier(spurRough, 0.45);

      const spurPoly = safeInterPoly(
        turf.buffer(spurCurvy, localRoadWidth / 2, { units: 'meters' }),
        siteBoundary
      );
      if (spurPoly) roads.push(spurPoly);

      // cul‑de‑sac bulb at end
      const bulb = safeInterPoly(
        turf.circle(turf.point(p2), culdesacRadius, { steps: 32, units: 'meters' }),
        siteBoundary
      );
      if (bulb) roads.push(bulb);

      if (alternateSides) leftSide = !leftSide;
    }
  }

  // 3) Bulbs on main ends (optional nicety)
  const mcoords = mainInside.geometry.coordinates;
  const first = mcoords[0], last = mcoords[mcoords.length - 1];
  if (goodCoord(first)) {
    const bulbA = safeInterPoly(turf.circle(turf.point(first), culdesacRadius, { steps: 32, units: 'meters' }), siteBoundary);
    if (bulbA) roads.push(bulbA);
  }
  if (goodCoord(last)) {
    const bulbB = safeInterPoly(turf.circle(turf.point(last),  culdesacRadius, { steps: 32, units: 'meters' }), siteBoundary);
    if (bulbB) roads.push(bulbB);
  }

  // Return all pieces; we skip union for robustness
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
  function toCoord(ptOrFeat){
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

  function tryBezier(line, sharpness=0.35){
    try {
      return turf.bezierSpline(line, { sharpness, resolution: 10000 });
    } catch { return line; }
  }

  // estimate tangent bearing at s meters using a tiny delta segment
  function tangentBearing(line, sMeters){
    const total = turf.length(line, { units: 'meters' });
    if (!Number.isFinite(total) || total <= 0) return NaN;
    const d = Math.min(3, Math.max(0.6, total * 0.008)); // sample window (m)
    const s0 = clamp(sMeters - d/2, 0, total);
    const s1 = clamp(sMeters + d/2, 0, total);
    const p0 = turf.along(line, s0 / 1000, { units:'kilometers' });
    const p1 = turf.along(line, s1 / 1000, { units:'kilometers' });
    const b  = turf.bearing(p0, p1);
    return Number.isFinite(b) ? b : NaN;
  }

  // Clip line *mostly* inside polygon; if fully outside, try intersect; else return original
  function clipLineMostlyInside(line, poly){
    try {
      const split = turf.lineSplit(line, poly);
      if (split?.features?.length) {
        // keep segments whose midpoint lies inside, then pick the longest
        const inside = split.features.filter(seg => {
          const mid = turf.along(seg, turf.length(seg, { units:'kilometers' })/2, { units:'kilometers' });
          return turf.booleanPointInPolygon(mid, poly);
        });
        if (inside.length) {
          let best = inside[0], bestLen = turf.length(best, { units: 'meters' });
          for (let i=1;i<inside.length;i++){
            const L = turf.length(inside[i], { units: 'meters' });
            if (L > bestLen){ best = inside[i]; bestLen = L; }
          }
          return best;
        }
      }
      // fallback: if it intersects at all, keep the original so spurs still draw
      const inter = turf.lineIntersect(line, poly);
      if (inter?.features?.length) return line;
      return null;
    } catch { return null; }
  }

  function safeInterPoly(a, b){
    try {
      const inter = turf.intersect(a, b);
      return inter || null;
    } catch { return null; }
  }
}
