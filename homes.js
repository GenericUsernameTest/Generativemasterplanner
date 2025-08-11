// homes.js — short-front homes aligned to site's longest edge

// ---------- Public API ----------
export function getLongestEdgeAngle(polygon) {
  return longestEdgeInfo(polygon).angle;
}

export function fillHomes({ map, siteBoundary, roads, setStats, manualAngle }) {
  if (!siteBoundary) { alert('Draw the site boundary first.'); return; }

  // 1) Buildable = site − union(roads)
  let buildable = siteBoundary;
  if (roads?.length) {
    const roadsU = unionAll(roads);
    try { buildable = turf.difference(siteBoundary, roadsU) || siteBoundary; }
    catch (err) { console.warn('difference failed; using site as buildable', err); }
  }

  // --------- PARAMETERS (edit as needed) ---------
  const HOME_FRONT_M  = 6.5;   // short edge (frontage) ALONG boundary (X)
  const HOME_DEPTH_M  = 10;    // long edge (depth) PERPENDICULAR (Y)
  const HOME_HEIGHT_M = 4;     // extrusion height

  const GAP_SIDE_M    = 2;     // gap left/right between frontages in a row
  const GAP_FRONT_M   = 5;     // gap front/back between rows
  const EDGE_MARGIN_M = 0.6;   // set-on from boundary/roads

  const DEBUG = false;         // set true to draw debug lines/points
  // ------------------------------------------------

  // 2) Inset buildable so homes fit fully inside
  const halfMax = Math.max(HOME_FRONT_M, HOME_DEPTH_M) / 2;
  let placementArea;
  try {
    placementArea = turf.buffer(buildable, -(halfMax + EDGE_MARGIN_M), { units: 'meters' });
    if (!placementArea ||
        (placementArea.geometry.type !== 'Polygon' && placementArea.geometry.type !== 'MultiPolygon')) {
      placementArea = buildable;
    }
  } catch (e) {
    console.warn('buffer failed, using original buildable', e);
    placementArea = buildable;
  }

  // 3) Stats
  const areaM2 = turf.area(buildable);
  const ha     = areaM2 / 10000;

  // 4) Find longest edge (bearing in degrees, Mapbox/turf convention)
  const le = longestEdgeInfo(siteBoundary);

  // 5) Angle to align X axis with the boundary’s longest edge (manual override if provided)
  let angle = Number.isFinite(manualAngle) ? manualAngle : le.angle;

  // 6) Work in a rotated frame: X=along edge, Y=inward
  const pivot = turf.center(placementArea).geometry.coordinates;
  const rotatedArea = turf.transformRotate(placementArea, -angle, { pivot });

  // 7) Determine “inward” sign (which Y direction goes inside the site)
  // Compare the rotated edge midpoint Y with the rotated site centroid Y.
  const ring = siteBoundary.geometry.coordinates[0];
  const p1R = turf.transformRotate(turf.point(ring[le.i]),   -angle, { pivot });
  const p2R = turf.transformRotate(turf.point(ring[le.i+1]), -angle, { pivot });
  const yEdgeMid  = (p1R.geometry.coordinates[1] + p2R.geometry.coordinates[1]) / 2;
  const siteCentR = turf.transformRotate(turf.center(siteBoundary), -angle, { pivot });
  const yCentroid = siteCentR.geometry.coordinates[1];
  const inwardSign = (yCentroid >= yEdgeMid) ? 1 : -1;

  // Optional debug: draw the longest edge in green
  if (DEBUG) {
    drawDebug(map, 'debug-edge', turf.lineString([ring[le.i], ring[le.i+1]]), '#16a34a');
  }

  // 8) Meters → degrees at site latitude (approx)
  const lat   = turf.center(buildable).geometry.coordinates[1];
  const dLat  = 1 / 110540; // deg per meter north/south
  const dLon  = 1 / (111320 * Math.cos(lat * Math.PI / 180)); // deg per meter east/west

  // FRONT (short) along X, DEPTH (long) along Y
  const frontLon = HOME_FRONT_M * dLon;  // width (lon delta)
  const depthLat = HOME_DEPTH_M * dLat;  // height (lat delta)

  // Grid spacing
  const stepLon  = (HOME_FRONT_M + GAP_SIDE_M)  * dLon; // along edge
  const stepLat  = (HOME_DEPTH_M + GAP_FRONT_M) * dLat; // inward

  // 9) Grid bounds in rotated space
  const bbox = turf.bbox(rotatedArea);
  const minX = bbox[0], minY = bbox[1], maxX = bbox[2], maxY = bbox[3];

  // Start the first row next to the longest edge (push inward by half depth + margin)
  const startY = yEdgeMid + inwardSign * (depthLat / 2 + EDGE_MARGIN_M * dLat);

  // 10) Build rectangles in rotated space and rotate back
  const homes = [];

  for (let y = startY; inwardSign > 0 ? (y < maxY) : (y > minY); y += inwardSign * stepLat) {
    for (let x = minX + stepLon/2; x < maxX; x += stepLon) {
      const halfLon = frontLon / 2, halfLat = depthLat / 2;
      const rect = turf.polygon([[
        [x - halfLon, y - halfLat],
        [x + halfLon, y - halfLat],
        [x + halfLon, y + halfLat],
        [x - halfLon, y + halfLat],
        [x - halfLon, y - halfLat]
      ]], { height: HOME_HEIGHT_M });

      if (turf.booleanWithin(rect, rotatedArea)) {
        homes.push(turf.transformRotate(rect, angle, { pivot }));
      }
    }
  }

  // 11) Render
  map.getSource('homes').setData(fc(homes));

  setStats?.(`
    <p><strong>Buildable area:</strong> ${Math.round(areaM2).toLocaleString()} m² (${ha.toFixed(2)} ha)</p>
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Rotation used:</strong> ${angle.toFixed(1)}°</p>
    <p><strong>Actual density:</strong> ${(homes.length / ha || 0).toFixed(1)} homes/ha</p>
  `);

  // Optional debug: show start line
  if (DEBUG) {
    const startLine = turf.transformRotate(
      turf.lineString([[minX, startY], [maxX, startY]]),
      angle, { pivot }
    );
    drawDebug(map, 'debug-start-row', startLine, '#ff6600');
  }
}

// ---------- Internal helpers ----------
function longestEdgeInfo(poly) {
  const ring = poly.geometry.coordinates[0];
  let best = { i: 0, len: -1, angle: 0 };
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = turf.point(ring[i]);
    const p2 = turf.point(ring[i+1]);
    const len = turf.distance(p1, p2, { units: 'meters' });
    if (len > best.len) {
      best.len   = len;
      best.angle = turf.bearing(p1, p2); // degrees, -180..180
      best.i     = i;
    }
  }
  return best;
}

function unionAll(features) {
  if (!features?.length) return null;
  let u = features[0];
  for (let i = 1; i < features.length; i++) {
    try { u = turf.union(u, features[i]); }
    catch (err) { console.warn('union failed on feature', i, err); }
  }
  return u;
}

function fc(features) { return { type: 'FeatureCollection', features }; }

// Debug drawing utility (optional)
function drawDebug(map, id, geom, color = '#000') {
  const srcId = `${id}-src`;
  const lyrId = `${id}-lyr`;
  const data = (geom.type === 'Feature') ? geom : { type: 'Feature', geometry: geom, properties: {} };
  try {
    if (map.getSource(srcId)) map.getSource(srcId).setData(data);
    else map.addSource(srcId, { type: 'geojson', data });

    if (map.getLayer(lyrId)) map.removeLayer(lyrId);
    map.addLayer({
      id: lyrId,
      type: data.geometry.type === 'LineString' ? 'line' : 'circle',
      source: srcId,
      paint: data.geometry.type === 'LineString'
        ? { 'line-color': color, 'line-width': 2 }
        : { 'circle-color': color, 'circle-radius': 4 }
    });
  } catch (e) {
    // ignore if style not ready yet
  }
}
