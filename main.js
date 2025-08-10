mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

// Restore saved map view
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

// Search control
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

// Draw control
let draw;
let stage = 1; // 1 = site, 2 = roads
let sitePolygon = null;
let roadPolygons = [];

function setDrawForStage() {
  if (draw) map.removeControl(draw);
  draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: { polygon: true, trash: true }
  });
  map.addControl(draw);
}

setDrawForStage();

map.on('load', () => {
  // Add layer for homes
  map.addSource('homes', { type: 'geojson', data: turf.featureCollection([]) });

  map.addLayer({
    id: 'homes',
    type: 'fill-extrusion',
    source: 'homes',
    paint: {
      'fill-extrusion-color': '#6699ff',
      'fill-extrusion-height': 10,
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.7
    }
  });
});

// Stage 1: Confirm Site
document.getElementById('confirmSite').addEventListener('click', () => {
  const features = draw.getAll().features;
  if (features.length === 0) {
    alert('Draw your site boundary first.');
    return;
  }
  sitePolygon = features[0];
  stage = 2;
  draw.deleteAll();
  alert('Site confirmed. Now draw road polygons.');
});

// Stage 2: Fill with Homes
document.getElementById('fillHomes').addEventListener('click', () => {
  const features = draw.getAll().features;
  if (features.length === 0) {
    alert('Draw at least one road polygon.');
    return;
  }
  roadPolygons = features;

  // Union all roads
  let roadsUnion = roadPolygons[0];
  for (let i = 1; i < roadPolygons.length; i++) {
    roadsUnion = turf.union(roadsUnion, roadPolygons[i]);
  }

  // Subtract roads from site
  const buildable = turf.difference(sitePolygon, roadsUnion);
  if (!buildable) {
    alert('No buildable area left after subtracting roads.');
    return;
  }

  placeHomes(buildable);
});

function placeHomes(polygon) {
  const areaM2 = turf.area(polygon);
  const hectares = areaM2 / 10000;
  const densityTarget = 40;
  const targetHomes = Math.floor(densityTarget * hectares);

  const homeSize = 7; // meters
  const spacing = Math.sqrt(10000 / densityTarget); // ~15.8m

  const lat = turf.center(polygon).geometry.coordinates[1];
  const dLat = 1 / 110540;
  const dLon = 1 / (111320 * Math.cos(lat * Math.PI / 180));
  const sizeLon = homeSize * dLon, sizeLat = homeSize * dLat;
  const stepLon = spacing * dLon, stepLat = spacing * dLat;

  const bbox = turf.bbox(polygon);
  const homes = [];
  let count = 0;

  for (let x = bbox[0]; x < bbox[2]; x += stepLon) {
    for (let y = bbox[1]; y < bbox[3]; y += stepLat) {
      const cx = x + stepLon / 2, cy = y + stepLat / 2;
      if (turf.booleanPointInPolygon([cx, cy], polygon)) {
        const home = turf.polygon([[ 
          [cx - sizeLon/2, cy - sizeLat/2],
          [cx + sizeLon/2, cy - sizeLat/2],
          [cx + sizeLon/2, cy + sizeLat/2],
          [cx - sizeLon/2, cy + sizeLat/2],
          [cx - sizeLon/2, cy - sizeLat/2]
        ]]);
        homes.push(home);
        count++;
        if (count >= targetHomes) break;
      }
    }
    if (count >= targetHomes) break;
  }

  map.getSource('homes').setData(turf.featureCollection(homes));

  document.getElementById('stats').innerHTML = `
    <p><strong>Site Area:</strong> ${Math.round(turf.area(sitePolygon)).toLocaleString()} m²</p>
    <p><strong>Buildable Area:</strong> ${Math.round(areaM2).toLocaleString()} m²</p>
    <p><strong>Hectares:</strong> ${hectares.toFixed(2)} ha</p>
    <p><strong>Homes placed:</strong> ${count}</p>
    <p><strong>Actual density:</strong> ${(count / hectares).toFixed(1)} homes/ha</p>
  `;
}
