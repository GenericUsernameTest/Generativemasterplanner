// generateplan.js — T-junction spine off access road, flat-end join, homes one row deep

import { $, emptyFC, fc, setStats, metersToDeg } from './utils.js';

export function generatePlan(map, siteBoundary, entranceRoad) {
  if (!siteBoundary || !entranceRoad) {
    return alert('Draw the site boundary and the access road first.');
  }

  // ===== 1) Inputs =====
  const houseType = $('houseType').value;
  let homeW, homeD, color;
  if (houseType === 't1') { homeW = 5;  homeD = 5;  color = '#88aaff'; }
  if (houseType === 't2') { homeW = 5;  homeD = 8;  color = '#88ffaa'; }
  if (houseType === 't3') { homeW = 10; homeD = 8;  color = '#ff88aa'; }

  const front  = parseFloat($('frontSetback').value) || 5;
  const side   = parseFloat($('sideGap').value)       || 2;
  const meters = { units: 'meters' };

  const accessWidth = 8;
  const localWidth  = 6;

  // ===== 2) Build Access Road polygon (with flat end) =====
  const roads = [];

  let accessPoly = null;
  try {
    const coords = entranceRoad.geometry.coordinates;
    const end   = coords[coords.length - 1];
    const prev  = coords[coords.length - 2];
    const segBear = turf.bearing(turf.point(prev), turf.point(end));

    const buf = turf.buffer(entranceRoad, accessWidth / 2, meters);
    const clippedToSite = turf.intersect(buf, siteBoundary) || buf;

    // junctionStart = start of spine road
    const junctionStart =
      turf.destination(turf.point(end), localWidth * 0.6, segBear + 180, meters);

    // giant rectangle to chop the round cap off
    const flatClip = flatEndClip(junctionStart, segBear, 6000, 4000);

    accessPoly = turf.intersect(clippedToSite, flatClip) || clippedToSite;
    roads.push(accessPoly);
  } catch (e) {
    console.warn('Access road generation failed', e);
  }

  // ===== 3) Build Spine Road polygon (both directions, stop short of boundary) =====
  if (accessPoly) {
    const coords = entranceRoad.geometry.coordinates;
    const end   = coords[coords.length - 1];
    const prev  = coords[coords.length - 2];
    const segBear = turf.bearing(turf.point(prev), turf.point(end));

    const spineBear = segBear + 90;

    // two long lines left & right from junctionStart
    const maxLen = 9999; // just something huge to ensure it hits the site
    const spineLineLeft = turf.lineString([
      turf.destination(junctionStart, maxLen, spineBear, meters).geometry.coordinates,
      junctionStart.geometry.coordinates
    ]);
    const spineLineRight = turf.lineString([
      junctionStart.geometry.coordinates,
      turf.destination(junctionStart, maxLen, spineBear + 180, meters).geometry.coordinates
    ]);

    // merge, clip to site, and shorten ends
    let both = turf.lineString([
      ...spineLineLeft.geometry.coordinates.reverse(),
      ...spineLineRight.geometry.coordinates.slice(1)
    ]);
    let inside = turf.lineIntersect(both, siteBoundary); // crude
    // instead: buffer then intersect
    const buf = turf.buffer(both, localWidth / 2, meters);
    const clipped = turf.intersect(buf, siteBoundary);
    if (clipped) roads.push(clipped);
  }

  // ===== 4) Buildable area = site − roads =====
  let buildable = siteBoundary;
  if (roads.length) {
    try {
      const uRoads = fc(roads);
      const uPoly = roads.length > 1 ? turf.union(...uRoads.features) : uRoads.features[0];
      const diff = turf.difference(siteBoundary, uPoly);
      if (diff) buildable = diff;
    } catch (e) {
      console.warn('difference(site, roads) failed', e);
    }
  }

  // ===== 5) Homes along spine road (1 row each side) =====
  const homes = [];
  try {
    const roadLine = turf.lineString(entranceRoad.geometry.coordinates);
    const coords = roadLine.geometry.coordinates;
    const end   = coords[coords.length - 1];
    const prev  = coords[coords.length - 2];
    const segBear = turf.bearing(turf.point(prev), turf.point(end));

    const spineBear = segBear + 90;

    const lat  = turf.center(siteBoundary).geometry.coordinates[1];
    const { dLat, dLon } = metersToDeg(lat);
    const stepLon  = (homeW + side)  * dLon;
    const widthLon = homeW * dLon;
    const depthLat = homeD * dLat;

    const sideOffsetM = front + homeD / 2 + localWidth / 2;

    // get both spine directions for placement
    roads.forEach(rpoly => {
      const centerline = turf.center(rpoly).geometry.coordinates; // crude
    });

    // Here just fake it: place homes along bounding box edges of spine
    // (You can replace with real spine polyline extraction later)
    const spinePoly = roads[1]; // second is spine
    if (spinePoly) {
      const bbox = turf.bbox(spinePoly);
      const yMid = (bbox[1] + bbox[3]) / 2;
      for (let x = bbox[0]; x <= bbox[2]; x += stepLon) {
        // north side
        const rectN = turf.polygon([[
          [x - widthLon/2, yMid + dLat * sideOffsetM],
          [x + widthLon/2, yMid + dLat * sideOffsetM],
          [x + widthLon/2, yMid + dLat * sideOffsetM + depthLat],
          [x - widthLon/2, yMid + dLat * sideOffsetM + depthLat],
          [x - widthLon/2, yMid + dLat * sideOffsetM]
        ]], { height: 4, color });
        if (turf.booleanWithin(rectN, buildable)) homes.push(rectN);

        // south side
        const rectS = turf.polygon([[
          [x - widthLon/2, yMid - dLat * sideOffsetM],
          [x + widthLon/2, yMid - dLat * sideOffsetM],
          [x + widthLon/2, yMid - dLat * sideOffsetM - depthLat],
          [x - widthLon/2, yMid - dLat * sideOffsetM - depthLat],
          [x - widthLon/2, yMid - dLat * sideOffsetM]
        ]], { height: 4, color });
        if (turf.booleanWithin(rectS, buildable)) homes.push(rectS);
      }
    }
  } catch (e) {
    console.warn('home placement failed', e);
  }

  // ===== 6) Render =====
  map.getSource('roads-view')?.setData(fc(roads));
  map.getSource('homes')?.setData(fc(homes));

  const siteHa = turf.area(siteBoundary) / 10000;
  setStats(`
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Site density:</strong> ${(homes.length / (siteHa || 1)).toFixed(1)} homes/ha</p>
  `);
}

// ---------- helpers ----------
function flatEndClip(atPt, bearingDeg, depthM = 6000, widthM = 4000) {
  const ctr = turf.destination(atPt, depthM / 2, bearingDeg + 180, { units: 'meters' });
  return orientedRect(ctr, widthM, depthM, bearingDeg);
}

function orientedRect(pt, widthM, depthM, bearingDeg) {
  const meters = { units: 'meters' };
  const halfW = widthM / 2, halfD = depthM / 2;
  const move = (origin, along, normal) => {
    const a = turf.destination(origin, along,  bearingDeg,      meters);
    const b = turf.destination(a,      normal, bearingDeg + 90, meters);
    return b.geometry.coordinates;
  };
  const c1 = move(pt, -halfD, -halfW);
  const c2 = move(pt,  halfD, -halfW);
  const c3 = move(pt,  halfD,  halfW);
  const c4 = move(pt, -halfD,  halfW);
  return turf.polygon([[c1, c2, c3, c4, c1]]);
}
