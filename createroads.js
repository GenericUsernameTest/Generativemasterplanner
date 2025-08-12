// roads.js
// Lightweight curved roads with entrance picking + cul-de-sac

export function initRoads(map) {
  const state = {
    picking: false,
    clicks: [],
    entranceLine: null,    // LineString (smoothed)
    entranceRoadPoly: null // Polygon (buffered)
  };

  const handlers = {
    click: (e) => {
      if (!state.picking) return;
      state.clicks.push([e.lngLat.lng, e.lngLat.lat]);
      if (state.clicks.length === 2) {
        // Build a bezier entrance road from 2 points (add a mid control)
        const [a, b] = state.clicks;
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        // nudge mid to create a gentle curve
        const ctrl = [mid[0], mid[1] + 0.0005];

        const raw = turf.lineString([a, ctrl, b]);
        const smooth = turf.bezierSpline(raw, { sharpness: 0.7 });

        state.entranceLine = smooth;

        // Default 5m road width — buffer line to a polygon
        const roadPoly = turf.buffer(smooth, 2.5, { units: 'meters' });

        // Add a cul‑de‑sac at the end (circle buffer at end point)
        const end = smooth.geometry.coordinates.at(-1);
        const bulb = turf.buffer(turf.point(end), 7.5, { units: 'meters' });

        // Merge road + bulb
        const merged = turf.union(roadPoly, bulb);
        state.entranceRoadPoly = merged;

        // Draw to a source if it exists
        const src = map.getSource('entrance-road');
        if (src) src.setData(merged);

        state.picking = false;
        state.clicks = [];
      }
    }
  };

  function startPicking() {
    state.picking = true;
    state.clicks = [];
  }

  function cancelPicking() {
    state.picking = false;
    state.clicks = [];
  }

  function getRoadPolygon() {
    return state.entranceRoadPoly || null;
  }

  function clearRoad() {
    state.entranceLine = null;
    state.entranceRoadPoly = null;
    const src = map.getSource('entrance-road');
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
  }

  // Hook handler
  map.on('click', handlers.click);

  return { startPicking, cancelPicking, getRoadPolygon, clearRoad };
}
