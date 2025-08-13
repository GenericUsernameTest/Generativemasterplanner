// utils.js
// ================= UTILS ==================
export const $ = (id) => document.getElementById(id);

export const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

export const fc = (features = []) => ({
  type: 'FeatureCollection',
  features: Array.isArray(features) ? features : []
});

export function clamp(n, a, b) { return Math.min(Math.max(n, a), b); }

export function setStats(html) {
  const el = $('stats');
  if (el) el.innerHTML = html;
}

/**
 * Bearing (deg) of the longest edge on the outer ring of a Polygon/MultiPolygon.
 */
export function getLongestEdgeAngle(polygon) {
  const g = polygon?.geometry;
  if (!g) return 0;

  const outer =
    g.type === 'Polygon'
      ? g.coordinates?.[0] || []
      : g.type === 'MultiPolygon'
        ? g.coordinates?.[0]?.[0] || []
        : [];

  let bestDist = 0, bestAngle = 0;
  for (let i = 0; i < outer.length - 1; i++) {
    const a = turf.point(outer[i]);
    const b = turf.point(outer[i + 1]);
    const dist = turf.distance(a, b, { units: 'meters' });
    if (dist > bestDist) {
      bestDist = dist;
      bestAngle = turf.bearing(a, b);
    }
  }
  return bestAngle;
}

/**
 * Robust union of many polygon features.
 * Falls back to returning a FeatureCollection of pieces if unioning fails.
 */
export function unionAll(features) {
  if (!Array.isArray(features) || !features.length) return null;

  // If a single feature, return it as-is
  if (features.length === 1) return features[0];

  let u = features[0];
  for (let i = 1; i < features.length; i++) {
    const f = features[i];
    try {
      // Some turf builds expose turf.union; others prefer turf.combine+turf.dissolve
      // This keeps using union but catches GEOS issues.
      const next = turf.union(u, f);
      if (next) u = next;
    } catch (e) {
      console.warn('union failed at index', i, e);
      // If union fails badly, return a FeatureCollection of what we have so far + remaining
      return fc([u, ...features.slice(i)]);
    }
  }
  return u;
}

/**
 * Quick meters→degrees scale at a given latitude (approx).
 */
export function metersToDeg(latDeg) {
  const latR = latDeg * Math.PI / 180;
  const dLat = 1 / 110540; // deg per meter north/south
  const dLon = 1 / (111320 * Math.max(0.0001, Math.cos(latR))); // deg per meter east/west
  return { dLat, dLon };
}
