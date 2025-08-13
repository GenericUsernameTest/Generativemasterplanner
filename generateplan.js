// generateplan.js — access road + perpendicular spine + single-row homes along spine
import { $, emptyFC, fc, setStats, getLongestEdgeAngle, unionAll, metersToDeg } from './utils.js';
import { createRoads } from './createroads.js';

export function generatePlan(map, siteBoundary, accessLine) {
  if (!siteBoundary) return alert('Draw the site boundary first.');

  // ===== 1) Inputs =====
  const houseType = $('houseType').value;
  let homeW, homeD, color;
  if (houseType === 't1') { homeW = 5;  homeD = 5;  color = '#ff9999'; }
  if (houseType === 't2') { homeW = 5;  homeD = 8;  color = '#99ff99'; }
  if (houseType === 't3') { homeW = 10; homeD = 8;  color = '#9999ff'; }

  const front = parseFloat($('frontSetback').value) || 5;  // front/back gap
  const side  = parseFloat($('sideGap').value)       || 2;  // left/right gap

  const rawAngle = parseFloat(($('rotationAngle')?.value ?? '').trim());
  const angleDeg = Number.isFinite(rawAngle) ? rawAngle : getLongestEdgeAngle(siteBoundary);

  // ===== 2) Roads (access + single perpendicular spine) =====
  let roadsFC = emptyFC();
  let spineLine = null;

  try {
    if (accessLine) {
      const out = createRoads(siteBoundary, accessLine, {
        mainRoadWidth: 8,
        spineRoadWidth: 6
      });
      roadsFC   = out.polys || emptyFC();
      spineLine = out.spine || null;
    }
  } catch (e) {
    console.warn('createRoads failed; continuing without roads', e);
    roadsFC = emptyFC();
    spineLine = null;
  }
  map.getSource('roads-view')?.setData(roadsFC);

  // ===== 3) Buildable = site − roads (small safety buffer) =====
  const site = siteBoundary;
  let buildable = site;
  if (roadsFC.features?.length) {
    try {
      const roadsBig = fc(roadsFC.features.map(f => turf.buffer(f, 0.25, { units: 'meters' })));
      const uRoads   = unionAll(roadsBig.features);
      const diff     = turf.difference(site, uRoads);
      if (diff) buildable = diff;
    } catch (e) {
      console.warn('difference(site, roads) failed; using full site', e);
    }
  }

  // ===== 4) If we have a spine, place ONE ROW of homes each side, aligned to the spine =====
  const homes = [];

  if (spineLine) {
    // Spacing and offsets
    const lat = turf.center(site).geometry.coordinates[1];
    const { dLat, dLon } = metersToDeg(lat);

    const stepM = homeW + side;          // spacing along the row (frontages)
    const offsetM = front + homeD / 2;   // distance from spine centerline to house center

    // Left and right offset lines from the spine
    const leftLine  = safeOffset(spineLine,  offsetM);
    const rightLine = safeOffset(spineLine, -offsetM);

    // Place along each side
    if (leftLine)  placeRowAlong(leftLine);
    if (rightLine) placeRowAlong(rightLine);
  }

  // Fallback: no spine → nothing (you asked specifically for spine-driven fill)

  // ===== 5) Render + site-wide density =====
  const siteHa = turf.area(siteBoundary) / 10000;
  map.getSource('homes')?.setData(fc(homes));
  setStats(`
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Rotation (fallback only):</strong> ${angleDeg.toFixed(1)}°</p>
    <p><strong>Site density:</strong> ${(homes.length / (siteHa || 1)).toFixed(1)} homes/ha</p>
  `);

  // ---- helpers for oriented placement ----
  function placeRowAlong(line){
    const len = turf.length(line, { units: 'meters' });
    if (!(len > 0)) return;

    const step = Math.max(1, homeW + side); // meters between house centers
    for (let s = step/2; s <= len - step/2; s += step) {
      const center = turf.along(line, s / 1000, { units: 'kilometers' });
      const bearing = nearestSegmentBearing(spineLine, center);

      const rect = orientedRect(center, homeW, homeD, bearing);
      // keep inside buildable (and not on road)
      if (turf.booleanWithin(rect, buildable)) {
        rect.properties = { height: 4, color };
        homes.push(rect);
      }
    }
  }

  function orientedRect(centerPt, widthM, depthM, bearingDeg){
    // Build corners by moving forward/back along bearing and offsetting sideways by width/2
    const c = centerPt;
    const f = turf.destination(c, depthM / 2, bearingDeg, { units: 'meters' });
    const b = turf.destination(c, depthM / 2, bearingDeg + 180, { units: 'meters' });

    const leftBearing  = bearingDeg + 90;
    const rightBearing = bearingDeg - 90;

    const fl = turf.destination(f, widthM / 2, leftBearing,  { units: 'meters' });
    const fr = turf.destination(f, widthM / 2, rightBearing, { units: 'meters' });
    const br = turf.destination(b, widthM / 2, rightBearing, { units: 'meters' });
    const bl = turf.destination(b, widthM / 2, leftBearing,  { units: 'meters' });

    return turf.polygon([[
      fl.geometry.coordinates,
      fr.geometry.coordinates,
      br.geometry.coordinates,
      bl.geometry.coordinates,
      fl.geometry.coordinates
    ]]);
  }

  function nearestSegmentBearing(baseLine, pt){
    // Snap to baseLine to get segment index and direction
    try {
      const snap = turf.nearestPointOnLine(baseLine, pt, { units: 'meters' });
      const idx = snap?.properties?.index ?? 0;
      const coords = baseLine.geometry.coordinates;
      const i0 = Math.max(0, Math.min(coords.length - 2, idx));
      const p0 = turf.point(coords[i0]);
      const p1 = turf.point(coords[i0+1]);
      const b  = turf.bearing(p0, p1);
      return Number.isFinite(b) ? b : 0;
    } catch {
      return 0;
    }
  }

  function safeOffset(line, distM){
    try {
      return turf.lineOffset(line, distM, { units: 'meters' });
    } catch {
      // small segments can make lineOffset unhappy; approximate with a buffered band centerline
      return null;
    }
  }
}
