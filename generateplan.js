// generateplan.js
import { $, emptyFC, fc, setStats, getLongestEdgeAngle, unionAll, metersToDeg } from './utils.js';
import { createRoads } from './createRoads.js';

export function generatePlan(map, siteBoundary, entranceRoad) {
  if (!siteBoundary) return alert('Draw the site boundary first.');

  // ===== 1) Inputs =====
  const houseType = $('houseType').value;
  let homeW, homeD, color;
  if (houseType === 't1') { homeW = 5;  homeD = 5;  color = '#ff9999'; } // 5x5
  if (houseType === 't2') { homeW = 5;  homeD = 8;  color = '#99ff99'; } // 5x8
  if (houseType === 't3') { homeW = 10; homeD = 8;  color = '#9999ff'; } // 10x8

  const front  = parseFloat($('frontSetback').value) || 5;
  const side   = parseFloat($('sideGap').value)       || 2;

  const rawAngle = parseFloat($('rotationAngle').value);
  const angleDeg = Number.isFinite(rawAngle) ? rawAngle : getLongestEdgeAngle(siteBoundary);

  // ===== 2) Roads (from entrance + simple blocks for now) =====
  let roadsFC = emptyFC();
  try {
    if (entranceRoad) {
      roadsFC = createRoads(siteBoundary, entranceRoad, {
        mainRoadWidth: 8,
        localRoadWidth: 5,
        blockDepth: (homeD + front) * 2,      // space for two rows between parallel roads
        blockWidth: (homeW + side) * 5 + 5    // 5 lots + local road
      });
    } else {
      // Fallback tiny grid if user hasn’t drawn an entrance road yet
      roadsFC = createRoads(
        siteBoundary,
        // make a short “fake” entrance from site centroid to north
        turf.lineString([
          turf.center(siteBoundary).geometry.coordinates,
          turf.destination(turf.center(siteBoundary).geometry.coordinates, 30, 0, { units: 'meters' }).geometry.coordinates
        ]),
        {
          mainRoadWidth: 8,
          localRoadWidth: 5,
          blockDepth: (homeD + front) * 2,
          blockWidth: (homeW + side) * 5 + 5
        }
      );
    }
  } catch (e) {
    console.warn('createRoads failed; continuing without roads', e);
    roadsFC = emptyFC();
  }

  map.getSource('roads-view')?.setData(roadsFC);

  // ===== 3) Buildable = site − roads (slight safety buffer so homes don’t touch roads) =====
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
  } catch {}

  // Rotate placement area to make a straight grid aligned to angleDeg
  const pivot = turf.center(site).geometry.coordinates;
  const placeRot = turf.transformRotate(placementArea, -angleDeg, { pivot });

  // ===== 5) Fill each block between roads (derived from roadsFC) =====
  // We’ll derive block bands the same way we did before, by stepping,
  // but we’ll do it against the site frame rotated to angleDeg.

  // Prepare a synthetic set of band lines using pitches implied by house sizes
  const lat  = turf.center(site).geometry.coordinates[1];
  const { dLat, dLon } = metersToDeg(lat);

  // Grid pitches
  const lotPitchM   = homeW + side;
  const blockPitchM = homeD + front;       // one row + front
  const roadWidthM  = 5;                   // local roads in the grid we imply for bands

  // Convert to deg in rotated frame
  const lotPitchLon  = lotPitchM  * dLon;
  const rowPitchLat  = (roadWidthM + 2 * blockPitchM) * dLat; // road every two rows

  const [minX, minY, maxX, maxY] = turf.bbox(turf.transformRotate(site, -angleDeg, { pivot }));

  // Build Y bands by subtracting a road thickness around centerlines
  const yCenters = [];
  for (let y = minY; y <= maxY; y += rowPitchLat) yCenters.push(y);

  const halfRoadLat = (roadWidthM / 2) * dLat;

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

  // X “bands” we just use whole width; homes step across on lotPitchLon
  const xBands = [[minX, maxX]];

  // Home step in rotated frame
  const areaLat = turf.center(placementArea).geometry.coordinates[1];
  const { dLat: dLatP, dLon: dLonP } = metersToDeg(areaLat);
  const widthLon = Math.max(1e-9, homeW * dLonP);
  const depthLat = Math.max(1e-9, homeD * dLatP);
  const stepLon  = Math.max(1e-9, lotPitchLon * (dLonP / dLon));    // keep relative spacing
  const stepLat  = Math.max(1e-9, (homeD + front) * dLatP);

  const homes = [];

  for (const [y0, y1] of yBands) {
    for (const [x0, x1] of xBands) {
      if (x1 - x0 <= widthLon || y1 - y0 <= depthLat) continue;

      // Clip the rectangular band to the rotated placement area
      const block = turf.polygon([[
        [x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]
      ]]);
      const clipped = turf.intersect(block, placeRot);
      if (!clipped) continue;

      const [bx0, by0, bx1, by1] = turf.bbox(clipped);

      // Two rows per band: one near each road edge, if there’s space
      const frontLat = front * dLatP;
      const rowInset = frontLat / 2 + depthLat / 2;
      const rowCY_A  = by0 + rowInset;
      const rowCY_B  = by1 - rowInset;
      const placeTwo = (rowCY_B - rowCY_A) >= depthLat;

      for (let x = bx0; x <= bx1; x += stepLon) {
        const cx = x + stepLon / 2;
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
    }
  }

  // ===== 6) Render + stats (density over whole site) =====
  const siteHa = turf.area(siteBoundary) / 10000;
  map.getSource('homes')?.setData(fc(homes));
  setStats(`
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Rotation:</strong> ${angleDeg.toFixed(1)}°</p>
    <p><strong>Site density:</strong> ${(homes.length / (siteHa || 1)).toFixed(1)} homes/ha</p>
  `);
}
