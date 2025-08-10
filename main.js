mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

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

// Save view position
map.on('moveend', () => {
  localStorage.setItem('mapView', JSON.stringify({
    center: map.getCenter().toArray(),
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing()
  }));
});

// Navigation controls
map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

// Add controls only when map is loaded
map.on('load', () => {

  // --- Geocoder ---
  const geocoder = new MapboxGeocoder({
    accessToken: mapboxgl.accessToken,
    mapboxgl,
    marker: false,
    placeholder: 'Search for a place',
    types: 'place,postcode,address,poi',
    language: 'en'
  });
  map.addControl(geocoder, 'top-left');
  geocoder.on('result', (e) => {
    map.easeTo({ center: e.result.center, zoom: 16, pitch: 60, bearing: -15 });
  });

  // --- Draw tool ---
  const draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: { polygon: true, trash: true }
  });
  map.addControl(draw);

  // Restore saved polygon
  const saved = localStorage.getItem('savedPolygon');
  if (saved) {
    try {
      draw.add(JSON.parse(saved));
    } catch (err) {
      console.warn('Could not restore saved polygon:', err);
    }
  }

  // Save polygon
  map.on('draw.create', savePolygon);
  map.on('draw.update', savePolygon);
  map.on('draw.delete', () => localStorage.removeItem('savedPolygon'));

  function savePolygon() {
    const data = draw.getAll();
    localStorage.setItem('savedPolygon', JSON.stringify(data));
  }
});
