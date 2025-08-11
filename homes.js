// homes.js  — orient homes to the nearest road

export function fillHomesOrientedToRoads({
  map, siteBoundary, roads, getRotationDeg, setStats
}) {
  if (!siteBoundary) {
    alert('Draw the site boundary first.');
    return;
  }

  // ---------- Parameters you can tweak ----------
  const homeWidthM   = 6.5; // short side (frontage) — runs along the road
  const homeDepthM   = 10;  // long side (back-to-front)
  const homeHeightM  = 4;   // extrusion height
  const sideGapM     = 2;   // left/right gap between houses
  const frontGapM    = 5;   // front/back gap between rows
  const edgeMarginM  = 0.5; // safety margin from edges
  // ----------------------------------------------

  // Buildable = site − roads
  let buildable = siteBoundary;
  if (roads?.length) {
    try {
      const u = unionAll(roads);
      const diff = turf.difference(siteBoundary, u);
      if (diff) buildable = diff;
    } catch (e) {
      console.warn('difference failed; using whole site as buildable', e);
    }
  }

  // Inset so full rectangles fit
  const halfMax = Math.max(homeWidthM, homeDepthM) / 2;
  let placementArea;
  try {
    placementArea = turf.buffer(buildable, -(halfMax + edgeMarginM), { units: 'meters' });
    if (!placementArea ||
       (placementArea.geometry.type !== 'Polygon' && placementArea.geometry.type !== 'MultiPolygon')) {
      placementArea = buildable;
    }
  } catch (e) {
    placementArea = buildable;
  }

  // Stats
  const areaM2 = turf.area(buildable);
  const ha     = areaM2 / 10000;

  // meters → degrees at site latitude
  const lat   = turf.center(buildable).geometry.coordinates[1];
  const dLat  = 1 / 110540;
  const dLon  = 1 / (111320 * Math.cos(lat * Math.PI / 180));

  const widthLon = homeWidthM * dLon;
  const depthLat = homeDepthM * dLat;
  const stepLon  = (homeWidthM + sideGapM) * dLon;   // spacing left/right (short edge direction)
  const stepLat  = (homeDepthM + frontGapM) * dLat;  // spacing front/back (long edge direction)

  // Global fallback rotation if no roads found nearby
  const fallbackAngle = (getRotationDeg?.() ?? getLongestEdgeAngle(siteBoundary));

  // Build a list of road lines (for local orientation)
  const roadLines = buildRoadLines(roads);

  // Sample a regular grid in *fallback* frame so coverage is predictable
  const pivot        = turf.center(placementArea).geometry.coordinates;
  const rotatedArea  = turf.transformRotate(placementArea, -fallbackAngle, { pivot });
  const bbox         = turf.bbox(rotatedArea);

  const homes = [];
  for (let x = bbox[0]; x < bbox[2]; x += stepLon) {
    for (let y = bbox[1]; y < bbox[3]; y += stepLat) {
      const cx = x + stepLon / 2, cy = y + stepLat / 2;

      // Axis‑aligned rect in rotated frame
      const halfLon = widthLon / 2, halfLat = depthLat / 2;
      const rect = turf.polygon([[
        [cx - halfLon, cy - halfLat],
        [cx + halfLon, cy - halfLat],
        [cx + halfLon, cy + halfLat],
        [cx - halfLon, cy + halfLat],
        [cx - halfLon, cy - halfLat]
      ]], { height: homeHeightM });

      // Keep candidates that are fully inside the rotated placement area
      if (!turf.booleanWithin(rect, rotatedArea)) continue;

      // Rotate the candidate back to map space
      let rectBack = turf.transformRotate(rect, fallbackAngle, { pivot });
      const center = turf.center(rectBack);

      // If we have roads, snap orientation to the nearest road segment
      if (roadLines.length) {
        const localBearing = getNearestRoadBearing(roadLines, center);
        // We want the home's *short edge* parallel to the road:
        // our rectangle was created with width along X and depth along Y.
        // Rotating the already-fallback-rotated rect to (localBearing - fallbackAngle)
        // aligns the short side with the road.
        const delta = localBearing - fallbackAngle;
        rectBack = turf.transformRotate(rect, delta, { pivot }); // re-rotate from the rotated frame
        rectBack = turf.transformRotate(rectBack, fallbackAngle, { pivot }); // then back to map
      }

      homes.push(rectBack);
    }
  }

  map.getSource('homes').setData(fc(homes));

  setStats?.(`
    <p><strong>Buildable area:</strong> ${Math.round(areaM2).toLocaleString()} m² (${ha.toFixed(2)} ha)</p>
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Actual density:</strong> ${(homes.length / ha || 0).toFixed(1)} homes/ha</p>
  `);
}

// ---- helpers (copy alongside or import from your utils) ----
function fc(features){ return { type:'FeatureCollection', features }; }

function unionAll(features){
  if (!features?.length) return null;
  let u = features[0];
  for (let i=1;i<features.length;i++){
    try { u = turf.union(u, features[i]); }
    catch(e){ console.warn('union failed on feature', i, e); }
  }
  return u;
}

function getLongestEdgeAngle(polygon){
  const coords = polygon.geometry.coordinates[0];
  let longestAngle = 0, longestDist = 0;
  for (let i=0;i<coords.length-1;i++){
    const p1 = turf.point(coords[i]);
    const p2 = turf.point(coords[i+1]);
    const d  = turf.distance(p1,p2,{units:'meters'});
    if (d > longestDist){
      longestDist = d;
      longestAngle = turf.bearing(p1,p2);
    }
  }
  return longestAngle;
}

// Turn road polygons into an array of LineStrings (no Multi*)
function buildRoadLines(roads){
  if (!roads?.length) return [];
  const lines = [];
  roads.forEach(r => {
    const ln = turf.polygonToLine(r);
    if (ln.geometry.type === 'LineString') {
      lines.push(ln);
    } else if (ln.geometry.type === 'MultiLineString') {
      ln.geometry.coordinates.forEach(c => lines.push(turf.lineString(c)));
    }
  });
  return lines;
}

// Find bearing of nearest road segment to a point
function getNearestRoadBearing(roadLines, point){
  let best = { dist: Infinity, bearing: null };
  roadLines.forEach(line => {
    const snap = turf.nearestPointOnLine(line, point, { units: 'meters' });
    const idx  = snap.properties.index; // segment start index
    const coords = line.geometry.coordinates;
    if (idx >= 0 && idx < coords.length - 1) {
      const b = turf.bearing(
        turf.point(coords[idx]),
        turf.point(coords[idx+1])
      );
      const d = snap.properties.dist || 0;
      if (d < best.dist) best = { dist: d, bearing: b };
    }
  });
  // Fallback if something went odd
  return Number.isFinite(best.bearing) ? best.bearing : 0;
}
