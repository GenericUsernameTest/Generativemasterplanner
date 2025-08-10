mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';

// Create map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n',
  center: [0, 20],
  zoom: 2,
  pitch: 60,
  bearing: 0
});

// Add navigation controls
map.addControl(new mapboxgl.NavigationControl(), 'top-right');

// Draw controls
const draw = new MapboxDraw({
  displayControlsDefault: false,
  controls: { polygon: true, trash: true }
});
map.addControl(draw);

// When map loads
map.on('load', () => {
  // Homes source + layer
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

  // Restore saved polygon
  const saved = localStorage.getItem('savedPolygon');
  if (saved) {
    draw.add(JSON.parse(saved));
    updateHomes();
  }
});

// Save + update on draw
map.on('draw.create', () => {
  savePolygon();
  updateHomes();
});
map.on('draw.update', () => {
  savePolygon();
  updateHomes();
});
map.on('draw.delete', () => {
  localStorage.removeItem('savedPolygon');
  map.getSource('homes').setData(turf.featureCollection([]));
  document.getElementById('stats').innerHTML =
    '<p><strong>Draw a polygon</strong> to place homes.</p>';
});

function savePolygon() {
  const data = draw.getAll();
  localStorage.setItem('savedPolygon', JSON.stringify(data));
}

function updateHomes() {
  const feature = draw.getAll().features[0];
  if (!feature) return;

  const area = turf.area(feature);
  const ha = area / 10000;

  // 40 homes per hectare
  const target = Math.floor(ha * 40);

  // Sizes (meters)
  const homeSizeM = 7;
  const stepM = Math.sqrt(10000 / 40); // ≈15.81 m

  // meters -> degrees at site latitude
  const lat = turf.center(feature).geometry.coordinates[1];
  const dLat = 1 / 110540;
  const dLon = 1 / (111320 * Math.cos(lat * Math.PI / 180));
  const sizeLon = homeSizeM * dLon,
        sizeLat = homeSizeM * dLat;
  const stepLon = stepM * dLon,
        stepLat = stepM * dLat;

  const bbox = turf.bbox(feature);

  // Candidate positions
  const candidates = [];
  for (let x = bbox[0]; x < bbox[2]; x += stepLon) {
    for (let y = bbox[1]; y < bbox[3]; y += stepLat) {
      const cx = x + stepLon / 2, cy = y + stepLat / 2;
      if (turf.booleanPointInPolygon([cx, cy], feature)) {
        candidates.push([cx, cy]);
      }
    }
  }

  // Shuffle for spread
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  // Choose N homes
  const chosen = candidates.slice(0, target);

  // Make square polygons
  const homes = chosen.map(([cx, cy]) => {
    const halfLon = sizeLon / 2, halfLat = sizeLat / 2;
    return turf.polygon([[
      [cx - halfLon, cy - halfLat],
      [cx + halfLon, cy - halfLat],
      [cx + halfLon, cy + halfLat],
      [cx - halfLon, cy + halfLat],
      [cx - halfLon, cy - halfLat]
    ]]);
  });

  // Update layer
  map.getSource('homes').setData(turf.featureCollection(homes));

  // Stats
  document.getElementById('stats').innerHTML = `
    <p><strong>Area:</strong> ${Math.round(area).toLocaleString()} m²</p>
    <p><strong>Hectares:</strong> ${ha.toFixed(2)} ha</p>
    <p><strong>Homes placed:</strong> ${homes.length}</p>
    <p><strong>Actual density:</strong> ${(homes.length / ha).toFixed(1)} homes/ha</p>
  `;
}
