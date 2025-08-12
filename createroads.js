// createroads.js — organic-ish roads from a user-picked entrance
// Exports: createRoads(siteBoundary: Feature<Polygon|MultiPolygon>, entranceLine: Feature<LineString>, opts?)

export function createroads(siteBoundary, entranceLine, opts = {}) {
  // ---------- helpers ----------
  const fc  = (features) => ({ type: "FeatureCollection", features });
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const getOpt = (v, def, min, max) => (isNum(v) ? clamp(v, min, max) : def);

  // ---------- options (all meters / unitless) ----------
  const mainRoadWidth  = getOpt(opts.mainRoadWidth,   8,  4, 20);
  const localRoadWidth = getOpt(opts.localRoadWidth,  5,  3, 12);
  const spurEvery      = getOpt(opts.spurEvery,     120, 40, 300);
  const spurLen        = getOpt(opts.spurLength,    120, 30, 400);
  const spurJitter     = getOpt(opts.spurJitter,     15,  0,  60);
  const bendFactor     = getOpt(opts.bendFactor,    0.35, 0, 0.95);
  const culdesacRadius = getOpt(opts.culdesacRadius, 12,  4,  30);
  const alternateSides = opts.alternateSides ?? true;

  // ---------- safety guards ----------
  if (!siteBoundary || !siteBoundary.geometry) return fc([]);
  if (!entranceLine || !entranceLine.geometry || entranceLine.geometry.type !== "LineString") {
    // No valid entrance; return empty and let caller fall back
    return fc([]);
  }
  // ensure entrance coords are numeric
  const coords = entranceLine.geometry.coordinates || [];
  if (coords.length < 2 || !coords.every(c => Array.isArray(c) && isNum(c[0]) && isNum(c[1]))) {
    return fc([]);
  }

  // ---------- 1) Smooth MAIN road ----------
  const mainRaw = turf.lineString(coords);
  const mainLine = tryBezier(mainRaw, 0.2);

  // Buffer to polygon and clip to site (clipping here is enough; we don't need to clip the line first)
  const mainPoly = safeIntersectPoly(
    turf.buffer(mainLine, mainRoadWidth / 2, { units: "meters" }),
    siteBoundary
  );

  const roadPolys = [];
  if (mainPoly) roadPolys.push(mainPoly);

  // ---------- 2) Curved SPURS along the main ----------
  const mainLen = turf.length(mainLine, { units: "meters" });
  if (mainLen > 10) {
    let placeAt = Math.max(40, spurEvery * 0.5);
    let leftSide = true;

    while (placeAt < mainLen - 40) {
      const basePoint   = turf.along(mainLine, placeAt / 1000, { units: "kilometers" });
      const bearingHere = tangentBearing(mainLine, placeAt);

      if (isNum(bearingHere)) {
        const normal = leftSide ? bearingHere + 90 : bearingHere - 90;

        const thisLen   = spurLen + rnd(-spurJitter, spurJitter);
        const skew      = rnd(-10, 10) * bendFactor; // degrees
        const ctrlDist  = thisLen * (0.45 + 0.2 * bendFactor);

        const p0 = basePoint.geometry.coordinates;
        const p1 = turf.destination(basePoint, ctrlDist, normal + skew, { units: "meters" }).geometry.coordinates;
        const p2 = turf.destination(basePoint, thisLen,  normal,        { units: "meters" }).geometry.coordinates;

        const spurRough = turf.lineString([p0, p1, p2]);
        const spurCurvy = tryBezier(spurRough, 0.4);

        const spurPoly = safeIntersectPoly(
          turf.buffer(spurCurvy, localRoadWidth / 2, { units: "meters" }),
          siteBoundary
        );
        if (spurPoly) {
          roadPolys.push(spurPoly);

          // Cul-de-sac bulb at end
          const bulb = safeIntersectPoly(
            turf.circle(p2, culdesacRadius, { steps: 32, units: "meters" }),
            siteBoundary
          );
          if (bulb) roadPolys.push(bulb);
        }
      }

      placeAt += spurEvery + rnd(-spurEvery * 0.25, spurEvery * 0.25);
      if (alternateSides) leftSide = !leftSide;
    }
  }

  // ---------- 3) Optional bulbs at main ends ----------
  const first = mainLine.geometry.coordinates[0];
  const last  = mainLine.geometry.coordinates[mainLine.geometry.coordinates.length - 1];
  const bulbA = safeIntersectPoly(turf.circle(first, culdesacRadius, { steps: 32, units: "meters" }), siteBoundary);
  const bulbB = safeIntersectPoly(turf.circle(last,  culdesacRadius, { steps: 32, units: "meters" }), siteBoundary);
  if (bulbA) roadPolys.push(bulbA);
  if (bulbB) roadPolys.push(bulbB);

  // ---------- 4) Union to a clean set of polygons ----------
  const unioned = unionMany(roadPolys);
  if (!unioned) return fc([]);

  return fc(splitMulti(unioned));

  // ======== helper fns ========
  function tryBezier(line, sharpness = 0.2) {
    try {
      return turf.bezierSpline(line, { sharpness, resolution: 10000 });
    } catch {
      return line;
    }
  }

  // approximate tangent bearing by sampling a very short segment around distance s (meters)
  function tangentBearing(line, sMeters) {
    const total = turf.length(line, { units: "meters" });
    const s0 = Math.max(0, sMeters - 0.5);
    const s1 = Math.min(total, sMeters + 0.5);
    const p0 = turf.along(line, s0 / 1000, { units: "kilometers" });
    const p1 = turf.along(line, s1 / 1000, { units: "kilometers" });
    return turf.bearing(p0, p1);
  }

  function safeIntersectPoly(polyA, polyB) {
    try {
      const inter = turf.intersect(polyA, polyB);
      return inter || null;
    } catch {
      return null;
    }
  }

  function unionMany(polys) {
    if (!polys.length) return null;
    let out = polys[0];
    for (let i = 1; i < polys.length; i++) {
      try {
        const u = turf.union(out, polys[i]);
        if (u) out = u;
      } catch {
        // fall back to dissolve FC if a pairwise union explodes
        const fcTemp = turf.featureCollection(splitMulti(out).concat(splitMulti(polys[i])));
        out = dissolveFC(fcTemp) || out;
      }
    }
    return out;
  }

  function dissolveFC(fcIn) {
    const feats = fcIn.features || [];
    if (!feats.length) return null;
    let acc = feats[0];
    for (let i = 1; i < feats.length; i++) {
      try {
        const u = turf.union(acc, feats[i]);
        if (u) acc = u;
      } catch { /* ignore */ }
    }
    return acc;
  }

  function splitMulti(feat) {
    if (!feat) return [];
    const g = feat.geometry;
    if (!g) return [];
    if (g.type === "Polygon") return [feat];
    if (g.type === "MultiPolygon") {
      return g.coordinates.map(coords => turf.polygon(coords));
    }
    if (feat.type === "FeatureCollection") return feat.features;
    return [];
  }
}

// Also export as default so `import createRoads from './createroads.js'` works too.
export default createRoads;
