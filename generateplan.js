// generateplan.js — uses the access road to carve buildable, then fills homes
import { $, emptyFC, fc, setStats, getLongestEdgeAngle, unionAll, metersToDeg } from './utils.js';
import { createRoads } from './createroads.js';

export function generatePlan(map, siteBoundary, entranceRoad) {
  if (!siteBoundary) return alert('Draw the site boundary first.');

  // ===== 1) Inputs =====
  const houseType = $('houseType').value;
  let homeW, homeD, color;
  if (houseType === 't1') { homeW = 5;  homeD = 5;  color = '#ff9999'; }
  if (houseType === 't2') { homeW = 5;  homeD = 8;  color = '#99ff99'; }
  if (houseType === 't3') { homeW = 10; homeD = 8;  color = '#9999ff'; }

  const front  = parseFloat($('frontSetback').value) || 5;
  const side   = parseFloat($('sideGap').value)       || 2;

  const rawAngle = parseFloat(($('rotationAngle')?.value ?? '').trim());
  const angleDeg = Number.isFinite(rawAngle) ? rawAngle : getLongestEdgeAngle(siteBoundary);

  // ===== 2) Roads (ONLY the user access road, curved allowed) =====
  let roadsFC = emptyFC();
  try {
    if (entranceRoad) {
      roadsFC = createRoads(siteBoundary, entranceRoad, { mainRoadWidth: 8 });
    }
  } catch (e) {
    console.warn('createRoads failed; continuing without roads', e);
    roadsFC = emptyFC();
  }
  map.getSource('roads-view')?.setData(roadsFC);

  // ===== 3) Buildable = site − roads (slight safety buffer) =====
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

  // ===== 4) Inset so full rectangles fit =====
  const edgeMarginM = 0.6;
  const halfMax = Math.max(homeW, homeD) / 2;
  let placementArea = buildable;
  try {
    const buf = turf.buffer(buildable, -(halfMax + edgeMarginM), { units: 'meters' });
    if (buf && (buf.geometry.type === 'Polygon' || buf.geometry.type === 'MultiPolygon')) {
      placementArea = buf;
    }
  } catch { /* keep buildable */ }

  // ===== 5) Fill homes on a rotated rect grid (aligned to angleDeg) =====
  const pivot = turf.center(site).geometry.coordinates;
  const placeRot = turf.transformRotate(placementArea, -angleDeg, { pivot });

  const lat  = turf.center(placeRot).geometry.coordinates[1];
  const { dLat, dLon } = metersToDeg(lat);

  const widthLon = Math.max(1e-9, homeW * dLon);
  const depthLat = Math.max(1e-9, homeD * dLat);
  const stepLon  = Math.max(1e-9, (homeW + side)  * dLon);
  const stepLat  = Math.max(1e-9, (homeD + front) * dLat);

  const [px0, py0, px1, py1] = turf.bbox(placeRot);
  const homes = [];

  for (let x = px0; x <= px1; x += stepLon) {
    for (let y = py0; y <= py1; y += stepLat) {
      const cx = x + stepLon / 2;
      const cy = y + stepLat / 2;
      const rect = turf.polygon([[
        [cx - widthLon/2, cy - depthLat/2],
        [cx + widthLon/2, cy - depthLat/2],
        [cx + widthLon/2, cy + depthLat/2],
        [cx - widthLon/2, cy + depthLat/2],
        [cx - widthLon/2, cy - depthLat/2]
      ]], { height: 4, color });
      if (!turf.booleanWithin(rect, placeRot)) continue;
      homes.push(turf.transformRotate(rect, angleDeg, { pivot }));
    }
  }

  // ===== 6) Render + site-wide density =====
  const siteHa = turf.area(siteBoundary) / 10000;
  map.getSource('homes')?.setData(fc(homes));
  setStats(`
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Rotation:</strong> ${angleDeg.toFixed(1)}°</p>
    <p><strong>Site density:</strong> ${(homes.length / (siteHa || 1)).toFixed(1)} homes/ha</p>
  `);
}
