import { $, emptyFC } from './utils.js';
import { generatePlan } from './generateplan.js';

mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/light-v11',
  center: [-0.1, 51.5],
  zoom: 14
});

const Draw = new MapboxDraw({
  displayControlsDefault: false,
  modes: MapboxDraw.modes
});
map.addControl(Draw);

let siteBoundary = null;
let accessRoad = null;

$('drawSite').onclick = () => {
  Draw.deleteAll();
  Draw.changeMode('draw_polygon');
};

$('drawAccess').onclick = () => {
  Draw.changeMode('draw_line_string');
};

$('generate').onclick = () => {
  const all = Draw.getAll().features;
  siteBoundary = all.find(f => f.geometry.type === 'Polygon') || siteBoundary;
  accessRoad = all.find(f => f.geometry.type === 'LineString') || accessRoad;
  generatePlan(map, siteBoundary, accessRoad);
};

$('clearAll').onclick = () => {
  Draw.deleteAll();
  siteBoundary = null;
  accessRoad = null;
  map.getSource('homes')?.setData(emptyFC());
  map.getSource('roads-view')?.setData(emptyFC());
};

map.on('load', () => {
  map.addSource('roads-view', { type: 'geojson', data: emptyFC() });
  map.addSource('homes', { type: 'geojson', data: emptyFC() });

  map.addLayer({
    id: 'roads-view',
    type: 'fill',
    source: 'roads-view',
    paint: { 'fill-color': '#ccc', 'fill-opacity': 0.7 }
  });
  map.addLayer({
    id: 'homes',
    type: 'fill',
    source: 'homes',
    paint: ['get', 'color']
  });
});
