// generateplan.js — access road + perpendicular spine + one-row homes along spine
import { $, emptyFC, fc, setStats, unionAll } from './utils.js';

export function generatePlan(map, siteBoundary, entranceRoad) {
  if (!siteBoundary) return alert('Draw the site boundary first.');
  if (!entranceRoad)  return alert('Draw the Access Road first (Line).');

  // ---------- inputs ----------
  const houseType = $('houseType').value;
  let homeW, homeD, color;
  if (houseType === 't1') { homeW = 5;  homeD = 5;  color = '#a3b4ff'; } // 5×5
  if (houseType === 't2') { homeW = 5;  homeD = 8;  color = '#a3ffc6'; } // 5×8
  if (houseType === 't3') { homeW = 10; homeD = 8;  color = '#ffb3b3'; } // 10×8

  const front = parseFloat($('frontSetback').value) || 5; // gap from road edge to front of home
  const side  = parseFloat($('sideGap').value)       || 2; // spacing along the road between homes

  // ---------- make safe helpers ----------
  const meters = { units: 'meters' };
  const roads = [];

  const isLine = f => f && f.type === 'Feature' && f.geometry?.type === 'LineString';
  const isPoly = f => f && f.type === 'Feature' &&
    (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon');

  if (!isPoly(siteBoundary) || !isLine(entranceRoad)) {
    console.warn('Bad inputs for generatePlan'); return;
  }

  // 1) Buffer the drawn access road (as-is; curved line supported)
  const accessWidth = 8; // m
  let accessPoly = null;
  try {
    const buf = turf.buffer(entranceRoad, accessWidth / 2, meters);
    accessPoly = turf.intersect(buf, siteBoundary) || null;
    if (accessPoly) roads.push(accessPoly);
  } catch (e) {
    console.warn('buffer access failed', e);
  }

  // 2) Build a perpendicular spine that starts EXACTLY at the end of the access road (T‑junction)
  const coords = entranceRoad.geometry.coordinates;
  if (coords.length < 2) return;

  const end = coords[coords.length - 1];
  const prev = coords[coords.length - 2];

  // bearing of last segment (degrees)
  const segBear = turf.bearing(turf.point(prev), turf.point(end));            // along access
  const leftPerp  = segBear + 90;                                             // candidate
  const rightPerp = segBear - 90;                                             // candidate

  // try both directions; keep the longer piece INSIDE the site
  const spineCandidate = (bearingDeg) => {
    // Make a long trial ray from the access end
    const far = turf.destination(turf.point(end), 1000, bearingDeg, meters);  // 1km ray
    const trial = turf.lineString([end, far.geometry.coordinates]);
    return clipLineInside(trial, siteBoundary); // keep only the inside piece
  };

  const spineA = spineCandidate(leftPerp);
  const spineB = spineCandidate(rightPerp);

  let spine = null;
  if (spineA && spineB) {
    spine = (turf.length(spineA, meters) >= turf.length(spineB, meters)) ? spineA : spineB;
  } else {
    spine = spineA || spineB || null;
  }

  // 2b) Buffer the spine to a local road
  const localWidth = 5; // m
  if (spine) {
    try {
      const buf = turf.buffer(spine, localWidth / 2, meters);
      const clipped = turf.intersect(buf, siteBoundary);
      if (clipped) roads.push(clipped);
    } catch (e) { console.warn('buffer spine failed', e); }
  }

  // Render roads
  map.getSource('roads-view')?.setData(fc(roads));

  // For collision checks (keep homes off the asphalt)
  let roadsBig = emptyFC();
  if (roads.length) {
    try {
      const expanded = fc(roads.map(r => turf.buffer(r, 0.25, meters))); // tiny safety
      const unioned  = unionAll(expanded.features);
      roadsBig = fc([unioned]);
    } catch { /* ignore */ }
  }

  // 3) Place a single row of homes along the spine (both sides),
  //    aligned with the spine’s tangent, with frontage parallel to the road.
  const homes = [];
  if (spine) {
    const spineLen = turf.length(spine, meters);          // meters
    const step = homeW + side;                             // spacing along
    const offset = front + homeD / 2;                     // center offset normal to road

    for (let s = step / 2; s <= spineLen - step / 2; s += step) {
      const centerOnLine = turf.along(spine, s / 1000, { units: 'kilometers' }); // along expects km
      const tangentBear  = tangentBearing(spine, s);                               // degrees

      // place left & right
      const leftCenter  = turf.destination(centerOnLine,  offset, tangentBear + 90, meters);
      const rightCenter = turf.destination(centerOnLine,  offset, tangentBear - 90, meters);

      // make a rectangle oriented to tangent (width along tangent, depth normal)
      const rectAt = (pt) => orientedRect(pt, homeW, homeD, tangentBear);

      [leftCenter, rightCenter].forEach(pt => {
        const rect = rectAt(pt);
        // must be inside site and not inside the (slightly expanded) road polys
        const insideSite = turf.booleanWithin(rect, siteBoundary);
        const clashesRoad =
          roadsBig.features.length &&
          turf.booleanOverlap(rect, roadsBig.features[0]); // overlap == intersects with area

        if (insideSite && !clashesRoad) {
          rect.properties = { height: 4, color };
          homes.push(rect);
        }
      });
    }
  }

  map.getSource('homes')?.setData(fc(homes));

  // 4) Site‑wide density
  const siteHa = turf.area(siteBoundary) / 10000;
  setStats(`
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Site density:</strong> ${(homes.length / (siteHa || 1)).toFixed(1)} homes/ha</p>
  `);

  // ---------------- helpers ----------------
  function clipLineInside(line, poly) {
    // Keep the piece whose midpoint lies inside the polygon
    try {
      const split = turf.lineSplit(line, poly); // segments cut by polygon boundary
      const inside = (split?.features || []).filter(seg => {
        const mid = turf.along(seg, turf.length(seg, { units: 'kilometers' }) / 2, { units: 'kilometers' });
        return turf.booleanPointInPolygon(mid, poly);
      });
      if (!inside.length) return null;
      // pick the longest
      let best = inside[0], bestLen = turf.length(best, meters);
      for (let i = 1; i < inside.length; i++) {
        const L = turf.length(inside[i], meters);
        if (L > bestLen) { best = inside[i]; bestLen = L; }
      }
      // Force start at the access road end (T at end)
      const c0 = best.geometry.coordinates[0];
      const c1 = best.geometry.coordinates[best.geometry.coordinates.length - 1];
      const dist0 = turf.distance(turf.point(c0), turf.point(end), meters);
      const dist1 = turf.distance(turf.point(c1), turf.point(end), meters);
      return dist0 <= dist1 ? best : turf.lineString(best.geometry.coordinates.slice().reverse());
    } catch {
      return null;
    }
  }

  // Bearing of a tiny segment centered at s (meters) along a line
  function tangentBearing(line, sMeters) {
    const total = turf.length(line, meters);
    const d = Math.min(3, Math.max(1, total * 0.02)); // small probe (m)
    const s0 = Math.max(0, sMeters - d / 2);
    const s1 = Math.min(total, sMeters + d / 2);
    const p0 = turf.along(line, s0 / 1000, { units: 'kilometers' });
    const p1 = turf.along(line, s1 / 1000, { units: 'kilometers' });
    return turf.bearing(p0, p1);
  }

  // Build an oriented rectangle centered at pt, width along bearing, depth normal to bearing
  function orientedRect(pt, widthM, depthM, bearingDeg) {
    const halfW = widthM / 2;
    const halfD = depthM / 2;

    // Move from center: first along tangent, then along normal
    const move = (origin, distAlong, distNormal) => {
      const a = turf.destination(origin,  distAlong,  bearingDeg,       meters);
      const b = turf.destination(a,       distNormal, bearingDeg + 90,  meters);
      return b.geometry.coordinates;
    };

    const c1 = move(pt, -halfW, -halfD); // -along, -normal
    const c2 = move(pt,  halfW, -halfD); // +along, -normal
    const c3 = move(pt,  halfW,  halfD); // +along, +normal
    const c4 = move(pt, -halfW,  halfD); // -along, +normal

    return turf.polygon([[c1, c2, c3, c4, c1]]);
  }
}
