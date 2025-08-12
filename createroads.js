// createroads.js — organic roads from a user-picked entrance
// Export: createroads(siteBoundary: Feature<Polygon|MultiPolygon>, entranceLine: Feature<LineString>, options?)

export function createroads(siteBoundary, entranceLine, opts = {}) {
  // ------- Options (meters) -------
  const mainRoadWidth   = clamp(opts.mainRoadWidth,   6, 14)   ?? 8;
  const localRoadWidth  = clamp(opts.localRoadWidth,  4, 10)   ?? 5;
  const spurEvery       = clamp(opts.spurEvery,       60, 220) ?? 120;
  const spurLen         = clamp(opts.spurLength,      40, 220) ?? 120;
  const spurJitter      = clamp(opts.spurJitter,       0, 40)  ?? 15;
  const bendFactor      = clamp(opts.bendFactor,       0, 0.9) ?? 0.35;
  const culdesacRadius  = clamp(opts.culdesacRadius,   6, 20)  ?? 12;
  const alternateSides  = opts.alternateSides ?? true;

  // --- tiny utils ---
  const fc  = (features) => ({ type: 'FeatureCollection', features });
  const rnd = (a, b) => a + Math.random() * (b - a);
  function clamp(n, a, b){ return Math.min(Math.max(n, a), b); }
  function isNum(n){ return Number.isFinite(n); }
  function validCoord(c){ return Array.isArray(c) && c.length >= 2 && isNum(c[0]) && isNum(c[1]); }
  function validCoords(arr){ return Array.isArray(arr) && arr.length >= 2 && arr.every(validCoord); }

  function safeCircle(centerCoord, radiusM){
    // Accept Point feature or raw coord
    const coord = Array.isArray(centerCoord)
      ? centerCoord
      : (centerCoord?.geometry?.coordinates || null);
    if (!validCoord(coord)) return null;
    try { return turf.circle(coord, radiusM, { steps: 32, units: 'meters' }); }
    catch { return null; }
  }

  // --- guard inputs ---
  if (!siteBoundary || !entranceLine) return fc([]);
  if (!validCoords(entranceLine.geometry?.coordinates)) {
    console.warn('createroads: entrance line has invalid coordinates — skipping roads.');
    return fc([]);
  }

  // ---- 1) Smooth the entrance as our MAIN road ----
  const mainLine = tryBezier(entranceLine, 0.2);
  const mainInside = clipLineInsidePoly(mainLine, siteBoundary) || mainLine;

  const mainPoly = safeIntersectPoly(
    turf.buffer(mainInside, mainRoadWidth / 2, { units: 'meters' }),
    siteBoundary
  );

  const roadPolys = [];
  if (mainPoly) roadPolys.push(mainPoly);

  // ---- 2) Place curved SPURS along the main road ----
  const mainLen = turf.length(mainLine, { units: 'meters' });
  if (mainLen > 10) {
    let placeAt = Math.max(40, spurEvery * 0.5);
    let leftSide = true;

    while (placeAt < mainLen - 40) {
      try {
        const basePoint   = turf.along(mainLine, placeAt / 1000, { units: 'kilometers' });
        const bearingHere = tangentBearing(mainLine, placeAt);
        if (!Number.isFinite(bearingHere)) throw new Error('invalid bearing');

        const normal   = leftSide ? bearingHere + 90 : bearingHere - 90;
        const thisLen  = spurLen + rnd(-spurJitter, spurJitter);
        const skew     = rnd(-10, 10) * bendFactor;
        const ctrlDist = thisLen * (0.45 + 0.2 * bendFactor);
        const endDist  = thisLen;

        const p0 = basePoint.geometry.coordinates;
        const p1 = turf.destination(basePoint, ctrlDist, normal + skew, { units: 'meters' }).geometry.coordinates;
        const p2 = turf.destination(basePoint, endDist,  normal,        { units: 'meters' }).geometry.coordinates;

        if (!validCoords([p0, p1, p2])) throw new Error('spur produced invalid coords');

        const spurCurvy = tryBezier(turf.lineString([p0, p1, p2]), 0.4);

        const spurPoly = safeIntersectPoly(
          turf.buffer(spurCurvy, localRoadWidth / 2, { units: 'meters' }),
          siteBoundary
        );
        if (spurPoly) roadPolys.push(spurPoly);

        // Cul‑de‑sac at spur end
        const bulb = safeIntersectPoly(safeCircle(p2, culdesacRadius), siteBoundary);
        if (bulb) roadPolys.push(bulb);
      } catch (err) {
        console.warn('createroads: skipping spur —', err.message);
      }

      placeAt += spurEvery + rnd(-spurEvery * 0.25, spurEvery * 0.25);
      if (alternateSides) leftSide = !leftSide;
    }
  }

  // ---- 3) Cul‑de‑sacs on MAIN line ends ----
  try {
    const coords = mainLine.geometry?.coordinates || [];
    if (validCoords(coords)) {
      const first = coords[0];
      const last  = coords[coords.length - 1];
      const bulbA = safeIntersectPoly(safeCircle(first, culdesacRadius), siteBoundary);
      const bulbB = safeIntersectPoly(safeCircle(last,  culdesacRadius), siteBoundary);
      if (bulbA) roadPolys.push(bulbA);
      if (bulbB) roadPolys.push(bulbB);
    }
  } catch (err) {
    console.warn('createroads: main cul‑de‑sacs skipped —', err.message);
  }

  // ---- 4) Union all pieces ----
  const unioned = unionMany(roadPolys);
  if (!unioned) return fc([]);
  return fc(splitMulti(unioned));

  // ===== helpers =====
  function tryBezier(line, sharpness = 0.2){
    try { return turf.bezierSpline(line, { sharpness, resolution: 10000 }); }
    catch { return line; }
  }

  function tangentBearing(line, sMeters){
    const total = turf.length(line, { units: 'meters' });
    const s0 = Math.max(0, sMeters - 0.5);
    const s1 = Math.min(total, sMeters + 0.5);
    const p0 = turf.along(line, s0 / 1000, { units: 'kilometers' });
    const p1 = turf.along(line, s1 / 1000, { units: 'kilometers' });
    return turf.bearing(p0, p1);
  }

  function clipLineInsidePoly(line, poly){
    // Try to keep only segments whose midpoint falls inside the polygon
    try {
      const pieces = turf.lineSplit(line, turf.polygonToLine(poly));
      if (!pieces?.features?.length) return null;
      const kept = pieces.features.filter(seg => {
        const mid = turf.along(seg, turf.length(seg, { units: 'kilometers' }) / 2, { units: 'kilometers' });
        return turf.booleanPointInPolygon(mid, poly);
      });
      if (!kept.length) return null;
      let coords = [kept[0].geometry.coordinates[0]];
      kept.forEach(seg => {
        const cs = seg.geometry.coordinates;
        for (let i = 1; i < cs.length; i++) coords.push(cs[i]);
      });
      return validCoords(coords) ? turf.lineString(coords) : null;
    } catch { return null; }
  }

  function safeIntersectPoly(a, b){
    try { return (a && b) ? (turf.intersect(a, b) || null) : null; }
    catch { return null; }
  }

  function unionMany(polys){
    if (!polys.length) return null;
    let out = polys[0];
    for (let i = 1; i < polys.length; i++){
      try { out = turf.union(out, polys[i]) || out; }
      catch {
        out = turf.featureCollection(splitMulti(out).concat(splitMulti(polys[i])));
        out = dissolveFC(out);
      }
    }
    return out;
  }

  function dissolveFC(fcIn){
    const feats = fcIn.features || [];
    if (!feats.length) return null;
    let acc = feats[0];
    for (let i = 1; i < feats.length; i++){
      try { acc = turf.union(acc, feats[i]) || acc; } catch {}
    }
    return acc;
  }

  function splitMulti(feat){
    if (!feat) return [];
    const g = feat.geometry;
    if (!g) return [];
    if (g.type === 'Polygon') return [feat];
    if (g.type === 'MultiPolygon') return g.coordinates.map(c => turf.polygon(c));
    if (feat.type === 'FeatureCollection') return feat.features;
    return [];
  }
}
