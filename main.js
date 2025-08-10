// ====== CONFIG ======
mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';
// ====================

// Restore last view
const savedView = JSON.parse(localStorage.getItem('mapView') || '{}');

const map = new mapboxgl.Map({
  container: 'map',
  style: STYLE_URL,
  center: savedView.center || [0, 20],
  zoom: typeof savedView.zoom === 'number' ? savedView.zoom : 2,
  pitch: typeof savedView.pitch === 'number' ? savedView.pitch : 0,
  bearing: typeof savedView.bearing === 'number' ? savedView.bearing : 0
});

map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
map.on('moveend', () => {
  localStorage.setItem('mapView', JSON.stringify({
    center: map.getCenter().toArray(),
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing()
  }));
});

// Geocoder
const geocoder = new MapboxGeocoder({
  accessToken: mapboxgl.accessToken,
  mapboxgl,
  marker: false,
  placeholder: 'Search for a place',
  types: 'place,postcode,address,poi',
  language: 'en'
});
map.addControl(geocoder, 'top-left');

// --- State ---
let draw;                 // created on map load
let siteBoundary = null;  // Feature (Polygon)
let roads = [];           // Array<Feature<Polygon>>

// Utility
const $ = (id) => document.getElementById(id);
const setStats = (html) => { const el = $('stats'); if (el) el.innerHTML = html; };

// SAFETY: init everything after the map is fully loaded
map.on('load', () => {
  // Sources/Layers
  map.addSource('homes', { type: 'geojson', data: turf.featureCollection([]) });
  map.addLayer({
    id: 'homes',
    type: 'fill-extrusion',
    source: 'homes',
    paint: {
      'fill-extrusion-color': '#6699ff',
      'fill-extrusion-height': 10,
      'fill-extrusion-opacity': 0.7
    }
  });

  // Draw control
  draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: { polygon: true, trash: true }
  });
  map.addControl(draw);

  // Debug: verify clicks reach the map
  map.on('click', (e) => console.log('map click', e.lngLat.toArray()));

  // BUTTONS — wire AFTER draw exists
  $('drawSite').onclick = () => {
    draw.deleteAll();
    siteBoundary = null;
    roads = [];
    draw.changeMode('draw_polygon');
    map.getCanvas().style.cursor = 'crosshair';
    setStats('<p>Drawing site boundary… click to add points, double‑click to finish.</p>');
  };

  $('drawRoads').onclick = () => {
    if (!siteBoundary) { alert('Draw the site boundary first.'); return; }
    draw.changeMode('draw_polygon');
    map.getCanvas().style.cursor = 'crosshair';
    setStats('<p>Drawing roads… click to add points, double‑click to finish. Click “Fill with Homes” when ready.</p>');
  };

  $('fillHomes').onclick = () => fillHomes();

  $('clearAll').onclick = () => {
    draw.deleteAll();
    siteBoundary = null;
    roads = [];
    if (map.getSource('homes')) map.getSource('homes').setData(turf.featureCollection([]));
    setStats('<p><strong>Draw the site boundary first.</strong></p>');
  };

  // CAPTURE new polygons
  map.on('draw.create', (e) => {
    const feature = e.features[0];
    if (!feature || feature.geometry.type !== 'Polygon') return;

    if (!siteBoundary) {
      siteBoundary = feature;
      setStats('<p>Site boundary saved. Now click “Draw Roads”.</p>');
    } else {
      roads.push(feature);
      setStats(`<p>Road added. Total roads: ${roads.length}. Click “Fill with Homes” when ready.</p>`);
    }
    // reset cursor when a shape finishes
    map.getCanvas().style.cursor = '';
  });

  // When mode changes (e.g., after double‑click), reset cursor
  map.on('draw.modechange', () => { map.getCanvas().style.cursor = ''; });
});

// --- Fill with Homes (site minus roads) ---
function fillHomes() {
  if (!siteBoundary) {
    alert('Draw the site boundary first.');
    return;
  }

  // Buildable = site - union(roads)
  let buildable = siteBoundary;
  if (roads.length > 0) {
    let union = roads[0];
    for (let i = 1; i < roads.length; i++) {
      try { union = turf.union(union, roads[i]); }
      catch (err) { console.warn('union failed, skipping a road', err); }
    }
    try { buildable = turf.difference(siteBoundary, union) || siteBoundary; }
    catch (err) { console.warn('difference failed, using site as buildable', err); }
  }

  // Generate homes
  const density = 40;      // homes/ha
  const homeSizeM = 7;     // footprint size
  const stepM = Math.sqrt(10000 / density); // grid pitch for target density

  const areaM2 = turf.area(buildable);
  const ha = areaM2 / 10000;

  const lat = turf.center(buildable).geometry.coordinates[1];
  const dLat = 1 / 110540;
  const dLon = 1 / (111320 * Math.cos(lat * Math.PI / 180));
  const sizeLon = homeSizeM * dLon, sizeLat = homeSizeM * dLat;
  const stepLon = stepM * dLon, stepLat = stepM * dLat;

  const bbox = turf.bbox(buildable);
  const homes = [];
  for (let x = bbox[0]; x < bbox[2]; x += stepLon) {
    for (let y = bbox[1]; y < bbox[3]; y += stepLat) {
      const cx = x + stepLon / 2, cy = y + stepLat / 2;
      if (turf.booleanPointInPolygon([cx, cy], buildable)) {
        homes.push(turf.polygon([[
          [cx - sizeLon / 2, cy - sizeLat / 2],
          [cx + sizeLon / 2, cy - sizeLat / 2],
          [cx + sizeLon / 2, cy + sizeLat / 2],
          [cx - sizeLon / 2, cy + sizeLat / 2],
          [cx - sizeLon / 2, cy - sizeLat / 2]
        ]]));
      }
    }
  }

  if (map.getSource('homes')) {
    map.getSource('homes').setData(turf.featureCollection(homes));
  }

  setStats(`
    <p><strong>Buildable area:</strong> ${Math.round(areaM2).toLocaleString()} m² (${ha.toFixed(2)} ha)</p>
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Density:</strong> ${(homes.length / ha || 0).toFixed(1)} homes/ha</p>
  `);
}
