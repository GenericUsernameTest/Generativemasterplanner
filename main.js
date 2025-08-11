import { generateMasterplan, getLongestEdgeAngle } from './homes.js';

function $(id) { return document.getElementById(id); }

function updateGeoJSONSource(id, data) {
  if (map.getSource(id)) {
    map.getSource(id).setData(data);
  } else {
    map.addSource(id, { type: 'geojson', data });
  }
}

function setStats(html) {
  $('stats').innerHTML = html;
}

// Mapbox init
mapboxgl.accessToken = 'YOUR_MAPBOX_TOKEN';
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/light-v11',
  center: [-0.1276, 51.5072],
  zoom: 13
});

const draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: true, trash: true } });
map.addControl(draw);
map.addControl(new MapboxGeocoder({ accessToken: mapboxgl.accessToken, mapboxgl }));

let siteBoundary = null;

$('drawSite').onclick = () => {
  draw.deleteAll();
  siteBoundary = null;
  map.getCanvas().style.cursor = 'crosshair';
  draw.changeMode('draw_polygon');
};

$('clearAll').onclick = () => {
  draw.deleteAll();
  siteBoundary = null;
  updateGeoJSONSource('roads', turf.featureCollection([]));
  updateGeoJSONSource('homes', turf.featureCollection([]));
  setStats('');
};

map.on('draw.create', e => {
  siteBoundary = e.features[0];
  map.getCanvas().style.cursor = '';
});

$('fillHomes').onclick = () => {
  if (!siteBoundary) { alert('Draw the site boundary first.'); return; }
  const opts = {
    rotationDeg: parseFloat($('rotationAngle').value) || getLongestEdgeAngle(siteBoundary),
    homeW: parseFloat($('homeWidth').value),
    homeD: parseFloat($('homeDepth').value),
    frontSetback: parseFloat($('frontSetback').value),
    sideGap: parseFloat($('sideGap').value),
    roadW: parseFloat($('roadWidth').value),
    lotsPerBlock: parseInt($('lotsPerBlock').value) || 5
  };
  const { roads, homes } = generateMasterplan(siteBoundary, opts);
  updateGeoJSONSource('roads', roads);
  updateGeoJSONSource('homes', homes);
  setStats(`<p>${homes.features.length} homes placed.<br>
    Roads: ${(turf.area(roads)/10000).toFixed(2)} ha<br>
    Density: ${(homes.features.length / (turf.area(siteBoundary) / 10000)).toFixed(1)} homes/ha</p>`);
};
