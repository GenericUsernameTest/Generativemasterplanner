// ================= UTILS ==================
export const $ = (id) => document.getElementById(id);
export const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
export const fc = (features) => ({ type: 'FeatureCollection', features });
export function clamp(n, a, b) { return Math.min(Math.max(n, a), b); }
export function setStats(html) { const el = $('stats'); if (el) el.innerHTML = html; }

export function getLongestEdgeAngle(polygon) {
  const ring = polygon?.geometry?.coordinates?.[0] || [];
  let bestDist = 0, bestAngle = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = turf.point(ring[i]);
    const p2 = turf.point(ring[i + 1]);
    const dist = turf.distance(p1, p2, { units: 'meters' });
    if (dist > bestDist) { bestDist = dist; bestAngle = turf.bearing(p1, p2); }
  }
  return bestAngle;
}

export function unionAll(features) {
  if (!Array.isArray(features) || !features.length) return null;
  let u = features[0];
  for (let i = 1; i < features.length; i++) {
    try { u = turf.union(u, features[i]); }
    catch (e) { console.warn('union failed', i, e); }
  }
  return u;
}

export function metersToDeg(latDeg) {
  const latR = latDeg * Math.PI / 180;
  const dLat = 1 / 110540;
  const dLon = 1 / (111320 * Math.max(0.0001, Math.cos(latR)));
  return { dLat, dLon };
}
