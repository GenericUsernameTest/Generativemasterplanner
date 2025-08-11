// homes.js
// Utilities for layout + generation

// Longest boundary edge bearing (degrees, -180..180)
export function getLongestEdgeAngle(polygon) {
  const ring = polygon.geometry.coordinates[0];
  let best = { dist: 0, angle: 0 };
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = turf.point(ring[i]);
    const p2 = turf.point(ring[i + 1]);
    const dist = turf.distance(p1, p2, { units: 'meters' });
    if (dist > best.dist) {
      best.dist = dist;
      best.angle = turf.bearing(p1, p2); // -180..180
    }
  }
  return best.angle;
}

// Main generator. Returns { homesFC, stats }
export function fillHomes({
  map,
  siteBoundary,
  roads = [],
  rotationDegrees,       // number | NaN -> auto
  params = {},
  targetSourceId = 'homes'
}) {
  // ---- Defaults (edit if you like) ----
  const {
    homeWidthM  = 6.5,  // short side  (street/front)
    homeDepthM  = 10,   // long side   (back)
    homeHeightM = 4,    // extrusion height
    gapSideM    = 2,    // gap left/right (between short sides)
    gapFrontM   = 5,    // gap front/back (between long sides)
    edgeMarginM = 0.6   // clearance to edges
  } = params;

  // Buildable = site − union(roads)
  let buildable = siteBoundary;
  if (roads.length) {
    let u = roads[0];
    for (let i = 1; i < roads.length; i++) {
      try { u = turf.union(u, roads[i]); } catch {}
    }
    try { buildable = turf.difference(siteBoundary, u) || siteBoundary; } catch {}
  }

  // Inset so full rectangles fit
  const halfMax = Math.max(homeWidthM, homeDepthM) / 2;
  let placementArea;
  try {
    placementArea = turf.buffer(buildable, -(halfMax + edgeMarginM), { units: 'meters' });
    if (!placementArea || !['Polygon','MultiPolygon'].includes(placementArea.geometry.type)) {
      placementArea = buildable;
    }
  } catch { placementArea = buildable; }

  // Stats
  const areaM2 = turf.area(buildable);
  const ha     = areaM2 / 10000;

  // meters → degrees (approx at site latitude)
  const lat   = turf.center(buildable).geometry.coordinates[1];
  const dLat  = 1 / 110540;
  const dLon  = 1 / (111320 * Math.cos(lat * Math.PI / 180));

  // IMPORTANT: we want short side (width) to face the long boundary.
  // That means rows should run ALONG the long edge, with *depth* stepping
  // perpendicular to it. To do that, rotate grid so X-axis is ALONG long edge.
  const autoBearing = getLongestEdgeAngle(siteBoundary);         // along the long side
  const angleUsed   = Number.isFinite(rotationDegrees)
    ? rotationDegrees
    : autoBearing;                                              // use manual if provided, else auto

  // In the rotated frame:
  // - X axis: along rows (houses sit side-by-side), step by (homeWidth + gapSide)
  // - Y axis: across rows (front-to-back), step by (homeDepth + gapFront)
  const widthLon = homeWidthM * dLon;    // short
  const depthLat = homeDepthM * dLat;    // long
  const stepLon  = (homeWidthM + gapSideM) * dLon;
  const stepLat  = (homeDepthM + gapFrontM) * dLat;

  // Rotate placement area so rows align to X axis
  const pivot = turf.center(placementArea).geometry.coordinates;
  const rotatedArea = turf.transformRotate(placementArea, -angleUsed, { pivot });

  const [minX, minY, maxX, maxY] = turf.bbox(rotatedArea);
  const homes = [];

  // Sweep across whole bbox; ensure inclusive end so we don’t leave a gap
  for (let x = minX; x <= maxX; x += stepLon) {
    for (let y = minY; y <= maxY; y += stepLat) {
      const cx = x + stepLon / 2, cy = y + stepLat / 2;

      // Axis-aligned rectangle in rotated space:
      const halfLon = widthLon / 2, halfLat = depthLat / 2;
      const rect = turf.polygon([[
        [cx - halfLon, cy - halfLat],
        [cx + halfLon, cy - halfLat],
        [cx + halfLon, cy + halfLat],
        [cx - halfLon, cy + halfLat],
        [cx - halfLon, cy - halfLat]
      ]], { height: homeHeightM });

      // Keep only if fully inside buildable (in rotated frame)
      if (turf.booleanWithin(rect, rotatedArea)) {
        // Rotate back into map space
        const back = turf.transformRotate(rect, angleUsed, { pivot });
        homes.push(back);
      }
    }
  }

  const homesFC = { type: 'FeatureCollection', features: homes };
  if (map && map.getSource(targetSourceId)) {
    map.getSource(targetSourceId).setData(homesFC);
  }

  return {
    homesFC,
    stats: {
      areaM2,
      ha,
      count: homes.length,
      angleUsed
    }
  };
}
