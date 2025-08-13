// generateplan.js — access road + 2‑way perpendicular spine + one‑row homes
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

  const front = parseFloat($('frontSetback').value) || 5; // gap road→front
  const side  = parseFloat($('sideGap').value)       || 2; // spacing along

  // ---------- road style / geometry params ----------
  const meters = { units: 'meters' };
  const accessWidth = 8;          // m (thicker)
  const localWidth  = 5;          // m (spine thinner)
  const edgeClear   = 6;          // m stop spines before boundary
  const junctionOverlap = localWidth * 0.6; // m pull spine start into access

  // Safe guards
  const isLine = f => f && f.type === 'Feature' && f.geometry?.type === 'LineString';
  const isPoly = f => f && f.type === 'Feature' &&
    (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon');
  if (!isPoly(siteBoundary) || !isLine(entranceRoad)) return;

  // ---------- inset site for "don’t reach boundary" ----------
  let innerSite = siteBoundary;
  try {
    const inset = turf.buffer(siteBoundary, -edgeClear, meters);
    if (inset && (inset.geometry.type === 'Polygon' || inset.geometry.type === 'MultiPolygon')) {
      innerSite = inset;
    }
  } catch { /* keep original */ }

  // ---------- roads collection ----------
  const roads = [];

  // 1) Access road (buffer + clip)
  let accessPoly = null;
  try {
    const buf = turf.buffer(entranceRoad, accessWidth / 2, meters);
    accessPoly = (turf.intersect(buf, siteBoundary) || null);
    if (accessPoly) roads.push(accessPoly);
  } catch (e) { console.warn('buffer access failed', e); }

  // Access road tail bearing (last segment)
  const c = entranceRoad.geometry.coordinates;
  if (c.length < 2) return;
  const end = c[c.length - 1];
  const prev = c[c.length - 2];
  const segBear = turf.bearing(turf.point(prev), turf.point(end)); // along access

  // Start the spine slightly "back" along the access road so the thinner road overlaps
  const junctionStart = turf.destination(turf.point(end), junctionOverlap, segBear + 180, meters);

  // 2) Build TWO perpendicular spines (left & right) and clip to the INSET site
  const spineLeft  = makeSpine(junctionStart, segBear + 90, innerSite);
  const spineRight = makeSpine(junctionStart, segBear - 90, innerSite);

  // Buffer spines to polygons and add
  [spineLeft, spineRight].forEach(sp => {
    if (!sp) return;
    try {
      const buf = turf.buffer(sp, localWidth / 2, meters);
      const clp = turf.intersect(buf, siteBoundary); // clip to full site for visuals
      if (clp) roads.push(clp);
    } catch (e) { console.warn('buffer spine failed', e); }
  });

  // Render roads
  map.getSource('roads-view')?.setData(fc(roads));

  // Expanded roads for “don’t place homes on roads”
  let roadsBig = emptyFC();
  if (roads.length) {
    try {
      const expanded = fc(roads.map(r => turf.buffer(r, 0.25, meters)));
      const unioned  = unionAll(expanded.features);
      roadsBig = fc([unioned]);
    } catch { /* ignore */ }
  }

  // 3) Place one row of homes along BOTH spines (both sides of each), aligned to tangent
  const homes = [];
  [spineLeft, spineRight].forEach(spine => {
    if (!spine) return;
    const L = turf.length(spine, meters);
    if (L <= 0) return;

    const step   = homeW + side;
    const offset = front + homeD / 2;

    for (let s = step / 2; s <= L - step / 2; s += step) {
      const mid   = turf.along(spine, s / 1000, { units: 'kilometers' });
      const tBear = tangentBearing(spine, s);

      // left / right of spine
      const leftC  = turf.destination(mid,  offset, tBear + 90, meters);
      const rightC = turf.destination(mid,  offset, tBear - 90, meters);

      [leftC, rightC].forEach(pt => {
        const rect = orientedRect(pt, homeW, homeD, tBear);
        const inSite = turf.booleanWithin(rect, siteBoundary);
        const onRoad = roadsBig.features.length &&
          turf.booleanOverlap(rect, roadsBig.features[0]);
        if (inSite && !onRoad) {
          rect.properties = { height: 4, color };
          homes.push(rect);
        }
      });
    }
  });

  map.getSource('homes')?.setData(fc(homes));

  // 4) Site‑wide density
  const siteHa = turf.area(siteBoundary) / 10000;
  setStats(`
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Site density:</strong> ${(homes.length / (siteHa || 1)).toFixed(1)} homes/ha</p>
  `);

  // ---------- helpers ----------
  function makeSpine(startPt, bearingDeg, clipPoly) {
    try {
      // Long ray both directions from the junctionStart, keep only inside piece furthest from start
      const far = turf.destination(startPt, 2000, bearingDeg, meters); // 2 km
      const trial = turf.lineString([startPt.geometry.coordinates, far.geometry.coordinates]);
      const seg = clipLineInside(trial, clipPoly);
      return seg || null;
    } catch { return null; }
  }

  // Keep the longest piece inside poly; ensure it starts at the junctionStart
  function clipLineInside(line, poly) {
    try {
      const split = turf.lineSplit(line, poly);
      const inside = (split?.features || []).filter(seg => {
        const mid = turf.along(seg, turf.length(seg, { units: 'kilometers' }) / 2, { units: 'kilometers' });
        return turf.booleanPointInPolygon(mid, poly);
      });
      if (!inside.length) return null;

      // pick longest
      let best = inside[0], bestLen = turf.length(best, meters);
      for (let i = 1; i < inside.length; i++) {
        const L = turf.length(inside[i], meters);
        if (L > bestLen) { best = inside[i]; bestLen = L; }
      }

      // make sure it runs away from the junction (start closest to junctionStart)
      const js = junctionStart.geometry.coordinates;
      const c0 = best.geometry.coordinates[0];
      const c1 = best.geometry.coordinates[best.geometry.coordinates.length - 1];
      const d0 = turf.distance(turf.point(c0), turf.point(js), meters);
      const d1 = turf.distance(turf.point(c1), turf.point(js), meters);
      return d0 <= d1 ? best : turf.lineString(best.geometry.coordinates.slice().reverse());
    } catch { return null; }
  }

  function tangentBearing(line, sMeters) {
    const total = turf.length(line, meters);
    const d = Math.min(3, Math.max(1, total * 0.02));
    const s0 = Math.max(0, sMeters - d / 2);
    const s1 = Math.min(total, sMeters + d / 2);
    const p0 = turf.along(line, s0 / 1000, { units: 'kilometers' });
    const p1 = turf.along(line, s1 / 1000, { units: 'kilometers' });
    return turf.bearing(p0, p1);
  }

  // center‑oriented rectangle: width along bearing, depth normal
  function orientedRect(pt, widthM, depthM, bearingDeg) {
    const halfW = widthM / 2;
    const halfD = depthM / 2;
    const move = (origin, distAlong, distNormal) => {
      const a = turf.destination(origin,  distAlong,  bearingDeg,      meters);
      const b = turf.destination(a,       distNormal, bearingDeg + 90, meters);
      return b.geometry.coordinates;
    };
    const c1 = move(pt, -halfW, -halfD);
    const c2 = move(pt,  halfW, -halfD);
    const c3 = move(pt,  halfW,  halfD);
    const c4 = move(pt, -halfW,  halfD);
    return turf.polygon([[c1, c2, c3, c4, c1]]);
  }
}
