// homes.js – Masterplan generation (roads + homes) using global `turf` (from CDN)

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

  // --- meters->degrees factors approximated at site latitude ---
  const lat = turf.center(siteBoundary).geometry.coordinates[1];
  const m2lat = 1 / 110540; // m per deg latitude
  const m2lon = 1 / (111320 * Math.cos(lat * Math.PI / 180)); // m per deg longitude (approx)

  // --- 1) ROAD GRID ---
  const pivot = turf.center(siteBoundary).geometry.coordinates;
  const rotatedSite = turf.transformRotate(siteBoundary, -rotationDeg, { pivot });
  const [minX, minY, maxX, maxY] = turf.bbox(rotatedSite);

  // Two-deep rows of homes between local roads
  const blockDepthM = roadW + 2 * (homeD + frontSetback); // module depth
  const blockLenM   = Math.max(1, lotsPerBlock) * (homeW + sideGap); // cross-street spacing

  const lines = [];

  // Avenues (parallel to rotation axis)
  for (let y = minY; y <= maxY; y += blockDepthM * m2lat) {
    const l = turf.lineString([[minX, y], [maxX, y]]);
    lines.push(turf.transformRotate(l, rotationDeg, { pivot }));
  }

  // Cross streets
  for (let x = minX; x <= maxX; x += blockLenM * m2lon) {
    const l = turf.lineString([[x, minY], [x, maxY]]);
    lines.push(turf.transformRotate(l, rotationDeg, { pivot }));
  }

  // Buffer centerlines to road polygons and clip to site
  let roadPoly = null;
  lines.forEach(l => {
    const buf = turf.buffer(l, roadW / 2, { units: 'meters' });
    roadPoly = roadPoly ? turf.union(roadPoly, buf) : buf;
  });
  if (!roadPoly) {
    return { roads: turf.featureCollection([]), homes: turf.featureCollection([]) };
  }
  roadPoly = turf.intersect(roadPoly, siteBoundary) || roadPoly;
  const roadsFC = turf.featureCollection(turf.flatten(roadPoly).features);

  // --- 2) BUILDABLE BLOCKS (site minus roads) ---
  const blocks = turf.difference(siteBoundary, roadPoly);
  if (!blocks) return { roads: roadsFC, homes: turf.featureCollection([]) };

  // --- 3) HOME PLACEMENT (robust rings + correct inward side) ---
  const homes = [];
  turf.flatten(blocks).features.forEach(block => {
    const line = turf.polygonToLine(block);
    const rings = (line.geometry.type === 'LineString')
      ? [line.geometry.coordinates]
      : line.geometry.coordinates; // array of coordinate arrays

    rings.forEach(coords => {
      for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i], b = coords[i + 1];
        const edge = turf.lineString([a, b]);
        const len = turf.length(edge, { units: 'meters' });
        if (len < Math.max(1, homeW)) continue;

        // Only edges that touch a road (slightly generous buffer)
        const touchesRoad = turf.booleanIntersects(
          turf.buffer(edge, 1, { units: 'meters' }),
          roadPoly
        );
        if (!touchesRoad) continue;

        // Determine true inward normal (bearing ± 90), choose the one that points inside the block
        const bearing = turf.bearing(a, b);
        const midPt = turf.along(edge, len / 2, { units: 'meters' }).geometry.coordinates;
        const inwardA = bearing - 90;
        const inwardB = bearing + 90;
        const testA = turf.transformTranslate(turf.point(midPt), 2, inwardA, { units: 'meters' });
        const inward = turf.booleanPointInPolygon(testA, block) ? inwardA : inwardB;

        // Building line offset from the edge by front setback
        const bl = turf.transformTranslate(edge, frontSetback, inward, { units: 'meters' });

        // March along the building line placing home rectangles
        let t = 0;
        const step = homeW + sideGap;
        while (t + homeW <= len + 1e-6) {
          const mid = turf.along(bl, t + homeW / 2, { units: 'meters' }).geometry.coordinates;
          const rect = orientedRect(mid, bearing, homeW, homeD);
          if (turf.booleanWithin(rect, block)) homes.push(rect);
          t += step;
        }
      }
    });
  });

  return { roads: roadsFC, homes: turf.featureCollection(homes) };

  // --- helper: axis-aligned rectangle centered at `center`, oriented by `bearingDeg` ---
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

// Utility: estimate the best rotation from the longest edge of the polygon
export function getLongestEdgeAngle(polygon) {
  let maxLen = 0, bestBearing = 0;
  const line = turf.polygonToLine(polygon);
  const rings = (line.geometry.type === 'LineString')
    ? [line.geometry.coordinates]
    : line.geometry.coordinates;

  rings.forEach(coords => {
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      const len = turf.distance(a, b, { units: 'meters' });
      if (len > maxLen) {
        maxLen = len;
        bestBearing = turf.bearing(a, b);
      }
    }
  });
  return bestBearing;
}
