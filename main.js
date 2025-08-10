// ====== CONFIG ======
mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';
// ====================

// Restore last view if available
const savedView = JSON.parse(localStorage.getItem('mapView') || '{}');

const map = new mapboxgl.Map({
  container: 'map',
  style: STYLE_URL,
  center: savedView.center || [0, 20],
  zoom: typeof savedView.zoom === 'number' ? savedView.zoom : 2,
  pitch: typeof savedView.pitch === 'number' ? savedView.pitch : 0,
  bearing: typeof savedView.bearing === 'number' ? savedView.bearing : 0
});

// Save view whenever the user stops moving the map
map.on('moveend', () => {
  localStorage.setItem('mapView', JSON.stringify({
    center: map.getCenter().toArray(),
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing()
  }));
});

// Navigation controls (bottom-right)
map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

// --- Geocoder (Search) ---
const geocoder = new MapboxGeocoder({
  accessToken: mapboxgl.accessToken,
  mapboxgl,
  marker: false,
  placeholder: 'Search for a place',
  // countries: 'gb', // uncomment to bias to UK
  types: 'place,postcode,address,poi',
  language: 'en'
});
map.addControl(geocoder, 'top-left');

// Optional: when a result is picked, fly to a nice 3D view
geocoder.on('result', (e) => {
  map.easeTo({ center: e.result.center, zoom: 16, pitch: 60, bearing: -15 });
});

// --- Draw tool (polygon + trash) ---
const draw = new MapboxDraw({
  displayControlsDefault: false,
  controls: { polygon: true, trash: true }
});
map.addControl(draw);

// Restore saved polygon on load (if any)
map.on('load', () => {
  const saved = localStorage.getItem('savedPolygon');
  if (saved) {
    try {
      draw.add(JSON.parse(saved));
    } catch (err) {
      console.warn('Could not restore saved polygon:', err);
    }
  }
});

// Save polygon on create/update; clear on delete
map.on('draw.create', savePolygon);
map.on('draw.update', savePolygon);
map.on('draw.delete', () => {
  localStorage.removeItem('savedPolygon');
});

function savePolygon() {
  const data = draw.getAll();
  localStorage.setItem('savedPolygon', JSON.stringify(data));
}
