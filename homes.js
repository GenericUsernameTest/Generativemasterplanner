// homes.js — robust roads + homes (uses global `turf` from CDN)

export function generateMasterplan(siteBoundary, opts) {
  const {
    rotationDeg,
    homeW,
    homeD,
    frontSetback,
    sideGap,
    roadW,
    lotsPerBlock
  } = opts;

  // normalize params
  const W  = Math.max(1, +homeW || 9);
  const D  = Math.max(1, +homeD || 12);
  const FS = Math.max(0, +frontSetback || 5);
  const SG = Math.max(0, +sideGap || 2);
  const RW = Math.max(2, +roadW || 10);
  const LPB= Math.max(1, +lotsPerBlock || 5);

  // meters->degrees (rough) at site latitude
  const lat = turf.center(siteBoundary).geometry.coordinates[1];
  const m2lat = 1 / 110540;
  const m2lon = 1 / (111320 * Math.cos(lat * Math.PI / 180));

  // 1) ROAD GRID (centerlines)
  const pivot = turf.center(siteBoundary).geometry.coordinates;
  const rotatedSite = turf.transformRotate(siteBoundary, -rotationDeg, { pivot });
  const [minX, minY, maxX, maxY] = turf.bbox(rotatedSite);

  const moduleDepthM = RW + 2 * (D + FS);   // two-deep rows per road
  const blockLenM    = LPB * (W + SG);      // cross-street spacing

  const centerlines = [];
  for (let y = minY; y <= maxY; y += moduleDepthM * m2lat) {
    centerlines.push(turf.transformRotate(turf.lineString([[minX, y], [maxX, y]]), rotationDeg, { pivot }));
  }
  for (let x = minX; x <= maxX; x += blockLenM * m2lon) {
    centerlines.push(turf.transformRotate(turf.lineString([[x, minY], [x, maxY]]), rotationDeg, { pivot }));
  }

  // 2) ROAD POLYGONS (buffer & clip)
  let roadPoly = null;
  centerlines.forEach(l => {
    const buf = turf.buffer(l, RW / 2, { units: 'meters' });
    roadPoly = roadPoly ? turf.union(roadPoly, buf) : buf;
  });
  if (!roadPoly) return { roads: fc([]), homes: fc([]) };
  roadPoly = turf.intersect(roadPoly, siteBoundary) || roadPoly;
  const roadsFC = fc(turf.flatten(roadPoly).features);

  // 3) BUILDABLE AREA (site - roads)
  const blocks = turf.difference(siteBoundary, roadPoly);
  if (!blocks) return { roads: roadsFC, homes: fc([]) };

  // 4) PLACE HOMES along offsets of centerlines
  const homes = [];
  const offsetDist = (RW / 2) + FS + (D / 2);   // center of home
  const step = W + SG;

  centerlines.forEach(cl => {
    const left  = safeLineOffset(cl,  offsetDist);
    const right = safeLineOffset(cl, -offsetDist);

    [left, right].forEach(bl => {
      if (!bl) return;

      const L = turf.length(bl, { units: 'meters' });
      if (L < W) return;

      let t = 0;
      while (t + W <= L + 1e-6) {
        const p1 = turf.along(bl, Math.max(0, t + W/2 - 0.02), { units: 'meters' }).geometry.coordinates;
        const p2 = turf.along(bl, Math.min(L, t + W/2 + 0.02), { units: 'meters' }).geometry.coordinates;
        const bearing = turf.bearing(p1, p2);
        const mid = turf.along(bl, t + W/2, { units: 'meters' }).geometry.coordinates;

        const rect = orientedRect(mid, bearing, W, D);

        // tolerant acceptance: centroid inside buildable; not intersecting roads
        const c = turf.centroid(rect);
        const insideBuildable = turf.booleanPointInPolygon(c, blocks);
        const hitsRoad = turf.booleanIntersects(rect, roadPoly);

        if (insideBuildable && !hitsRoad) homes.push(rect);

        t += step;
      }
    });
  });

  return { roads: roadsFC, homes: fc(homes) };

  // helpers
  function fc(arr) { return turf.featureCollection(arr); }

  function safeLineOffset(line, distM) {
    try {
      const off = turf.lineOffset(line, distM, { units: 'meters' });
      if (!off) return null;
      if (off.geometry.type === 'MultiLineString') {
        // choose longest piece to march along
        let best = null, bestLen = 0;
        off.geometry.coordinates.forEach(coords => {
          const ls = turf.lineString(coords);
          const len = turf.length(ls, { units: 'meters' });
          if (len > bestLen) { bestLen = len; best = ls; }
        });
        return best;
      }
      return off;
    } catch {
      // fallback: approximate by translating segment endpoints
      const coords = line.geometry.coordinates;
      if (!coords || coords.length < 2) return null;
      const out = [];
      for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i], b = coords[i+1];
        const bearing = turf.bearing(a, b);
        const normal = bearing + (distM >= 0 ? 90 : -90);
        const ta = turf.transformTranslate(turf.point(a), Math.abs(distM), normal, { units: 'meters' }).geometry.coordinates;
        const tb = turf.transformTranslate(turf.point(b), Math.abs(distM), normal, { units: 'meters' }).geometry.coordinates;
        if (i === 0) out.push(ta);
        out.push(tb);
      }
      return turf.lineString(out);
    }
  }

  function orientedRect(center, bearingDeg, w, d) {
    const halfW = w / 2, halfD = d / 2;
    const local = [
      [-halfW, -halfD], [ halfW, -halfD],
      [ halfW,  halfD], [-halfW,  halfD],
      [-halfW, -halfD]
    ];
    const rad = bearingDeg * Math.PI / 180;
    const pts = local.map(([x, y]) => {
      const xr = x * Math.cos(rad) - y * Math.sin(rad);
      const yr = x * Math.sin(rad) + y * Math.cos(rad);
      return turf.destination(
        center,
        Math.hypot(xr, yr),
        Math.atan2(xr, yr) * 180 / Math.PI,
        { units: 'meters' }
      ).geometry.coordinates;
    });
    return turf.polygon([pts]);
  }
}

export function getLongestEdgeAngle(polygon) {
  let maxLen = 0, bestBearing = 0;
  const line = turf.polygonToLine(polygon);
  const rings = (line.geometry.type === 'LineString') ? [line.geometry.coordinates] : line.geometry.coordinates;
  rings.forEach(coords => {
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      const len = turf.distance(a, b, { units: 'meters' });
      if (len > maxLen) { maxLen = len; bestBearing = turf.bearing(a, b); }
    }
  });
  return bestBearing;
}
