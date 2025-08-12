// createroads.js — organic roads from a user‑picked entrance
// Named export: createroads(siteBoundary: Feature<Polygon|MultiPolygon>, entranceLine: Feature<LineString>, options?)

export function createroads(siteBoundary, entranceLine, opts = {}) {
  // ------- Options (meters) -------
  const mainRoadWidth   = (opts.mainRoadWidth  != null) ? clamp(opts.mainRoadWidth,   6, 14)  : 8;   // primary
  const localRoadWidth  = (opts.localRoadWidth != null) ? clamp(opts.localRoadWidth,  4, 10)  : 5;   // spurs
  const spurEvery       = (opts.spurEvery      != null) ? clamp(opts.spurEvery,      60, 220) : 120; // spacing along main
  const spurLenBase     = (opts.spurLength     != null) ? clamp(opts.spurLength,     40, 220) : 120; // base spur length
  const spurJitter      = (opts.spurJitter     != null) ? clamp(opts.spurJitter,      0, 40)  : 15;  // randomness (m)
  const bendFactor      = (opts.bendFactor     != null) ? clamp(opts.bendFactor,      0, 0.9) : 0.35;// 0 straight … 0.9 curvy
  const culdesacRadius  = (opts.culdesacRadius != null) ? clamp(opts.culdesacRadius,  6, 20)  : 12;  // bulb radius
  const alternateSides  = (opts.alternateSides != null) ? !!opts.alternateSides : true;

  // Helpers used in this module
  const fc  = (features) => ({ type: 'FeatureCollection', features: features.filter(Boolean) });
  const rnd = (a, b) => a + Math.random() * (b - a);
  function clamp(n, a, b) { return Math.min(Math.max(n, a), b); }
  function isCoordValid(c) {
    return Array.isArray(c) && c.length >= 2 &&
           Number.isFinite(c[0]) && Number.isFinite(c[1]);
  }

  // Safety guards
  if (!siteBoundary || !entranceLine) return fc([]);

  // Ensure entranceLine has at least two valid coordinates
  const inCoords = entranceLine?.geometry?.coordinates || [];
  const validCoords = inCoords.filter(isCoordValid);
  if (validCoords.length < 2) return fc([]);

  const safeEntrance = turf.lineString(validCoords);

  // ---- 1) Smooth the entrance as our MAIN road ----
  let mainLine = tryBezier(safeEntrance, 0.2);

  // Clip the visible main line inside the site to avoid huge buffers poking out
  const mainInside = safeIntersectLineWithPoly(mainLine, siteBoundary) || mainLine;

  // Buffer to polygon (width is *full* width; buffer takes radius, so width/2)
  const mainPoly = safeIntersectPoly(
    turf.buffer(mainInside, mainRoadWidth / 2, { units: 'meters' }),
    siteBoundary
  );

  const roadPolys = [];
  if (mainPoly) roadPolys.push(mainPoly);

  // ---- 2) Place curved SPURS along the main road ----
  const mainLenM = turf.length(mainLine, { units: 'meters' }); // meters
  if (mainLenM > 10) {
    // Start placing after a small offset so spurs don't crowd the edge
    let placeAt = Math.max(40, spurEvery * 0.5); // meters
    let leftSide = true; // for alternation

    while (placeAt < mainLenM - 40) {
      const basePoint   = turf.along(mainLine, placeAt / 1000, { units: 'kilometers' });
      const bearingHere = tangentBearing(mainLine, placeAt);
      if (Number.isFinite(bearingHere)) {
        // normal bearings
        const normal = leftSide ? bearingHere + 90 : bearingHere - 90;

        // jittered length & slight skew angle
        let thisLen = spurLenBase + rnd(-spurJitter, spurJitter);
        thisLen = Math.max(5, thisLen); // keep reasonable

        const skew     = rnd(-10, 10) * bendFactor; // degrees
        const ctrlDist = thisLen * (0.45 + 0.2 * bendFactor); // where control point sits
        const endDist  = thisLen;

        const p0 = basePoint.geometry.coordinates;
        const p1 = turf.destination(basePoint, ctrlDist, normal + skew, { units: 'meters' }).geometry.coordinates;
        const p2 = turf.destination(basePoint, endDist,  normal,        { units: 'meters' }).geometry.coordinates;

        if (isCoordValid(p0) && isCoordValid(p1) && isCoordValid(p2)) {
          const spurRough = turf.lineString([p0, p1, p2]);
          const spurCurvy = tryBezier(spurRough, 0.4);

          // Buffer to road polygon and clip to site
          const spurPoly = safeIntersectPoly(
            turf.buffer(spurCurvy, localRoadWidth / 2, { units: 'meters' }),
            siteBoundary
          );
          if (spurPoly) {
            roadPolys.push(spurPoly);

            // Cul‑de‑sac at spur end (little bulb) — guard against bad coords
            try {
              const bulb = safeIntersectPoly(
                turf.circle(p2, culdesacRadius, { steps: 32, units: 'meters' }),
                siteBoundary
              );
              if (bulb) roadPolys.push(bulb);
            } catch { /* skip bad bulb */ }
          }
        }
      }

      // Next placement
      placeAt += spurEvery + rnd(-spurEvery * 0.25, spurEvery * 0.25);
      if (alternateSides) leftSide = !leftSide;
    }
  }

  // ---- 3) Cul‑de‑sacs on the MAIN line ends (optional) ----
  const first = mainLine.geometry.coordinates[0];
  const last  = mainLine.geometry.coordinates[mainLine.geometry.coordinates.length - 1];

  if (isCoordValid(first)) {
    try {
      const bulbA = safeIntersectPoly(
        turf.circle(first, culdesacRadius, { steps: 32, units: 'meters' }),
        siteBoundary
      );
      if (bulbA) roadPolys.push(bulbA);
    } catch { /* ignore */ }
  }
  if (isCoordValid(last)) {
    try {
      const bulbB = safeIntersectPoly(
        turf.circle(last, culdesacRadius, { steps: 32, units: 'meters' }),
        siteBoundary
      );
      if (bulbB) roadPolys.push(bulbB);
    } catch { /* ignore */ }
  }

  // ---- 4) Union all pieces into a single roads polygon (or a few) ----
  const unioned = unionMany(roadPolys);
  if (!unioned) return fc([]);

  // Ensure FeatureCollection of polygons (Mapbox fill layer‑friendly)
  return fc(splitMulti(unioned));

  // ================= helpers =================

  function tryBezier(line, sharpness = 0.2) {
    try {
      // turf.bezierSpline uses resolution/sharpness; keep resolution modest to stay light
      return turf.bezierSpline(line, { sharpness, resolution: 10000 });
    } catch {
      return line;
    }
  }

  // Bearing at distance s along a line by sampling a tiny delta segment (meters)
  function tangentBearing(line, sMeters) {
    const totalM = turf.length(line, { units: 'meters' });
    if (!Number.isFinite(totalM) || totalM <= 0) return 0;
    const s0 = Math.max(0, sMeters - 0.5);
    const s1 = Math.min(totalM, sMeters + 0.5);
    const p0 = turf.along(line, s0 / 1000, { units: 'kilometers' });
    const p1 = turf.along(line, s1 / 1000, { units: 'kilometers' });
    return turf.bearing(p0, p1);
  }

  // Safely intersect polygon with site polygon/multipolygon
  function safeIntersectPoly(polyA, polyB) {
    try {
      const inter = turf.intersect(polyA, polyB);
      return inter || null;
    } catch { return null; }
  }

  // Clip a line inside a polygon (returns the portion inside or null)
  function safeIntersectLineWithPoly(line, poly) {
    try {
      // Split line by polygon boundary; then keep segments whose midpoints lie inside
      const split = turf.lineSplit(line, poly);
      if (!split || !split.features?.length) return null;

      const insideSegs = split.features.filter(seg => {
        const segLenKm = turf.length(seg, { units: 'kilometers' });
        if (!Number.isFinite(segLenKm) || segLenKm <= 0) return false;
        const mid = turf.along(seg, segLenKm / 2, { units: 'kilometers' });
        return turf.booleanPointInPolygon(mid, poly);
      });
      if (!insideSegs.length) return null;

      // Stitch back to a single LineString
      const coords = [insideSegs[0].geometry.coordinates[0]];
      insideSegs.forEach(seg => {
        const cs = seg.geometry.coordinates;
        for (let i = 1; i < cs.length; i++) coords.push(cs[i]);
      });
      return turf.lineString(coords);
    } catch {
      return null;
    }
  }

  // Union array of polygons robustly
  function unionMany(polys) {
    const clean = polys.filter(Boolean);
    if (!clean.length) return null;

    let out = clean[0];
    for (let i = 1; i < clean.length; i++) {
      try {
        out = turf.union(out, clean[i]) || out;
      } catch {
        // if union fails on a piece, keep both by merging later
        out = turf.featureCollection(splitMulti(out).concat(splitMulti(clean[i])));
        out = dissolveFC(out);
      }
    }
    return out;
  }

  // Dissolve a FeatureCollection of polygons into as few polygons as possible
  function dissolveFC(fcIn) {
    const feats = fcIn?.features || [];
    if (!feats.length) return null;
    let acc = feats[0];
    for (let i = 1; i < feats.length; i++) {
      try { acc = turf.union(acc, feats[i]) || acc; } catch { /* ignore */ }
    }
    return acc;
  }

  // Split MultiPolygon to an array of Polygon features; pass through Polygon
  function splitMulti(feat) {
    if (!feat) return [];
    const g = feat.geometry;
    if (!g) return [];
    if (g.type === 'Polygon') return [feat];
    if (g.type === 'MultiPolygon') {
      return g.coordinates.map(coords => turf.polygon(coords));
    }
    // if FC slipped through
    if (feat.type === 'FeatureCollection') return feat.features;
    return [];
  }
}
