// generateplan.js — access road + perpendicular spine (T), then 1-row homes
import { $, emptyFC, fc, setStats, getLongestEdgeAngle, unionAll, metersToDeg } from './utils.js';
import { createRoads } from './createroads.js';

export function generatePlan(map, siteBoundary, entranceRoad) {
  if (!siteBoundary) return alert('Draw the site boundary first.');

  // ===== Inputs =====
  const houseType = $('houseType').value;
  let homeW, homeD, color;
  if (houseType === 't1') { homeW = 5;  homeD = 5;  color = '#9db7ff'; }
  if (houseType === 't2') { homeW = 5;  homeD = 8;  color = '#9dd7b0'; }
  if (houseType === 't3') { homeW = 10; homeD = 8;  color = '#d4a8ff'; }

  const front = parseFloat($('frontSetback').value) || 6;
  const side  = parseFloat($('sideGap').value)      || 3;

  const rawAngle = parseFloat(($('rotationAngle')?.value ?? '').trim());
  const angleDeg = Number.isFinite(rawAngle) ? rawAngle : getLongestEdgeAngle(siteBoundary);

  // ===== Roads — build access first =====
  const ACCESS_W = 8;  // m
  const SPINE_W  = 6;  // m
  const SPINE_TRIM = 10; // m back from the inset boundary at both ends

  // Slight inset for all “buildable” ops so roads/homes don’t kiss the site edge
  const siteInset = safe(()=>turf.buffer(siteBoundary, -1.0, {units:'meters'})) || siteBoundary;

  let accessRes = { roadsFC: emptyFC(), junction: null, accessBearing: NaN };
  if (entranceRoad) {
    accessRes = createRoads(siteInset, entranceRoad, { mainRoadWidth: ACCESS_W });
  }

  // draw access polygon(s)
  const roadsPieces = [...(accessRes.roadsFC.features || [])];

  // ===== Perpendicular spine through the junction =====
  if (accessRes.junction && Number.isFinite(accessRes.accessBearing)) {
    const j = accessRes.junction.geometry.coordinates;
    const b = accessRes.accessBearing; // degrees

    // very long perpendicular through the junction (both sides)
    const a = turf.destination(j, 2000, b + 90, {units:'meters'}).geometry.coordinates;
    const c = turf.destination(j, 2000, b - 90, {units:'meters'}).geometry.coordinates;
    const longPerp = turf.lineString([a, j, c]);

    // find where this line hits the inset polygon boundary
    const boundary = turf.polygonToLine(siteInset);
    const hits = turf.lineIntersect(longPerp, boundary);
    let spineCenter = null;

    if (hits.features.length >= 2) {
      // order intersections along the long line: pick the two farthest apart around the junction
      const pts = hits.features.map(f=>f.geometry.coordinates);
      // sort by distance to 'a' (start of longPerp); keep first & last
      pts.sort((p1,p2)=> turf.distance(a,p1) - turf.distance(a,p2));
      const pStart = pts[0], pEnd = pts[pts.length-1];
      const rawSpine = turf.lineString([pStart, pEnd]);

      // trim back from both ends so the spine doesn’t touch the boundary
      const rawLen = turf.length(rawSpine, {units:'meters'});
      const trimmed = (rawLen > SPINE_TRIM*2)
        ? turf.lineSliceAlong(rawSpine, SPINE_TRIM/1000, (rawLen-SPINE_TRIM)/1000, {units:'kilometers'})
        : rawSpine;

      spineCenter = trimmed;
    }

    if (spineCenter) {
      const spinePoly = lineToRect(spineCenter, SPINE_W);
      roadsPieces.push(spinePoly);

      // Now make the access end **flat** and meet at the spine center:
      // Recompute access rectangle ONLY up to junction point (so it stops at center).
      const accessLineUpToJ = cutAccessAtJunction(entranceRoad, siteInset, j);
      if (accessLineUpToJ) {
        const accessRect = lineToRect(accessLineUpToJ, ACCESS_W);
        // Replace previous access piece(s) with this single, clean rectangle
        // (just keep the latest at the end)
        roadsPieces.length = 0;
        roadsPieces.push(accessRect, spinePoly);
      }
    }
  }

  const roadsFC = fc(roadsPieces);
  map.getSource('roads-view')?.setData(roadsFC);

  // ===== Buildable = site − roads(+small buffer) =====
  let buildable = siteBoundary;
  if (roadsFC.features.length) {
    buildable = safe(()=>{
      const roadsBig = fc(roadsFC.features.map(f=>turf.buffer(f, 0.25, {units:'meters'})));
      const uRoads   = unionAll(roadsBig.features);
      return turf.difference(siteBoundary, uRoads) || siteBoundary;
    }) || siteBoundary;
  }

  // Extra inset so homes fully fit
  const EDGE_M = 0.6;
  const halfMax = Math.max(homeW, homeD)/2;
  const placementArea = safe(()=>turf.buffer(buildable, -(halfMax + EDGE_M), {units:'meters'})) || buildable;

  // ===== Fill 1 row each side of the spine only =====
  const pivot = turf.center(siteBoundary).geometry.coordinates;
  const lat  = turf.center(placementArea).geometry.coordinates[1];
  const { dLat, dLon } = metersToDeg(lat);
  const widthLon = Math.max(1e-9, homeW * dLon);
  const depthLat = Math.max(1e-9, homeD * dLat);
  const stepLon  = Math.max(1e-9, (homeW + side)  * dLon);
  const frontLat = front * dLat;

  const homes = [];

  // find the spine back (we added it last or near last)
  const spine = roadsPieces.find(p => p && p.geometry && p.geometry.type === 'Polygon'); // rough
  // Better: reconstruct the spine centerline by shrinking the spine polygon a lot and skeletonizing
  // For now, we use its bbox + angle grid to place rows parallel to the spine direction:
  if (spine) {
    // Get an approximate orientation from the access bearing +/- 90
    const rowAngle = (accessRes.accessBearing || 0) + 90; // rows run along the spine
    const placeRot = turf.transformRotate(placementArea, -rowAngle, { pivot });

    const [x0,y0,x1,y1] = turf.bbox(placeRot);
    for (let x = x0; x <= x1; x += stepLon) {
      // place two rows, offset from the spine center region
      // We’ll simply skip any rect that intersects roads
      for (let y of [y0 + frontLat/2, y1 - frontLat/2]) {
        const rect = turf.polygon([[
          [x - widthLon/2, y - depthLat/2],
          [x + widthLon/2, y - depthLat/2],
          [x + widthLon/2, y + depthLat/2],
          [x - widthLon/2, y + depthLat/2],
          [x - widthLon/2, y - depthLat/2]
        ]], { height: 4, color });

        if (!turf.booleanWithin(rect, placeRot)) continue;

        // Avoid homes overlapping roads
        const rectBack = turf.transformRotate(rect, rowAngle, { pivot });
        if (turf.intersect(rectBack, roadsFC)) continue;

        homes.push(rectBack);
      }
    }
  }

  // ===== Render + stats =====
  map.getSource('homes')?.setData(fc(homes));
  const siteHa = turf.area(siteBoundary)/10000;
  setStats(`
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Rotation:</strong> ${angleDeg.toFixed(1)}°</p>
    <p><strong>Site density:</strong> ${(homes.length/(siteHa||1)).toFixed(1)} homes/ha</p>
  `);

  // ===== helpers =====
  function safe(fn){ try { return fn(); } catch { return null; } }
  function lineToRect(line, widthM){
    const left  = turf.lineOffset(line,  +widthM/2, {units:'meters'});
    const right = turf.lineOffset(line,  -widthM/2, {units:'meters'});
    const ring = [
      ...left.geometry.coordinates,
      ...right.geometry.coordinates.slice().reverse(),
      left.geometry.coordinates[0]
    ];
    return turf.polygon([ring]);
  }

  // Cut the original drawn access line strictly to the piece from its start to the given junction (lon/lat)
  function cutAccessAtJunction(userLine, clipPoly, junctionLonLat){
    // Smooth + clip inside first, then truncate at junction
    const sm = safe(()=>turf.bezierSpline(userLine, {sharpness:0.2, resolution:10000})) || userLine;
    const inside = safe(()=>{
      const parts = turf.lineSplit(sm, clipPoly);
      if (!parts?.features?.length) return null;
      const insidePieces = parts.features.filter(seg=>{
        const mid = turf.along(seg, turf.length(seg,{units:'kilometers'})/2, {units:'kilometers'});
        return turf.booleanPointInPolygon(mid, clipPoly);
      });
      // use the piece that contains the junction or the longest if none
      const jPt = turf.point(junctionLonLat);
      const withJ = insidePieces.find(seg=> turf.booleanPointOnLine(jPt, seg));
      return withJ || insidePieces.sort((a,b)=>turf.length(b)-turf.length(a))[0] || null;
    });
    if (!inside) return null;

    // Ensure it ends exactly at the junction
    const coords = inside.geometry.coordinates.slice();
    coords[coords.length-1] = junctionLonLat;
    return turf.lineString(coords);
  }
}
