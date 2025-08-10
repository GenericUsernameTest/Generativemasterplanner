mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

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

// Draw tool
const draw = new MapboxDraw({
  displayControlsDefault: false,
  controls: { polygon: true, trash: true }
});
map.addControl(draw);

map.on('load', () => {
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
});

// Storage
let siteBoundary = null;
let roads = [];

// Toolbar actions
document.getElementById('drawSite').addEventListener('click', () => {
  draw.deleteAll();
  siteBoundary = null;
  roads = [];
  draw.changeMode('draw_polygon');
});

document.getElementById('drawRoads').addEventListener('click', () => {
  draw.changeMode('draw_polygon');
});

document.getElementById('fillHomes').addEventListener('click', fillHomes);

document.getElementById('clearAll').addEventListener('click', () => {
  draw.deleteAll();
  siteBoundary = null;
  roads = [];
  map.getSource('homes').setData(turf.featureCollection([]));
  document.getElementById('stats').innerHTML = '<p><strong>Draw the site boundary first.</strong></p>';
});

// Capture polygon creations
map.on('draw.create', (e) => {
  const feature = e.features[0];
  if (!siteBoundary) {
    siteBoundary = feature;
    document.getElementById('stats').innerHTML = '<p>Site boundary saved. Now draw roads.</p>';
  } else {
    roads.push(feature);
    document.getElementById('stats').innerHTML = `<p>Road added. Total: ${roads.length}</p>`;
  }
});

function fillHomes() {
  if (!siteBoundary) {
    alert('Draw the site boundary first.');
    return;
  }

  let buildable = siteBoundary;
  if (roads.length > 0) {
    const roadsUnion = roads.reduce((acc, road) => acc ? turf.union(acc, road) : road, null);
    buildable = turf.difference(siteBoundary, roadsUnion) || siteBoundary;
  }

  const areaM2 = turf.area(buildable);
  const hectares = areaM2 / 10000;
  const density = 40; // homes per ha
  const targetHomes = Math.floor(hectares * density);

  const homeSizeM = 7;
  const stepM = Math.sqrt(10000 / density);

  const lat = turf.center(buildable).geometry.coordinates[1];
  const dLat = 1 / 110540;
  const dLon = 1 / (111320 * Math.cos(lat * Math.PI / 180));
  const sizeLon = homeSizeM * dLon, sizeLat = homeSizeM * dLat;
  const stepLon = stepM * dLon, stepLat = stepM * dLat;

  const bbox = turf.bbox(buildable);
  const homes = [];
  for (let x = bbox[0]; x < bbox[2]; x += stepLon) {
    for (let y = bbox[1]; y < bbox[3]; y += stepLat) {
      const pt = turf.point([x + stepLon / 2, y + stepLat / 2]);
      if (turf.booleanPointInPolygon(pt, buildable)) {
        homes.push(turf.polygon([[
          [x, y],
          [x + sizeLon, y],
          [x + sizeLon, y + sizeLat],
          [x, y + sizeLat],
          [x, y]
        ]]));
      }
    }
  }

  map.getSource('homes').setData(turf.featureCollection(homes));

  document.getElementById('stats').innerHTML = `
    <p><strong>Area:</strong> ${Math.round(areaM2).toLocaleString()} m²</p>
    <p><strong>Hectares:</strong> ${hectares.toFixed(2)}</p>
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Density:</strong> ${(homes.length / hectares).toFixed(1)} homes/ha</p>
  `;
}
