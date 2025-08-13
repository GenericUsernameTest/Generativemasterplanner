// ================= UTILS ==================
export const $ = (id) => document.getElementById(id);
export const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
export const fc = (features) => ({ type: 'FeatureCollection', features });
export function clamp(n, a, b) { return Math.min(Math.max(n, a), b); }
export function setStats(html) { const el = $('stats'); if (el) el.innerHTML = html; }
export function unionAll(features) {
  if (!Array.isArray(features) || !features.length) return null;
  let u = features[0];
  for (let i = 1; i < features.length; i++) {
    try { u = turf.union(u, features[i]); }
    catch (e) { console.warn('union failed at', i, e); }
  }
  return u;
}
export function metersToDeg(latDeg) {
  const latR = latDeg * Math.PI / 180;
  const dLat = 1 / 110540;
  const dLon = 1 / (111320 * Math.max(0.0001, Math.cos(latR)));
  return { dLat, dLon };
}
