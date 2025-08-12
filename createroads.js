// createroads.js — organic roads from a user-picked entrance
// Export: createRoads(siteBoundary: Feature<Polygon|MultiPolygon>, entranceLine: Feature<LineString>, options?)

export function createRoads(siteBoundary, entranceLine, opts = {}) {
  // ------- Options (meters) -------
  const mainRoadWidth   = clamp(opts.mainRoadWidth,   6, 14)   ?? 8;  
  const localRoadWidth  = clamp(opts.localRoadWidth,  4, 10)   ?? 5;  
  const spurEvery       = clamp(opts.spurEvery,       60, 220) ?? 120; 
  const spurLen         = clamp(opts.spurLength,      40, 220) ?? 120; 
  const spurJitter      = clamp(opts.spurJitter,       0, 40)  ?? 15;  
  const bendFactor      = clamp(opts.bendFactor,       0, 0.9) ?? 0.35;
  const culdesacRadius  = clamp(opts.culdesacRadius,   6, 20)  ?? 12;  
  const alternateSides  = opts.alternateSides ?? true; 

  const fc  = (features) => ({ type: 'FeatureCollection', features });
  const rnd = (a, b) => a + Math.random() * (b - a);
  function clamp(n, a, b) { return Math.min(Math.max(n, a), b); }
  function validCoords(coords) {
    return Array.isArray(coords) &&
           coords.length >= 2 &&
           coords.every(c => Array.isArray(c) && c.length >= 2 && c.every(n => Number.isFinite(n)));
  }

  // Safety guards
  if (!siteBoundary || !entranceLine) return fc([]);
  if (!validCoords(entranceLine.geometry?.coordinates)) {
    console.warn("Entrance line has invalid coordinates — skipping roads.");
    return fc([]);
  }

  // ---- 1) Smooth the entrance as our MAIN road ----
  let mainLine = tryBezier(entranceLine, 0.2);
  const mainInside = safeIntersectLineWithPoly(mainLine, siteBoundary) || mainLine;

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
        if (!Number.isFinite(bearingHere)) throw new Error("Invalid bearing");

        const normal = leftSide ? bearingHere + 90 : bearingHere - 90;
        const thisLen   = spurLen + rnd(-spurJitter, spurJitter);
        const skew      = rnd(-10, 10) * bendFactor;
        const ctrlDist  = thisLen * (0.45 + 0.2 * bendFactor);
        const endDist   = thisLen;

        const p0 = basePoint.geometry.coordinates;
        const p1 = turf.destination(basePoint, ctrlDist, normal + skew, { units: 'meters' }).geometry.coordinates;
        const p2 = turf.destination(basePoint, endDist,  normal,        { units: 'meters' }).geometry.coordinates;

        if (!validCoords([p0, p1, p2])) throw new Error("Invalid spur coords");

        const spurRough = turf.lineString([p0, p1, p2]);
        const spurCurvy = tryBezier(spurRough, 0.4);

        const spurPoly = safeIntersectPoly(
          turf.buffer(spurCurvy, localRoadWidth / 2, { units: 'meters' }),
          siteBoundary
        );
        if (spurPoly) {
          roadPolys.push(spurPoly);

          const bulb = safeIntersectPoly(
            turf.circle(turf.point(p2), culdesacRadius, { steps: 32, units: 'meters' }),
            siteBoundary
          );
          if (bulb) roadPolys.push(bulb);
        }
      } catch (err) {
        console.warn("Skipping spur:", err.message);
      }

      placeAt += spurEvery + rnd(-spurEvery * 0.25, spurEvery * 0.25);
      if (alternateSides) leftSide = !leftSide;
    }
  }

  // ---- 3) Cul-de-sacs on main line ends ----
  try {
    const coords = mainLine.geometry.coordinates;
    if (validCoords(coords)) {
      const first = turf.point(coords[0]);
      const last  = turf.point(coords[coords.length - 1]);
      const bulbA = safeIntersectPoly(turf.circle(first, culdesacRadius, { steps: 32, units: 'meters' }), siteBoundary);
      const bulbB = safeIntersectPoly(turf.circle(last,  culdesacRadius, { steps: 32, units: 'meters' }), siteBoundary);
      if (bulbA) roadPolys.push(bulbA);
      if (bulbB) roadPolys.push(bulbB);
    }
  } catch (err) {
    console.warn("Skipping main road cul-de-sacs:", err.message);
  }

  // ---- 4) Union all pieces ----
  const unioned = unionMany(roadPolys);
  if (!unioned) return fc([]);
  return fc(splitMulti(unioned));

  // ================= helpers =================
  function tryBezier(line, sharpness = 0.2) {
    try { return turf.bezierSpline(line, { sharpness, resolution: 10000 }); }
    catch { return line; }
  }

  function tangentBearing(line, sMeters) {
    const total = turf.length(line, { units: 'meters' });
    const s0 = Math.max(0, sMeters - 0.5);
    const s1 = Math.min(total, sMeters + 0.5);
    const p0 = turf.along(line, s0 / 1000, { units: 'kilometers' });
    const p1 = turf.along(line, s1 / 1000, { units: 'kilometers' });
    return turf.bearing(p0, p1);
  }

  function safeIntersectPoly(polyA, polyB) {
    try {
      if (!polyA || !polyB) return null;
      const inter = turf.intersect(polyA, polyB);
      return inter || null;
    } catch { return null; }
  }

  function safeIntersectLineWithPoly(line, poly) {
    try {
      const clipped = turf.lineSplit(line, poly);
      if (!clipped?.features?.length) return null;
      const inside = clipped.features.filter(seg => {
        const mid = turf.along(seg, turf.length(seg, { units: 'kilometers' }) / 2, { units: 'kilometers' });
        return turf.booleanPointInPolygon(mid, poly);
      });
      if (!inside.length) return null;
      let coords = [inside[0].geometry.coordinates[0]];
      inside.forEach(seg => {
        const cs = seg.geometry.coordinates;
        for (let i = 1; i < cs.length; i++) coords.push(cs[i]);
      });
      if (!validCoords(coords)) return null;
      return turf.lineString(coords);
    } catch { return null; }
  }

  function unionMany(polys) {
    if (!polys.length) return null;
    let out = polys[0];
    for (let i = 1; i < polys.length; i++) {
      try { out = turf.union(out, polys[i]) || out; }
      catch {
        out = turf.featureCollection(splitMulti(out).concat(splitMulti(polys[i])));
        out = dissolveFC(out);
      }
    }
    return out;
  }

  function dissolveFC(fcIn) {
    const feats = fcIn.features || [];
    if (!feats.length) return null;
    let acc = feats[0];
    for (let i = 1; i < feats.length; i++) {
      try { acc = turf.union(acc, feats[i]) || acc; } catch {}
    }
    return acc;
  }

  function splitMulti(feat) {
    if (!feat) return [];
    const g = feat.geometry;
    if (!g) return [];
    if (g.type === 'Polygon') return [feat];
    if (g.type === 'MultiPolygon') {
      return g.coordinates.map(coords => turf.polygon(coords));
    }
    if (feat.type === 'FeatureCollection') return feat.features;
    return [];
  }
}
