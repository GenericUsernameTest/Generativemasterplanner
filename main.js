import { generateMasterplan, getLongestEdgeAngle } from './homes.js';

function $(id) { return document.getElementById(id); }

function updateGeoJSONSource(id, data) {
  if (map.getSource(id)) {
    map.getSource(id).setData(data);
  } else {
    map.addSource(id, { type: 'geojson', data });
  }
}

function doFill() {
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
}

// Hook up your buttons here (drawSite, clearAll, fillHomes -> doFill)
document.getElementById('fillHomes').addEventListener('click', doFill);
