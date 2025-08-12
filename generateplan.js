// generatePlan.js
import { $, emptyFC, fc, setStats, getLongestEdgeAngle, unionAll, metersToDeg } from './utils.js';

export function generatePlan(map, siteBoundary) {
  if (!siteBoundary) return alert('Draw the site boundary first.');

  // ===== 1) Inputs =====
  const houseType = $('houseType').value;
  let homeW, homeD, color;
  if (houseType === 't1') { homeW = 5;  homeD = 5;  color = '#ff9999'; } // 5x5
  if (houseType === 't2') { homeW = 5;  homeD = 8;  color = '#99ff99'; } // 5x8
  if (houseType === 't3') { homeW = 10; homeD = 8;  color = '#9999ff'; } // 10x8

  const front  = parseFloat($('frontSetback').value) || 5; // front/back gap (row spacing)
  const side   = parseFloat($('sideGap').value)       || 2; // left/right gap
  const rWidth = 5; // fixed road width (m)

  const rawAngle = parseFloat($('rotationAngle').value);
  const angleDeg = Number.isFinite(rawAngle) ? rawAngle : getLongestEdgeAngle(siteBoundary);

  // ===== 2) Frames & helpers =====
  const site  = siteBoundary;
  const pivot = turf.center(site).geometry.coordinates;
  const siteRot = turf.transformRotate(site, -angleDeg, { pivot });

  const lat  = turf.center(site).geometry.coordinates[1];
  const { dLat, dLon } = metersToDeg(lat);

  // pitches (in meters)
  const blockPitchM = homeD + front;            // one row depth (+front)
  const lotPitchM   = homeW + side;             // across frontage
  const roadPitchM  = rWidth + blockPitchM * 2; // road after two rows
  const crossPitchM = 5 * lotPitchM + rWidth;   // cross road after N lots (N=5)

  // pitches in degrees in the **rotated** frame
  const lotPitchLon   = lotPitchM   * dLon;     // X-step (across short edge)
  const crossPitchLon = crossPitchM * dLon;     // X spacing between vertical roads
  const roadPitchLat  = roadPitchM  * dLat;     // Y spacing between horizontal roads

  // ===== 3) Roads in rotated frame =====
  const [minX, minY, maxX, maxY] = turf.bbox(siteRot);
  const roadPolys = [];
  const halfRoadM = rWidth / 2;

  // collect centerlines (so we can get block bands)
  const yCenters = [];
  const xCenters = [];

  // Horizontal roads (constant y)
  for (let y = minY; y <= maxY; y += roadPitchLat) {
    yCenters.push(y);
    const seg = turf.lineString([[minX - 1, y], [maxX + 1, y]]);
    const buf = turf.buffer(seg, halfRoadM, { units: 'meters' });
    const inter = turf.intersect(buf, siteRot);
    if (inter) roadPolys.push(inter);
  }

  // Vertical roads (constant x)
  for (let x = minX; x <= maxX; x += crossPitchLon) {
    xCenters.push(x);
    const seg = turf.lineString([[x, minY - 1], [x, maxY + 1]]);
    const buf = turf.buffer(seg, halfRoadM, { units: 'meters' });
    const inter = turf.intersect(buf, siteRot);
    if (inter) roadPolys.push(inter);
  }

  // Union & rotate roads back to map frame
  let roadsBack = emptyFC();
  if (roadPolys.length) {
    const u = unionAll(roadPolys);
    const roadsRot = fc([u]);
    roadsBack = fc(roadsRot.features.map(f => turf.transformRotate(f, angleDeg, { pivot })));
  }
  map.getSource('roads-view')?.setData(roadsBack);

  // ===== 4) Buildable = site − roads(+safety) =====
  let buildable = site;
  if (roadsBack.features.length) {
    const roadsBig = fc(roadsBack.features.map(f => turf.buffer(f, 0.25, { units: 'meters' }))); // safety
    const uRoads   = unionAll(roadsBig.features);
    try {
      const diff = turf.difference(site, uRoads);
      if (diff) buildable = diff;
    } catch (e) {
      console.warn('difference(site, roads) failed; using full site', e);
    }
  }

  // inset so full rectangles fit
  const edgeMarginM = 0.6;
  const halfMax = Math.max(homeW, homeD) / 2;
  let placementArea = buildable;
  try {
    const buf = turf.buffer(buildable, -(halfMax + edgeMarginM), { units: 'meters' });
    if (buf && (buf.geometry.type === 'Polygon' || buf.geometry.type === 'MultiPolygon')) {
      placementArea = buf;
    }
  } catch {}

  // Rotate that placement area to axis space for block cutting
  const placeRot = turf.transformRotate(placementArea, -angleDeg, { pivot });

  // ===== 5) Fill **every block** between roads =====
  if (yCenters.length === 0) yCenters.push((minY + maxY) / 2);
  if (xCenters.length === 0) xCenters.push((minX + maxX) / 2);

  const halfRoadLat  = (rWidth / 2) * dLat;
  const halfRoadLon  = (rWidth / 2) * dLon;

  yCenters.sort((a,b) => a - b);
  xCenters.sort((a,b) => a - b);

  const yBands = [];
  {
    let prevEdge = minY;
    for (let i = 0; i < yCenters.length; i++) {
      const top = yCenters[i] - halfRoadLat;
      if (top > prevEdge) yBands.push([prevEdge, top]);
      prevEdge = yCenters[i] + halfRoadLat;
    }
    if (prevEdge < maxY) yBands.push([prevEdge, maxY]);
  }

  const xBands = [];
  {
    let prevEdge = minX;
    for (let i = 0; i < xCenters.length; i++) {
      const left = xCenters[i] - halfRoadLon;
      if (left > prevEdge) xBands.push([prevEdge, left]);
      prevEdge = xCenters[i] + halfRoadLon;
    }
    if (prevEdge < maxX) xBands.push([prevEdge, maxX]);
  }

  // Housing step in rotated frame
  const areaLat = turf.center(placementArea).geometry.coordinates[1];
  const { dLat: dLatP, dLon: dLonP } = metersToDeg(areaLat);
  const widthLon = Math.max(1e-9, homeW * dLonP);
  const depthLat = Math.max(1e-9, homeD * dLatP);
  const stepLon  = Math.max(1e-9, (homeW + side)  * dLonP);
  const stepLat  = Math.max(1e-9, (homeD + front) * dLatP);

  const homes = [];

  for (const [y0, y1] of yBands) {
    for (const [x0, x1] of xBands) {
      if (x1 - x0 <= widthLon || y1 - y0 <= depthLat) continue;

      const block = turf.polygon([[
        [x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]
      ]]);

      const clipped = turf.intersect(block, placeRot);
      if (!clipped) continue;

      const [bx0, by0, bx1, by1] = turf.bbox(clipped);

      const cols  = Math.ceil((bx1 - bx0) / stepLon);
      const rows  = Math.ceil((by1 - by0) / stepLat);
      const cells = cols * rows;
      const MAX_CELLS = 25000;
      const scale = cells > MAX_CELLS ? Math.sqrt(cells / MAX_CELLS) : 1;

      // --- two fixed rows per band (edge‑anchored) ---
      const frontLat = front * dLatP;
      const rowInset = frontLat / 2 + depthLat / 2;     // (front/2 + half‑depth)
      const rowCY_A  = by0 + rowInset;                  // bottom row center (near lower road)
      const rowCY_B  = by1 - rowInset;                  // top row center (near upper road)
      const placeTwo = (rowCY_B - rowCY_A) >= depthLat; // enough space for two rows?

      for (let x = bx0; x <= bx1; x += stepLon * scale) {
        const cx = x + (stepLon * scale) / 2;
        const halfLon = widthLon / 2;
        const halfLat = depthLat / 2;

        const targets = placeTwo ? [rowCY_A, rowCY_B] : [ (by0 + by1) / 2 ];

        for (const cy of targets) {
          const rect = turf.polygon([[
            [cx - halfLon, cy - halfLat],
            [cx + halfLon, cy - halfLat],
            [cx + halfLon, cy + halfLat],
            [cx - halfLon, cy + halfLat],
            [cx - halfLon, cy - halfLat]
          ]], { height: 4, color });

          if (turf.booleanWithin(rect, clipped)) {
            homes.push(turf.transformRotate(rect, angleDeg, { pivot }));
          }
        }
      }
      // -----------------------------------------------
    }
  }

  // ===== 6) Render + stats =====
  const ha = turf.area(buildable) / 10000;
  map.getSource('homes')?.setData(fc(homes));
  setStats(`
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Rotation:</strong> ${angleDeg.toFixed(1)}°</p>
    <p><strong>Density:</strong> ${(homes.length / (ha || 1)).toFixed(1)} homes/ha</p>
  `);
}
