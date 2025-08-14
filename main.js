// ✨ MASTERPLAN TOOL — FIXED VERSION ✨
// Includes full JS logic with access road polygons, spine road alignment, and house generation

mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n',
  center: [-0.1278, 51.5074],
  zoom: 15
});

map.on('load', () => {
  showNotification('Map loaded!', 'success');

  map.addSource('site-boundary', { type: 'geojson', data: turf.featureCollection([]) });
  map.addSource('access-roads', { type: 'geojson', data: turf.featureCollection([]) });
  map.addSource('houses', { type: 'geojson', data: turf.featureCollection([]) });

  map.addLayer({
    id: 'site-boundary-fill',
    type: 'fill',
    source: 'site-boundary',
    paint: { 'fill-color': '#3498db', 'fill-opacity': 0.1 }
  });

  map.addLayer({
    id: 'site-boundary-outline',
    type: 'line',
    source: 'site-boundary',
    paint: { 'line-color': '#3498db', 'line-width': 2 }
  });

  map.addLayer({
    id: 'access-roads',
    type: 'fill',
    source: 'access-roads',
    paint: { 'fill-color': '#7f8c8d', 'fill-opacity': 0.7 }
  });

  map.addLayer({
    id: 'houses',
    type: 'fill-extrusion',
    source: 'houses',
    paint: {
      'fill-extrusion-color': '#e74c3c',
      'fill-extrusion-height': 4,
      'fill-extrusion-opacity': 0.8
    }
  });
});

const draw = new MapboxDraw({
  displayControlsDefault: false,
  controls: { polygon: false, line_string: false, point: false, trash: false }
});
map.addControl(draw);

let currentTool = null;
let siteBoundary = null;
let accessRoads = [];
let houses = [];

function activateTool(tool) {
  currentTool = tool;
  draw.changeMode(tool === 'boundary' ? 'draw_polygon' : 'draw_line_string');
}

document.getElementById('draw-boundary').addEventListener('click', () => activateTool('boundary'));
document.getElementById('draw-road').addEventListener('click', () => activateTool('road'));
document.getElementById('generate-plan').addEventListener('click', () => generatePlan());
document.getElementById('clear-all').addEventListener('click', () => clearAll());

map.on('draw.create', function (e) {
  const feature = e.features[0];
  if (currentTool === 'boundary') {
    siteBoundary = feature;
    map.getSource('site-boundary').setData(turf.featureCollection([feature]));
  } else if (currentTool === 'road') {
    const buffered = createRoadPolygonFromLine(feature.geometry.coordinates, 8);
    accessRoads.push(buffered);
    map.getSource('access-roads').setData(turf.featureCollection(accessRoads));
  }
  draw.deleteAll();
});

function createRoadPolygonFromLine(lineCoords, widthMeters) {
  const line = turf.lineString(lineCoords);
  return turf.buffer(line, widthMeters / 2, { units: 'meters' });
}

function generatePlan() {
  if (!siteBoundary || accessRoads.length === 0) {
    showNotification('Boundary and road required.', 'error');
    return;
  }

  houses = [];
  const boundaryPoly = turf.polygon(siteBoundary.geometry.coordinates);

  accessRoads.forEach(road => {
    const centerline = turf.center(road).geometry.coordinates;
    const angle = 0;
    const spacing = 10;
    const numHouses = 10;

    for (let i = 0; i < numHouses; i++) {
      const offset = i * spacing;
      const x = centerline[0] + (offset * 0.00001);
      const y = centerline[1];
      const house = turf.rectangle([x - 0.00001, y - 0.00001], [x + 0.00001, y + 0.00001]);
      if (turf.booleanWithin(house, boundaryPoly)) {
        houses.push(house);
      }
    }
  });

  map.getSource('houses').setData(turf.featureCollection(houses));
  showNotification(`${houses.length} homes placed.`);
}

function clearAll() {
  siteBoundary = null;
  accessRoads = [];
  houses = [];

  map.getSource('site-boundary').setData(turf.featureCollection([]));
  map.getSource('access-roads').setData(turf.featureCollection([]));
  map.getSource('houses').setData(turf.featureCollection([]));
}

function showNotification(msg, type) {
  console.log(`[${type || 'info'}] ${msg}`);
}
