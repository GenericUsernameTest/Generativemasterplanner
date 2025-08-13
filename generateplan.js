// generateplan.js — access road + spine aligned to nearest boundary + one‑row homes (+ parks mask)
import { $, emptyFC, fc, setStats, metersToDeg, unionAll } from './utils.js';

export function generatePlan(map, siteBoundary, accessRoad, parksFC = { type: 'FeatureCollection', features: [] }) {
  if (!siteBoundary) return alert('Draw the site boundary first.');

  // ===== 1) Inputs =====
  const houseType = $('houseType').value;
  let homeW, homeD, color;
  if (houseType === 't1') { homeW = 5;  homeD = 5;  color = '#9fb7ff'; }
  if (houseType === 't2') { homeW = 5;  homeD = 8;  color = '#9fb7ff'; }
  if (houseType === 't3') { homeW = 10; homeD = 8;  color = '#9fb7ff'; }

  const front = parseFloat(($('frontSetback')?.value ?? '').trim()) || 5; // m
  const side  = parseFloat(($('sideGap')?.value ?? '').trim())       || 2; // m

  // Road widths (meters)
  const accessW   = 8;  // access road carriageway
  const spineW    = 6;  // spine carriageway
  const edgeClear = 8;  // keep roads back from site edge (m)

  // ===== 2) Access line segment inside the site (no buffering yet) =====
  let accessInside = accessRoad && clipLineInside(accessRoad, siteBoundary);
  if (!accessInside && accessRoad) accessInside = accessRoad; // fallback (if split fails but it’s mostly inside)
  let accessPoly = null;

  // ===== 3) Build SPINE aligned to NEAREST boundary bearing at the junction =====
  let spineLine = null;
  if (isLine(accessInside)) {
    // Interior end of access = junction
    const j = pickInteriorEndpoint(accessInside, siteBoundary);
    const edgeBear = nearestEdgeBearing(siteBoundary, j); // bearing of closest boundary segment at the junction

    if (Number.isFinite(edgeBear)) {
      // Long line through the junction in +/- edge bearing; then clip & trim
      const L = 2000; // m
      const pL = turf.destination(j,  L, edgeBear, { units: 'meters' });
      const pR = turf.destination(j, -L, edgeBear, { units: 'meters' });
      const longSpine  = turf.lineString([pL.geometry.coordinates, pR.geometry.coordinates]);
      const insideSeg  = lineClipToPoly(longSpine, siteBoundary);
      spineLine = isLine(insideSeg) ? trimLineEnds(insideSeg, edgeClear) : null;

      // Small overlap so the access’s round cap is hidden under the spine
      const overlap = Math.max(accessW, spineW) * 0.6; // e.g. ~5m for 8/6m roads
      accessInside = extendLinePastPoint(accessInside, j, overlap);

      // Buffer the access (round caps are fine; overlap hides the cap at the junction)
      accessPoly = safeIntersectPoly(
        turf.buffer(accessInside, accessW / 2, { units: 'meters' }),
        siteBoundary
      );
    }
  }

  // ===== 4) Buffer the SPINE (round caps) =====
  let spinePoly = null;
  if (isLine(spineLine)) {
    spinePoly = safeIntersectPoly(
      turf.buffer(spineLine, spineW / 2, { units: 'meters' }),
      siteBoundary
    );
  }

  // ===== 5) Union roads + paint =====
  let roadsFC = emptyFC();
  const roadPieces = [];
  if (accessPoly) roadPieces.push(accessPoly);
  if (spinePoly)  roadPieces.push(spinePoly);

  if (roadPieces.length) {
    try {
      const u = unionAll(roadPieces);
      roadsFC = fc([u]);
    } catch {
      // fallback: show pieces un-unioned if union fails
      roadsFC = fc(roadPieces);
    }
  }
  map.getSource('roads-view')?.setData(roadsFC);

  // ===== 5.5) Parks union + combined no‑build =====
  let parksUnion = null;
  if (parksFC?.features?.length) {
    try { parksUnion = unionAll(parksFC.features); } catch { parksUnion = null; }
  }

  let noBuild = null; // areas where houses cannot be (roads + parks), with a tiny growth for roads
  try {
    const pieces = [];
    if (roadsFC.features?.length) {
      // Slight growth on roads so houses don’t kiss the carriageway polygons
      const grow = roadsFC.features.map(f => turf.buffer(f, 0.4, { units: 'meters' }));
      pieces.push(...grow);
    }
    if (parksUnion) pieces.push(parksUnion);
    if (pieces.length) noBuild = unionAll(pieces);
  } catch { /* keep noBuild = null */ }

  // ===== 6) Place homes along the spine (one row each side), aligned to tangent =====
  const homes = [];
  if (isLine(spineLine)) {
    const lotPitch = homeW + side;         // m
    const offDist  = front + homeD / 2;    // m from spine centerline to house center
    const stepM    = Math.max(1, lotPitch);

    const Lm = turf.length(spineLine, { units: 'meters' });
    const start = 0.5 * lotPitch;              // a little in from ends
    const stop  = Math.max(0, Lm - 0.5 * lotPitch);

    for (let s = start; s <= stop; s += stepM) {
      const base = turf.along(spineLine, s / 1000, { units: 'kilometers' });
      const bear = tangentBearing(spineLine, base);
      if (!Number.isFinite(bear)) continue;

      for (const sideSign of [-1, +1]) {
        const center = turf.destination(base, offDist * sideSign, bear + 90, { units: 'meters' });
        const rect = orientedRect(center, bear, homeW, homeD, color);
        // Keep inside site, and NOT overlapping roads/parks
        if (!turf.booleanWithin(rect, siteBoundary)) continue;
        if (noBuild && turf.booleanIntersects(rect, noBuild)) continue;
        homes.push(rect);
      }
    }
  }

  // ===== 7) Render homes + stats =====
  map.getSource('homes')?.setData(fc(homes));
  const siteHa = turf.area(siteBoundary) / 10000;
  setStats(`
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Site density:</strong> ${(homes.length / (siteHa || 1)).toFixed(1)} homes/ha</p>
  `);
}

/* ================= helpers ================= */

function isLine(f) {
  return f && f.type === 'Feature' && f.geometry?.type === 'LineString' &&
         Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2;
}

// Clip line strictly to polygon interior; return the longest inside segment
function clipLineInside(line, poly) {
  try {
    const parts = turf.lineSplit(line, poly);
    if (!parts?.features?.length) return null;
    const inside = parts.features.filter(seg => {
      const mid = turf.along(seg, turf.length(seg, { units: 'kilometers' }) / 2, { units: 'kilometers' });
      return turf.booleanPointInPolygon(mid, poly);
    });
    if (!inside.length) return null;
    let best = inside[0], bestLen = turf.length(best);
    for (let i = 1; i < inside.length; i++) {
      const L = turf.length(inside[i]);
      if (L > bestLen) { best = inside[i]; bestLen = L; }
    }
    return best;
  } catch { return null; }
}

// Intersect polygon A∩B safely
function safeIntersectPoly(a, b) {
  try { return turf.intersect(a, b) || null; } catch { return null; }
}

// Pick the access endpoint that lies **inside** the site and is deeper in
function pickInteriorEndpoint(accessInside, sitePoly) {
  const cs = accessInside.geometry.coordinates;
  const a = turf.point(cs[0]);
  const b = turf.point(cs[cs.length - 1]);
  const cen = turf.center(sitePoly);
  const da = turf.distance(a, cen, { units: 'meters' });
  const db = turf.distance(b, cen, { units: 'meters' });
  return da < db ? a : b;
}

// Bearing along a line at a point (or at distance if point is a number)
function tangentBearing(line, atPointOrFeature) {
  const total = turf.length(line, { units: 'meters' });
  if (total <= 0) return NaN;

  let sMeters;
  if (typeof atPointOrFeature === 'number') {
    sMeters = Math.max(0, Math.min(total, atPointOrFeature));
  } else {
    const snapped = turf.nearestPointOnLine(line, atPointOrFeature);
    sMeters = snapped.properties.location * 1000; // km -> m
  }

  const d = Math.min(2, Math.max(0.5, total * 0.01)); // small sample segment
  const s0 = Math.max(0, sMeters - d / 2);
  const s1 = Math.min(total, sMeters + d / 2);

  const p0 = turf.along(line, s0 / 1000, { units: 'kilometers' });
  const p1 = turf.along(line, s1 / 1000, { units: 'kilometers' });
  return turf.bearing(p0, p1);
}

// Clip a long line to a polygon; returns the longest piece inside
function lineClipToPoly(line, poly) {
  try {
    const parts = turf.lineSplit(line, poly);
    if (!parts?.features?.length) return null;
    const inside = parts.features.filter(seg => {
      const mid = turf.along(seg, turf.length(seg, { units: 'kilometers' }) / 2, { units: 'kilometers' });
      return turf.booleanPointInPolygon(mid, poly);
    });
    if (!inside.length) return null;
    let best = inside[0], bestLen = turf.length(best);
    for (let i = 1; i < inside.length; i++) {
      const L = turf.length(inside[i]);
      if (L > bestLen) { best = inside[i]; bestLen = L; }
    }
    return best;
  } catch { return null; }
}

// Trim N meters off both ends of a line (symmetrically)
function trimLineEnds(line, trimM) {
  const Lm = turf.length(line, { units: 'meters' });
  const a  = Math.min(trimM, Lm / 2);
  const p0 = turf.along(line, a / 1000, { units: 'kilometers' });
  const p1 = turf.along(line, (Lm - a) / 1000, { units: 'kilometers' });
  return turf.lineString([p0.geometry.coordinates, p1.geometry.coordinates]);
}

// Extend a line so its end passes a given point by 'extraM'
function extendLinePastPoint(line, point, extraM) {
  const cs = line.geometry.coordinates.slice();
  const endA = turf.point(cs[0]);
  const endB = turf.point(cs[cs.length - 1]);
  const dA = turf.distance(endA, point, { units: 'meters' });
  const dB = turf.distance(endB, point, { units: 'meters' });

  if (dA < dB) {
    // Extend A end toward the point and past it by extraM
    const dir = turf.bearing(endA, turf.point(cs[1]));
    const newA = turf.destination(point, extraM, dir - 180, { units: 'meters' }).geometry.coordinates;
    cs[0] = newA;
  } else {
    // Extend B end toward the point and past it by extraM
    const n = cs.length - 1;
    const dir = turf.bearing(turf.point(cs[n - 1]), endB);
    const newB = turf.destination(point, extraM, dir, { units: 'meters' }).geometry.coordinates;
    cs[n] = newB;
  }
  return turf.lineString(cs);
}

// Build an oriented rectangle (meters) around a point, rotated by bearing (deg)
function orientedRect(center, bearingDeg, widthM, depthM, color) {
  const [cx, cy] = center.geometry.coordinates;
  const lat = cy;
  const { dLat, dLon } = metersToDeg(lat);

  const halfW = (widthM / 2);
  const halfD = (depthM / 2);

  const rect = turf.polygon([[
    [cx - halfW * dLon, cy - halfD * dLat],
    [cx + halfW * dLon, cy - halfD * dLat],
    [cx + halfW * dLon, cy + halfD * dLat],
    [cx - halfW * dLon, cy + halfD * dLat],
    [cx - halfW * dLon, cy - halfD * dLat],
  ]], { height: 4, color });

  return turf.transformRotate(rect, bearingDeg, { pivot: [cx, cy] });
}

// Bearing of the boundary segment that's closest to a point (Feature<Point>)
function nearestEdgeBearing(sitePoly, pointFeature) {
  const p = pointFeature; // Feature<Point>
  let bestBearing = 0;
  let bestDist = Infinity;

  const visitRing = (coords) => {
    // coords: [ [x0,y0], [x1,y1], ..., [xN,yN] ] (closed)
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const seg = turf.lineString([a, b]);
      const d = turf.pointToLineDistance(p, seg, { units: 'meters' });
      if (d < bestDist) {
        bestDist = d;
        bestBearing = turf.bearing(turf.point(a), turf.point(b));
      }
    }
  };

  const g = sitePoly.geometry;
  if (g.type === 'Polygon') {
    visitRing(g.coordinates[0]); // outer ring
  } else if (g.type === 'MultiPolygon') {
    for (const poly of g.coordinates) visitRing(poly[0]); // outer rings
  }

  return bestBearing;
}
