// generateplan.js — access road + perpendicular spine + one-row homes along the spine
import { $, emptyFC, fc, setStats, metersToDeg, unionAll, getLongestEdgeAngle } from './utils.js';

export function generatePlan(map, siteBoundary, accessRoad) {
  if (!siteBoundary) return alert('Draw the site boundary first.');

  // ===== 1) Inputs =====
  const houseType = $('houseType').value;
  let homeW, homeD, color;
  if (houseType === 't1') { homeW = 5;  homeD = 5;  color = '#9fb7ff'; } // soft blue (clearer in 3D)
  if (houseType === 't2') { homeW = 5;  homeD = 8;  color = '#9fb7ff'; }
  if (houseType === 't3') { homeW = 10; homeD = 8;  color = '#9fb7ff'; }

  const front  = parseFloat(($('frontSetback')?.value ?? '').trim()) || 5; // m
  const side   = parseFloat(($('sideGap')?.value ?? '').trim())       || 2; // m

  const rawAngle = parseFloat(($('rotationAngle')?.value ?? '').trim());
  const angleDeg = Number.isFinite(rawAngle) ? rawAngle : getLongestEdgeAngle(siteBoundary);

  // Road widths (meters)
  const accessW = 8;   // access road carriageway
  const spineW  = 6;   // narrower spine
  const edgeClear = 8; // keep both roads back from site edge (m)

  // ===== 2) Make the ACCESS road polygon (flat end) =====
  let accessInside = accessRoad && clipLineInside(accessRoad, siteBoundary);
  if (!accessInside && accessRoad) accessInside = accessRoad; // fall back

  let accessPoly = null;
  if (isLine(accessInside)) {
    // Buffer with FLAT cap so it “meets” the spine neatly
    accessPoly = safeIntersectPoly(
      turf.buffer(accessInside, accessW / 2, { units: 'meters', endCapStyle: 'flat' }),
      siteBoundary
    );
  }

  // ===== 3) Build a perpendicular SPINE through the interior end of the access =====
  let spineLine = null;
  if (isLine(accessInside)) {
    const j = pickInteriorEndpoint(accessInside, siteBoundary); // junction point (Feature<Point>)
    const tBear = tangentBearing(accessInside, j);              // local access tangent (deg)
    if (Number.isFinite(tBear)) {
      const nBear = normBearing(tBear);                         // perpendicular (deg)

      // Make a long line through the junction in both +/- normal directions
      const L = 2000; // long enough to cross any normal-sized site (m)
      const pL = turf.destination(j,  L, nBear, { units: 'meters' });
      const pR = turf.destination(j, -L, nBear, { units: 'meters' });
      const longSpine = turf.lineString([pL.geometry.coordinates, pR.geometry.coordinates]);

      // Clip to site & pull back from edges
      const insideSeg = lineClipToPoly(longSpine, siteBoundary);
      if (isLine(insideSeg)) {
        spineLine = trimLineEnds(insideSeg, edgeClear); // keep inboard a bit
      }

      // Nudge the ACCESS line to end exactly at the spine centerline (flat meeting point)
      accessInside = shortenLineToPoint(accessInside, j, 0.5); // 0.5 m shy of the junction
      accessPoly = safeIntersectPoly(
        turf.buffer(accessInside, accessW / 2, { units: 'meters', endCapStyle: 'flat' }),
        siteBoundary
      );
    }
  }

  // ===== 4) Buffer the SPINE with a ROUND cap =====
  let spinePoly = null;
  if (isLine(spineLine)) {
    spinePoly = safeIntersectPoly(
      turf.buffer(spineLine, spineW / 2, { units: 'meters', endCapStyle: 'round' }),
      siteBoundary
    );
  }

  // ===== 5) Union roads + paint =====
  let roadsFC = emptyFC();
  const roadPieces = [];
  if (accessPoly) roadPieces.push(accessPoly);
  if (spinePoly)  roadPieces.push(spinePoly);

  if (roadPieces.length) {
    const u = unionAll(roadPieces);
    roadsFC = fc([u]);
  }
  map.getSource('roads-view')?.setData(roadsFC);

  // ===== 6) Build a no‑build mask (roads + safety buffer) =====
  let noBuild = null;
  if (roadsFC.features.length) {
    try {
      const grow = fc(roadsFC.features.map(f => turf.buffer(f, 0.4, { units: 'meters' })));
      noBuild = unionAll(grow.features);
    } catch (_) { /* ignore */ }
  }

  // ===== 7) Place homes along the spine (one row each side), aligned to tangent =====
  const homes = [];
  if (isLine(spineLine)) {
    const lotPitch = homeW + side;         // m
    const offDist  = front + homeD / 2;    // m from spine centerline to house center
    const stepM    = Math.max(1, lotPitch);

    const Lm = turf.length(spineLine, { units: 'meters' });
    // Start/stop a little in from the ends for nicer caps
    const start = 0.5 * lotPitch;
    const stop  = Math.max(0, Lm - 0.5 * lotPitch);

    for (let s = start; s <= stop; s += stepM) {
      const base = turf.along(spineLine, s / 1000, { units: 'kilometers' });
      const bear = tangentBearing(spineLine, base);
      if (!Number.isFinite(bear)) continue;

      for (const sideSign of [-1, +1]) {
        const center = turf.destination(base, offDist * sideSign, normBearing(bear), { units: 'meters' });

        // Build an oriented rectangle at 'center' with orientation 'bear'
        const rect = orientedRect(center, bear, homeW, homeD, color);

        // Keep inside site, and NOT overlapping roads/no‑build
        if (!turf.booleanWithin(rect, siteBoundary)) continue;
        if (noBuild && turf.booleanIntersects(rect, noBuild)) continue;

        homes.push(rect);
      }
    }
  }

  // ===== 8) Render homes + stats (density over whole site) =====
  map.getSource('homes')?.setData(fc(homes));
  const siteHa = turf.area(siteBoundary) / 10000;
  setStats(`
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Rotation (fallback only):</strong> ${angleDeg.toFixed(1)}°</p>
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

function normBearing(b) { return (b + 90); }

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

// Trim N meters off both ends of a line
function trimLineEnds(line, trimM) {
  const Lm = turf.length(line, { units: 'meters' });
  const a = Math.min(trimM, Lm / 2);
  const b = Math.max(0, Lm - trimM);
  const p0 = turf.along(line, a / 1000, { units: 'kilometers' });
  const p1 = turf.along(line, b / 1000, { units: 'kilometers' });
  return turf.lineString([p0.geometry.coordinates, p1.geometry.coordinates]);
}

// Shorten a line so its end finishes shy of a point by 'gapM' (used to meet spine centerline cleanly)
function shortenLineToPoint(line, point, gapM) {
  const snapped = turf.nearestPointOnLine(line, point);
  const cs = line.geometry.coordinates.slice();
  const endA = turf.point(cs[0]);
  const endB = turf.point(cs[cs.length - 1]);
  const dA = turf.distance(endA, point, { units: 'meters' });
  const dB = turf.distance(endB, point, { units: 'meters' });

  if (dA < dB) {
    const dir = turf.bearing(endA, turf.point(cs[1]));
    const newA = turf.destination(point, gapM, dir + 180, { units: 'meters' }).geometry.coordinates;
    cs[0] = newA;
  } else {
    const n = cs.length - 1;
    const dir = turf.bearing(turf.point(cs[n - 1]), endB);
    const newB = turf.destination(point, gapM, dir, { units: 'meters' }).geometry.coordinates;
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
