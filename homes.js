// homes.js – Masterplan generation (roads + homes) with CDN Turf

export function generateMasterplan(siteBoundary, opts) {
  const { rotationDeg, homeW, homeD, frontSetback, sideGap, roadW, lotsPerBlock } = opts;

  const lat = turf.center(siteBoundary).geometry.coordinates[1];
  const m2lat = 1 / 110540;
  const m2lon = 1 / (111320 * Math.cos(lat * Math.PI / 180));

  const pivot = turf.center(siteBoundary).geometry.coordinates;
  const rotatedSite = turf.transformRotate(siteBoundary, -rotationDeg, { pivot });
  const [minX, minY, maxX, maxY] = turf.bbox(rotatedSite);

  const blockDepthM = roadW + 2 * (homeD + frontSetback);
  const blockLenM = lotsPerBlock * (homeW + sideGap);

  const roads = [];
  for (let y = minY; y <= maxY; y += blockDepthM * m2lat) {
    roads.push(turf.transformRotate(turf.lineString([[minX, y], [maxX, y]]), rotationDeg, { pivot }));
  }
  for (let x = minX; x <= maxX; x += blockLenM * m2lon) {
    roads.push(turf.transformRotate(turf.lineString([[x, minY], [x, maxY]]), rotationDeg, { pivot }));
  }

  let roadPoly = null;
  roads.forEach(r => {
    const buf = turf.buffer(r, roadW / 2, { units: 'meters' });
    roadPoly = roadPoly ? turf.union(roadPoly, buf) : buf;
  });
  roadPoly = turf.intersect(roadPoly, siteBoundary) || roadPoly;
  const roadFC = turf.featureCollection(turf.flatten(roadPoly).features);

  const blocks = turf.difference(siteBoundary, roadPoly);
  if (!blocks) return { roads: roadFC, homes: turf.featureCollection([]) };

  const homes = [];
  turf.flatten(blocks).features.forEach(block => {
    const outline = turf.polygonToLine(block);
    const coords = outline.geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      const edge = turf.lineString([a, b]);
      const len = turf.length(edge, { units: 'meters' });

      const edgeBuf = turf.buffer(edge, 0.1, { units: 'meters' });
      if (!turf.booleanIntersects(edgeBuf, roadPoly)) continue;

      const bearing = turf.bearing(a, b);
      const inward = bearing - 90;
      const bl = turf.transformTranslate(edge, frontSetback, inward, { units: 'meters' });

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

  return { roads: roadFC, homes: turf.featureCollection(homes) };

  function orientedRect(center, bearingDeg, w, d) {
    const halfW = w / 2, halfD = d / 2;
    const local = [
      [-halfW, -halfD], [halfW, -halfD],
      [halfW, halfD], [-halfW, halfD],
      [-halfW, -halfD]
    ];
    const rad = bearingDeg * Math.PI / 180;
    const pts = local.map(([x, y]) => {
      const xr = x * Math.cos(rad) - y * Math.sin(rad);
      const yr = x * Math.sin(rad) + y * Math.cos(rad);
      return turf.destination(center, Math.hypot(xr, yr),
        Math.atan2(xr, yr) * 180 / Math.PI, { units: 'meters' }).geometry.coordinates;
    });
    return turf.polygon([pts]);
  }
}

export function getLongestEdgeAngle(polygon) {
  let maxLen = 0, bestBearing = 0;
  const coords = turf.polygonToLine(polygon).geometry.coordinates;
  for (let i = 0; i < coords.length - 1; i++) {
    const len = turf.distance(coords[i], coords[i + 1], { units: 'meters' });
    if (len > maxLen) {
      maxLen = len;
      bestBearing = turf.bearing(coords[i], coords[i + 1]);
    }
  }
  return bestBearing;
}
