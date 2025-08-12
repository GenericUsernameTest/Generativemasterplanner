// createRoads.js
import { fc, emptyFC, unionAll, metersToDeg } from './utils.js';

/**
 * Generates a road network for the site.
 * @param {Object} siteBoundary - Polygon feature of the site.
 * @param {Object} entranceRoad - LineString feature defining the main entrance road.
 * @param {Object} options - Road generation settings.
 * @returns {FeatureCollection} - Roads as a FeatureCollection.
 */
export function createRoads(siteBoundary, entranceRoad, options = {}) {
  if (!siteBoundary) throw new Error('No site boundary provided.');
  if (!entranceRoad) throw new Error('No entrance road provided.');

  const {
    mainRoadWidth = 8,
    localRoadWidth = 5,
    blockDepth = 50,   // meters between parallel roads
    blockWidth = 80,   // meters between cross roads
  } = options;

  const lat = turf.center(siteBoundary).geometry.coordinates[1];
  const { dLat, dLon } = metersToDeg(lat);

  // 1) Start with the entrance road inside the site
  const roadFeatures = [entranceRoad];

  // 2) Extend the entrance road into the site until it hits the far side
  // (For now, just straight extension; curves can be added later)
  const entranceEnd = entranceRoad.geometry.coordinates[1];
  const directionVec = turf.destination(
    entranceEnd,
    1000,
    turf.bearing(entranceRoad.geometry.coordinates[0], entranceEnd),
    { units: 'meters' }
  );

  const extended = turf.lineString([
    entranceRoad.geometry.coordinates[0],
    directionVec.geometry.coordinates
  ]);
  const clippedMain = turf.intersect(
    turf.buffer(extended, mainRoadWidth / 2, { units: 'meters' }),
    siteBoundary
  );

  if (clippedMain) roadFeatures.push(clippedMain);

  // 3) Generate local grid roads branching off the main road
  // For now, we use straight horizontal/vertical lines in rotated frame.
  const siteBBox = turf.bbox(siteBoundary);
  const [minX, minY, maxX, maxY] = siteBBox;

  const lonSpacing = blockWidth * dLon;
  const latSpacing = blockDepth * dLat;

  // Parallel roads (north-south)
  for (let x = minX; x <= maxX; x += lonSpacing) {
    const line = turf.lineString([[x, minY], [x, maxY]]);
    const buf = turf.buffer(line, localRoadWidth / 2, { units: 'meters' });
    const inter = turf.intersect(buf, siteBoundary);
    if (inter) roadFeatures.push(inter);
  }

  // Cross roads (east-west)
  for (let y = minY; y <= maxY; y += latSpacing) {
    const line = turf.lineString([[minX, y], [maxX, y]]);
    const buf = turf.buffer(line, localRoadWidth / 2, { units: 'meters' });
    const inter = turf.intersect(buf, siteBoundary);
    if (inter) roadFeatures.push(inter);
  }

  // 4) Union all roads into one FeatureCollection
  const merged = unionAll(roadFeatures.filter(Boolean));
  return merged ? fc([merged]) : emptyFC();
}
