mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n',
  center: [-0.16, 51.51],
  zoom: 15,
  pitch: 60,
  bearing: 0
});

map.on('load', () => {
  map.addSource('mapbox-dem', {
    type: 'raster-dem',
    url: 'mapbox://mapbox.terrain-rgb',
    tileSize: 512,
    maxzoom: 14
  });
  map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.0 });

  map.addLayer({
    id: '3d-buildings',
    source: 'composite',
    'source-layer': 'building',
    filter: ['==', 'extrude', 'true'],
    type: 'fill-extrusion',
    minzoom: 15,
    paint: {
      'fill-extrusion-color': '#aaa',
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-base': ['get', 'min_height'],
      'fill-extrusion-opacity': 0.5
    }
  });

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

const draw = new MapboxDraw({
  displayControlsDefault: false,
  controls: { polygon: true, trash: true }
});
map.addControl(draw);

map.on('draw.create', updateHomes);
map.on('draw.update', updateHomes);
map.on('draw.delete', () => {
  map.getSource('homes').setData(turf.featureCollection([]));
  document.getElementById('stats').innerHTML = '<p><strong>Draw a polygon</strong> to place homes (40/ha).</p>';
});

function updateHomes() {
  const feature = draw.getAll().features[0];
  if (!feature) return;

  const area = turf.area(feature);
  const ha = area / 10000;
  const target = Math.floor(ha * 40);

  const homeSizeM = 7;
  const stepM = Math.sqrt(10000 / 40);

  const lat = turf.center(feature).geometry.coordinates[1];
  const dLat = 1 / 110540;
  const dLon = 1 / (111320 * Math.cos(lat * Math.PI / 180));
  const sizeLon = homeSizeM * dLon, sizeLat = homeSizeM * dLat;
  const stepLon = stepM * dLon,     stepLat = stepM * dLat;

  const bbox = turf.bbox(feature);
  const candidates = [];

  for (let x = bbox[0]; x < bbox[2]; x += stepLon) {
    for (let y = bbox[1]; y < bbox[3]; y += stepLat) {
      const cx = x + stepLon / 2, cy = y + stepLat / 2;
      if (turf.booleanPointInPolygon([cx, cy], feature)) {
        candidates.push([cx, cy]);
      }
    }
  }

  const homes = candidates.map(([cx, cy]) => {
    const halfLon = sizeLon / 2, halfLat = sizeLat / 2;
    return turf.polygon([[
      [cx - halfLon, cy - halfLat],
      [cx + halfLon, cy - halfLat],
      [cx + halfLon, cy + halfLat],
      [cx - halfLon, cy + halfLat],
      [cx - halfLon, cy - halfLat]
    ]]);
  });

  map.getSource('homes').setData(turf.featureCollection(homes));

  document.getElementById('stats').innerHTML = `
    <strong>Area:</strong> ${Math.round(area).toLocaleString()} m²<br>
    <strong>Hectares:</strong> ${ha.toFixed(2)} ha<br>
    <strong>Homes placed:</strong> ${homes.length}<br>
    <strong>Actual density:</strong> ${(homes.length / ha).toFixed(1)} homes/ha
  `;
}
