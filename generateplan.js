import { $, emptyFC, fc, setStats, getLongestEdgeAngle, unionAll, metersToDeg } from './utils.js';

export function generatePlan(map, siteBoundary) {
  if (!siteBoundary) return alert('Draw the site boundary first.');

  const houseType = $('houseType').value;
  let homeW, homeD, color;
  if (houseType === 't1') { homeW = 5; homeD = 5; color = '#ff9999'; }
  if (houseType === 't2') { homeW = 5; homeD = 8; color = '#99ff99'; }
  if (houseType === 't3') { homeW = 10; homeD = 8; color = '#9999ff'; }

  const front = parseFloat($('frontSetback').value) || 5;
  const side  = parseFloat($('sideGap').value) || 2;
  const rWidth = 5; // fixed road width

  const rawAngle = parseFloat($('rotationAngle').value);
  const angleDeg = Number.isFinite(rawAngle) ? rawAngle : getLongestEdgeAngle(siteBoundary);

  const site = siteBoundary;
  const lat  = turf.center(site).geometry.coordinates[1];
  const { dLat, dLon } = metersToDeg(lat);
  const pivot = turf.center(site).geometry.coordinates;
  const siteRot = turf.transformRotate(site, -angleDeg, { pivot });

  const blockPitchM = homeD + front;
  const roadPitchM  = rWidth + blockPitchM * 2;
  const lotPitchM   = homeW + side;
  const crossPitchM = 5 * lotPitchM + rWidth;

  const lotPitchLon   = lotPitchM   * dLon;
  const crossPitchLon = crossPitchM * dLon;
  const roadPitchLat  = roadPitchM  * dLat;

  const [minX, minY, maxX, maxY] = turf.bbox(siteRot);
  const roadPolys = [];

  for (let y = minY; y <= maxY; y += roadPitchLat) {
    const seg = turf.lineString([[minX - 1, y], [maxX + 1, y]]);
    const buf = turf.buffer(seg, rWidth / 2, { units: 'meters' });
    const inter = turf.intersect(buf, siteRot); if (inter) roadPolys.push(inter);
  }
  for (let x = minX; x <= maxX; x += crossPitchLon) {
    const seg = turf.lineString([[x, minY - 1], [x, maxY + 1]]);
    const buf = turf.buffer(seg, rWidth / 2, { units: 'meters' });
    const inter = turf.intersect(buf, siteRot); if (inter) roadPolys.push(inter);
  }

  let roadsBack = emptyFC();
  if (roadPolys.length) {
    const u = unionAll(roadPolys);
    const roadsRot = fc([u]);
    roadsBack = fc(roadsRot.features.map(f => turf.transformRotate(f, angleDeg, { pivot })));
  }
  map.getSource('roads-view')?.setData(roadsBack);

  let buildable = site;
  if (roadsBack.features.length) {
    const roadsBig = fc(roadsBack.features.map(f => turf.buffer(f, 0.25, { units: 'meters' })));
    const uRoads = unionAll(roadsBig.features);
    const diff = turf.difference(site, uRoads);
    if (diff) buildable = diff;
  }

  const edgeMarginM = 0.6;
  const halfMax = Math.max(homeW, homeD) / 2;
  let placementArea = buildable;
  try {
    const buf = turf.buffer(buildable, -(halfMax + edgeMarginM), { units: 'meters' });
    if (buf && (buf.geometry.type === 'Polygon' || buf.geometry.type === 'MultiPolygon')) {
      placementArea = buf;
    }
  } catch {}

  const { dLat: dLatP, dLon: dLonP } = metersToDeg(turf.center(placementArea).geometry.coordinates[1]);
  const widthLon = homeW * dLonP;
  const depthLat = homeD * dLatP;
  const stepLon  = (homeW + side)  * dLonP;
  const stepLat  = (homeD + front) * dLatP;

  const placeRot = turf.transformRotate(placementArea, -angleDeg, { pivot });
  const [px0, py0, px1, py1] = turf.bbox(placeRot);

  const homes = [];
  for (let x = px0; x <= px1; x += stepLon) {
    for (let y = py0; y <= py1; y += stepLat) {
      const cx = x + stepLon / 2;
      const cy = y + stepLat / 2;
      const halfLon = widthLon / 2;
      const halfLat = depthLat / 2;
      const rect = turf.polygon([[
        [cx - halfLon, cy - halfLat],
        [cx + halfLon, cy - halfLat],
        [cx + halfLon, cy + halfLat],
        [cx - halfLon, cy + halfLat],
        [cx - halfLon, cy - halfLat]
      ]], { height: 4, color });
      if (!turf.booleanWithin(rect, placeRot)) continue;
      homes.push(turf.transformRotate(rect, angleDeg, { pivot }));
    }
  }

  const ha = turf.area(buildable) / 10000;
  map.getSource('homes')?.setData(fc(homes));
  setStats(`
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Rotation:</strong> ${angleDeg.toFixed(1)}°</p>
    <p><strong>Density:</strong> ${(homes.length / (ha || 1)).toFixed(1)} homes/ha</p>
  `);
}
