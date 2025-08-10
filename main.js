// ====== CONFIG ======
mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';
// ====================

// Remember last view
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

// Search (Geocoder)
const geocoder = new MapboxGeocoder({
  accessToken: mapboxgl.accessToken,
  mapboxgl,
  marker: false,                 // don't drop a marker
  placeholder: 'Search for a place',
  countries: 'gb',               // limit to UK (remove to search globally)
  types: 'place,postcode,address,poi', // what to search
  language: 'en'
});


// Put it top-left so it doesn't clash with your panel/nav
map.addControl(geocoder, 'top-left');

// Optional: zoom to a nice 3D view when a result is chosen
geocoder.on('result', (e) => {
  const center = e.result.center;
  map.easeTo({ center, zoom: 16, pitch: 60, bearing: -15 });
  // Your moveend handler will save this view to localStorage automatically
});


// Draw tool
const draw = new MapboxDraw({
  displayControlsDefault: false,
  controls: { polygon: true, trash: true }
});
map.addControl(draw);

// Data sources
map.on('load', () => {
  // 3D homes layer
  map.addSource('homes', { type: 'geojson', data: turf.featureCollection([]) });
  map.addLayer({
    id: 'homes',
    type: 'fill-extrusion',
    source: 'homes',
    paint: {
      'fill-extrusion-color': '#4f7cff',
      'fill-extrusion-height': 10,
      'fill-extrusion-opacity': 0.75
    }
  });

  // populate site list from localStorage
  refreshSiteList();
  // if a saved polygon exists with the same temporary key, load it (optional)
});

// ---------- UI handlers ----------
const elStats = document.getElementById('stats');
const elSiteName = document.getElementById('siteName');
const elSiteSelect = document.getElementById('siteSelect');

document.getElementById('btnDraw').addEventListener('click', () => {
  draw.changeMode('draw_polygon');
});

document.getElementById('btnClear').addEventListener('click', () => {
  // clear current drawing only (not saved sites)
  const all = draw.getAll();
  if (all.features.length) {
    all.features.forEach(f => draw.delete(f.id));
  }
  map.getSource('homes').setData(turf.featureCollection([]));
  elStats.textContent = 'Cleared. Draw a new polygon.';
});

document.getElementById('btnSaveSite').addEventListener('click', () => {
  const all = draw.getAll();
  if (!all.features.length) {
    elStats.textContent = 'Nothing to save — draw a polygon first.';
    return;
  }
  const name = (elSiteName.value || '').trim();
  if (!name) {
    elStats.textContent = 'Enter a site name before saving.';
    return;
  }
  saveSite(name, all);
  elStats.textContent = `Saved site: ${name}`;
  refreshSiteList();
});

document.getElementById('btnLoadSite').addEventListener('click', () => {
  const name = elSiteSelect.value;
  if (!name) { elStats.textContent = 'Select a saved site to load.'; return; }
  const data = loadSite(name);
  if (!data) { elStats.textContent = 'Could not find that saved site.'; return; }

  // clear current draw
  const current = draw.getAll();
  if (current.features.length) current.features.forEach(f => draw.delete(f.id));

  draw.add(data); // add the saved feature(s) back
  elStats.textContent = `Loaded site: ${name}`;
});

document.getElementById('btnGenerate').addEventListener('click', () => {
  const site = draw.getAll();
  if (!site.features.length) { elStats.textContent = 'No site in view. Load or draw one.'; return; }

  // For now only "House Type 1"
  const type = document.getElementById('houseType').value;
  const params = houseTypeParams(type);

  const feature = site.features[0]; // first polygon
  generateHomes(feature, params);
});

// ---------- Saved sites (localStorage) ----------
function getSitesStore() {
  try {
    return JSON.parse(localStorage.getItem('sites') || '{}');
  } catch { return {}; }
}
function setSitesStore(obj) {
  localStorage.setItem('sites', JSON.stringify(obj));
}
function saveSite(name, featureCollection) {
  const store = getSitesStore();
  store[name] = featureCollection; // entire Draw FC so we keep ids/geometry
  setSitesStore(store);
}
function loadSite(name) {
  const store = getSitesStore();
  return store[name] || null;
}
function refreshSiteList() {
  const store = getSitesStore();
  const names = Object.keys(store).sort();
  elSiteSelect.innerHTML = names.length
    ? names.map(n => `<option value="${n}">${n}</option>`).join('')
    : '<option value="">(no saved sites)</option>';
}

// ---------- House type presets ----------
function houseTypeParams(key) {
  // expand later with multiple types
  if (key === 'type1') {
    return {
      homeSizeM: 7,                // 7×7 m
      spacingM: Math.sqrt(10000/40),// ~15.81 m centers (≈40/ha baseline)
      heightM: 10                  // extrusion height
    };
  }
  return { homeSizeM: 7, spacingM: 16, heightM: 10 };
}

// ---------- Layout generator (no auto; runs only on “Generate”) ----------
function generateHomes(polygon, params) {
  const area = turf.area(polygon);
  const ha = area / 10000;

  const { homeSizeM, spacingM, heightM } = params;

  // meters -> degrees at site latitude
  const lat = turf.center(polygon).geometry.coordinates[1];
  const dLat = 1 / 110540;
  const dLon = 1 / (111320 * Math.cos(lat * Math.PI / 180));

  const sizeLon = homeSizeM * dLon;
  const sizeLat = homeSizeM * dLat;
  const stepLon = spacingM * dLon;
  const stepLat = spacingM * dLat;

  const bbox = turf.bbox(polygon);

  // Collect candidate centers
  const centers = [];
  for (let x = bbox[0]; x < bbox[2]; x += stepLon) {
    for (let y = bbox[1]; y < bbox[3]; y += stepLat) {
      const cx = x + stepLon / 2, cy = y + stepLat / 2;
      if (turf.booleanPointInPolygon([cx, cy], polygon)) {
        centers.push([cx, cy]);
      }
    }
  }

  // Build homes at all centers (pack to pitch)
  const homes = centers.map(([cx, cy]) => {
    const halfLon = sizeLon / 2, halfLat = sizeLat / 2;
    const poly = turf.polygon([[
      [cx - halfLon, cy - halfLat],
      [cx + halfLon, cy - halfLat],
      [cx + halfLon, cy + halfLat],
      [cx - halfLon, cy + halfLat],
      [cx - halfLon, cy - halfLat]
    ]]);
    poly.properties = { height: heightM };
    return poly;
  });

  // Update layer
  map.getSource('homes').setData(turf.featureCollection(homes));
  map.setPaintProperty('homes', 'fill-extrusion-height',
    ['coalesce', ['get', 'height'], heightM]
  );

  // Report
  const density = homes.length / ha;
  elStats.innerHTML = `
    <div><strong>Area:</strong> ${Math.round(area).toLocaleString()} m²</div>
    <div><strong>Hectares:</strong> ${ha.toFixed(2)} ha</div>
    <div><strong>Homes drawn:</strong> ${homes.length}</div>
    <div><strong>Resulting density:</strong> ${density.toFixed(1)} homes/ha</div>
  `;
}
