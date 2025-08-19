// Mapbox Configuration
mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';

// Try to get saved view from localStorage
const savedView = JSON.parse(localStorage.getItem('mapView'));

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n',
    center: savedView?.center || [-0.1278, 51.5074],  // fallback to London
    zoom: savedView?.zoom || 15                      // fallback zoom
});

// Error handling
map.on('error', function(e) {
    console.error('Map error:', e.error);
    if (e.error.status === 401) {
        console.log('Style is private or URL is wrong');
        showNotification('Style error - check if public', 'error');
    } else {
        showNotification('Map error: ' + e.error.message, 'error');
    }
});

// Drawing tools
const draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: { 
        polygon: false, 
        line_string: false,
        point: false,
        trash: false 
    }
});

map.addControl(draw);

// Application state
let currentTool = null;
let siteBoundary = null;
let accessRoads = [];
let houses = [];
let stats = { totalArea: 0, homeCount: 0, density: 0 };

map.on('moveend', () => {
    const center = map.getCenter();
    const zoom = map.getZoom();

    localStorage.setItem('mapView', JSON.stringify({
        center: [center.lng, center.lat],
        zoom: zoom
    }));
});

map.on('load', function() {
    // Add sources
    map.addSource('site-boundary', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    map.addSource('access-roads', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    map.addSource('houses', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    // Add layers
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
        id: 'access-road-polygons',
        type: 'fill',
        source: 'access-roads',
        filter: ['==', ['get', 'type'], 'access-road'],
        paint: {
            'fill-color': '#7f8c8d',
            'fill-opacity': 1.0
        }
    });

    map.addLayer({
        id: 'spine-roads',
        type: 'fill',
        source: 'access-roads',
        filter: ['==', ['get', 'type'], 'spine-road'],
        paint: {
            'fill-color': '#7f8c8d',
            'fill-opacity': 1.0
        }
    });

    map.addLayer({
        id: 'houses',
        type: 'fill-extrusion',
        source: 'houses',
        paint: {
            'fill-extrusion-color': '#e74c3c',
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-opacity': 1.0
        }
    });
});

// Button event listeners
document.getElementById('draw-boundary').addEventListener('click', function() {
    activateTool('boundary', this);
});

document.getElementById('draw-road').addEventListener('click', function() {
    activateTool('road', this);
});

document.getElementById('generate-plan').addEventListener('click', function() {
    generatePlan();
});

document.getElementById('clear-all').addEventListener('click', function() {
    clearAll();
});

// Tool activation
function activateTool(tool, button) {
    document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));

    if (currentTool === tool) {
        currentTool = null;
        draw.changeMode('simple_select');
        showNotification('Tool deactivated');
    } else {
        currentTool = tool;
        button.classList.add('active');
        
        if (tool === 'boundary') {
            draw.changeMode('draw_polygon');
            showNotification('Click to draw site boundary polygon');
        } else if (tool === 'road') {
            draw.changeMode('draw_line_string');
            showNotification('Click to draw access road line');
        }
    }
}

map.on('draw.create', function(e) {
    const feature = e.features[0];

    if (currentTool === 'boundary') {
        siteBoundary = feature;
        map.getSource('site-boundary').setData({
            type: 'FeatureCollection',
            features: [feature]
        });

        const boundaryArea = calculateArea(feature.geometry.coordinates[0]);
        stats.totalArea = boundaryArea;
        updateStats();
        showNotification('Site boundary created! Area: ' + boundaryArea + ' ha', 'success');

    } else if (feature.geometry.type === 'LineString') {
        feature.properties = feature.properties || {};
        feature.properties.type = 'access-road'; // 🧠 IMPORTANT
        accessRoads.push(feature);               // 🧠 Store it!
        map.getSource('access-roads').setData({
            type: 'FeatureCollection',
            features: accessRoads
        });

        showNotification('Access road added!', 'success');
    }

    currentTool = null;
    document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
    setTimeout(() => {
        draw.changeMode('simple_select');
    }, 100);
});

// Additional escape handlers
map.on('draw.modechange', function(e) {
    if (e.mode === 'simple_select' && currentTool) {
        currentTool = null;
        document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
        showNotification('Drawing completed');
    }
});

// Handle escape key and double-click
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && currentTool) {
        currentTool = null;
        document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
        draw.changeMode('simple_select');
        showNotification('Drawing cancelled');
    }
});

map.on('dblclick', function() {
    if (currentTool) {
        setTimeout(() => {
            currentTool = null;
            document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
            draw.changeMode('simple_select');
        }, 200);
    }
});

const houseGapMeters = 1;

// Generate plan
function generatePlan() {
    if (!siteBoundary) {
        showNotification('Please draw a site boundary first!', 'error');
        return;
    }
    
    if (accessRoads.length === 0) {
        showNotification('Please draw at least one access road!', 'error');
        return;
    }
    
    showLoading(true);
    showNotification('Generating masterplan...', 'info');
    
    setTimeout(() => {
        generateHousesAlongRoads();
        showLoading(false);
        showNotification('Masterplan generated with ' + stats.homeCount + ' houses!', 'success');
        updateStats();
    }, 1000);
}

// Main house generation function - UPDATED with second spine integration
function generateHousesAlongRoads() {
    houses = [];
    let spineRoads = [];

    if (!siteBoundary) {
        console.log('No site boundary found');
        return;
    }

    const boundaryCoords = siteBoundary.geometry.coordinates[0];

    // Process each access road and create spine roads
    accessRoads.forEach(road => {
        const coords = road.geometry.coordinates;

        // Convert access road to polygon
        const accessRoadPolygon = createSpineRoadPolygon(coords, 0.000072); // 8m width

if (accessRoadPolygon) {
    spineRoads.push({
        type: 'Feature',
        geometry: accessRoadPolygon,
        properties: { type: 'access-road' }
    });
}

        const accessEndPoint = coords[coords.length - 1];

        if (!isPointInPolygon(accessEndPoint, boundaryCoords)) return;

        const closestEdge = findClosestBoundaryEdge(accessEndPoint, boundaryCoords);
        if (!closestEdge) return;

        const spineWidth = 0.000045;
        const boundaryBuffer = 0.000050;

        const leftLength = calculateSpineLengthInDirection(
            accessEndPoint,
            [-closestEdge.direction[0], -closestEdge.direction[1]],
            boundaryCoords,
            boundaryBuffer
        );

        const rightLength = calculateSpineLengthInDirection(
            accessEndPoint,
            closestEdge.direction,
            boundaryCoords,
            boundaryBuffer
        );

        const spineStart = [
            accessEndPoint[0] - closestEdge.direction[0] * leftLength,
            accessEndPoint[1] - closestEdge.direction[1] * leftLength
        ];

        const spineEnd = [
            accessEndPoint[0] + closestEdge.direction[0] * rightLength,
            accessEndPoint[1] + closestEdge.direction[1] * rightLength
        ];

        const spineLine = [spineStart, spineEnd];
        const spinePolygon = createSpineRoadPolygon(spineLine, spineWidth);

        if (spinePolygon) {
            spineRoads.push({
                type: 'Feature',
                geometry: spinePolygon,
                properties: { type: 'spine-road' }
            });
        }

        // Generate houses along first spine
        generateHousesAlongSpine(spineLine, spineWidth, boundaryCoords);

        // Generate second spine from this first spine
        const secondSpineRoads = addSecondSpine(boundaryCoords, spineLine);
        if (secondSpineRoads && secondSpineRoads.length > 0) {
            spineRoads.push(...secondSpineRoads);
        }
    });

    // Update map with all roads (access roads + spine roads + second spine roads)
    const allRoads = [...accessRoads, ...spineRoads];
    map.getSource('access-roads').setData({
        type: 'FeatureCollection',
        features: allRoads
    });

    // Update map with all houses
    map.getSource('houses').setData({
        type: 'FeatureCollection',
        features: houses
    });

    stats.homeCount = houses.length;
    console.log('Generated', houses.length, 'houses total with', spineRoads.length, 'spine roads');
}

function generateHousesAlongSpine(spineLine, spineWidth, boundaryCoords) {
  const lat = map.getCenter().lat;
  const houseType = {
    width: 11,
    length: 7,
    setbackFront: 3,
    setbackBack: 3
  };
  const dimensions = {
    widthDeg: metersToDegrees(houseType.width, lat).lng,
    lengthDeg: metersToDegrees(houseType.length, lat).lng,
    setbackFrontDeg: metersToDegrees(houseType.setbackFront, lat).lng,
    setbackBackDeg: metersToDegrees(houseType.setbackBack, lat).lng
  };
  const houseGapMeters = 8;  // Increased from 4 to 8
  const houseSpacing = dimensions.lengthDeg + metersToDegrees(houseGapMeters, lat).lng;
  const houseHeight = 4;
  
  const spineDx = spineLine[1][0] - spineLine[0][0];
  const spineDy = spineLine[1][1] - spineLine[0][1];
  const spineLength = Math.sqrt(spineDx ** 2 + spineDy ** 2);
  if (spineLength === 0) return;
  
  const unitDirection = [spineDx / spineLength, spineDy / spineLength];
  const perpDirection = [-unitDirection[1], unitDirection[0]];
  const spineAngle = Math.atan2(spineDy, spineDx);
  
  // Add start buffer
  const startBufferMeters = 15;
  const startBufferDeg = metersToDegrees(startBufferMeters, lat).lng;
  
  const numHouses = Math.floor((spineLength - startBufferDeg) / houseSpacing);
  
  for (let i = 0; i < numHouses; i++) {
    const offsetAlong = startBufferDeg + (i * houseSpacing);
    const spineX = spineLine[0][0] + unitDirection[0] * offsetAlong;
    const spineY = spineLine[0][1] + unitDirection[1] * offsetAlong;
    
    [-1, 1].forEach(side => {
      const sideClearanceMeters = 2;  // Increased clearance
      const sideClearanceDeg = metersToDegrees(sideClearanceMeters, lat).lng;
      const offsetDistance = spineWidth / 2 + dimensions.setbackFrontDeg + dimensions.widthDeg / 2 + sideClearanceDeg;
      
      const houseX = spineX + perpDirection[0] * side * offsetDistance;
      const houseY = spineY + perpDirection[1] * side * offsetDistance;
      const housePoint = [houseX, houseY];

      // Check if house center is inside boundary
      if (!isPointInPolygon(housePoint, boundaryCoords)) {
        return; // Skip this house
      }

      // Check if too close to access roads
      const tooCloseToAccessRoad = accessRoads.some(road => {
        if (road.geometry?.coordinates) {
          return isPointOnAccessRoad(housePoint, road.geometry.coordinates, 0.00015);
        }
        return false;
      });

      if (tooCloseToAccessRoad) {
        return; // Skip this house
      }

      // Create the house (only once!)
      const house = createRotatedHouse(
        houseX,
        houseY,
        dimensions.lengthDeg,
        dimensions.widthDeg,
        spineAngle
      );

      // Check ALL corners are inside boundary
      if (house && house.coordinates[0].every(corner => isPointInPolygon(corner, boundaryCoords))) {
        houses.push({
          type: 'Feature',
          geometry: house,
          properties: {
            height: houseHeight
          }
        });
      }
 

houses.push({
  type: 'Feature',
  geometry: house,
  properties: {
    height: houseHeight
  }
});
    
            
function findOppositeBoundaryEdge(firstSpineLine, boundaryCoords) {
    const [start, end] = firstSpineLine;
    const spineDx = end[0] - start[0];
    const spineDy = end[1] - start[1];
    const spineLength = Math.sqrt(spineDx * spineDx + spineDy * spineDy);
    const spineDir = [spineDx / spineLength, spineDy / spineLength];

    let bestEdge = null;
    let bestOpposition = 1; // we want the most negative (closest to -1)

    for (let i = 0; i < boundaryCoords.length - 1; i++) {
        const a = boundaryCoords[i];
        const b = boundaryCoords[i + 1];

        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const length = Math.sqrt(dx * dx + dy * dy);
        const dir = [dx / length, dy / length];

        const dot = spineDir[0] * dir[0] + spineDir[1] * dir[1]; // no abs here!

        if (dot < bestOpposition) {
            bestOpposition = dot;
            bestEdge = {
                start: a,
                end: b,
                direction: dir,
                alignment: dot
            };
        }
    }

    return bestEdge;
}

function addSecondSpine(boundaryCoords, firstSpineLine) {
    const spineWidth = 0.000045;
    const boundaryBuffer = 0.000050;

    // ✅ Get the opposite boundary edge relative to first spine
    const oppositeEdge = findOppositeBoundaryEdge(firstSpineLine, boundaryCoords);
    if (!oppositeEdge) return [];

// Rotate the edge direction 90° counterclockwise to get a perpendicular vector

const midX = (oppositeEdge.start[0] + oppositeEdge.end[0]) / 2;
const midY = (oppositeEdge.start[1] + oppositeEdge.end[1]) / 2;

// 1. Get perpendicular direction (90° rotated vector)
let perp = [-oppositeEdge.direction[1], oppositeEdge.direction[0]];
const inset = 0.00018; // ~18m clearance from boundary

// 2. Test direction: is perp pointing INTO the polygon?
const testPoint = [
  midX + perp[0] * 0.0001,
  midY + perp[1] * 0.0001
];

// 3. If the test point is *outside*, flip perp direction
if (!isPointInPolygon(testPoint, boundaryCoords)) {
  perp = [-perp[0], -perp[1]];
}

// 4. Now offset correctly
const hitPoint = [
  midX + perp[0] * inset,
  midY + perp[1] * inset
];
    const edgeDirection = oppositeEdge.direction;

    const leftLength = calculateSpineLengthInDirection(
        hitPoint,
        [-edgeDirection[0], -edgeDirection[1]],
        boundaryCoords,
        boundaryBuffer
    );

    const rightLength = calculateSpineLengthInDirection(
        hitPoint,
        edgeDirection,
        boundaryCoords,
        boundaryBuffer
    );

    const spineStart = [
        hitPoint[0] - edgeDirection[0] * leftLength,
        hitPoint[1] - edgeDirection[1] * leftLength
    ];

    const spineEnd = [
        hitPoint[0] + edgeDirection[0] * rightLength,
        hitPoint[1] + edgeDirection[1] * rightLength
    ];

    const spineLine = [spineStart, spineEnd];
    const spinePolygon = createSpineRoadPolygon(spineLine, spineWidth);
    if (!spinePolygon) return [];

    const spineLength = Math.sqrt(
  Math.pow(spineEnd[0] - spineStart[0], 2) +
  Math.pow(spineEnd[1] - spineStart[1], 2)
);

console.log('Second spine length (degrees):', spineLength);

    // ✅ Generate houses for this second spine
    generateHousesAlongSpine(spineLine, spineWidth, boundaryCoords);

    return [{
        type: 'Feature',
        geometry: spinePolygon,
        properties: { type: 'spine-road' }
    }];
}
// Helper functions
function calculateSpineLengthInDirection(startPoint, direction, boundaryCoords, buffer) {
    let maxLength = 0;
    const step = 0.00005;
    
    for (let length = 0; length < 0.005; length += step) {
        const testPoint = [
            startPoint[0] + direction[0] * length,
            startPoint[1] + direction[1] * length
        ];
        
        if (!isPointInPolygon(testPoint, boundaryCoords)) {
            maxLength = Math.max(0, length - buffer);
            break;
        }
        maxLength = length;
    }
    
    return Math.max(0, maxLength - buffer/2);
}

function findClosestBoundaryEdge(point, boundaryCoords) {
    let closestDistance = Infinity;
    let closestEdge = null;
    
    for (let i = 0; i < boundaryCoords.length - 1; i++) {
        const start = boundaryCoords[i];
        const end = boundaryCoords[i + 1];
        
        const distance = pointToLineDistance(point, start, end);
        if (distance < closestDistance) {
            closestDistance = distance;
            
            const dx = end[0] - start[0];
            const dy = end[1] - start[1];
            const length = Math.sqrt(dx*dx + dy*dy);
            
            closestEdge = {
                start: start,
                end: end,
                direction: [dx/length, dy/length],
                distance: distance
            };
        }
    }
    
    return closestEdge;
}



function createRotatedHouse(centerX, centerY, width, length, angle) {
    const halfWidth = width / 2;
    const halfLength = length / 2;
    
    const corners = [
        [-halfLength, -halfWidth],
        [halfLength, -halfWidth], 
        [halfLength, halfWidth],
        [-halfLength, halfWidth],
        [-halfLength, -halfWidth]
    ];
    
    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);
    
    const rotatedCorners = corners.map(([x, y]) => {
        const rotatedX = x * cosAngle - y * sinAngle;
        const rotatedY = x * sinAngle + y * cosAngle;
        
        return [
            centerX + rotatedX,
            centerY + rotatedY
        ];
    });
    
    return {
        type: 'Polygon',
        coordinates: [rotatedCorners]
    };
}

function createSpineRoadPolygon(coords, width) {
    if (coords.length < 2) return null;
    
    const halfWidth = width / 2;
    const leftSide = [];
    const rightSide = [];
    
    for (let i = 0; i < coords.length; i++) {
        let perpX, perpY;
        
        if (i === 0) {
            const dx = coords[1][0] - coords[0][0];
            const dy = coords[1][1] - coords[0][1];
            const length = Math.sqrt(dx*dx + dy*dy);
            perpX = -dy / length * halfWidth;
            perpY = dx / length * halfWidth;
        } else if (i === coords.length - 1) {
            const dx = coords[i][0] - coords[i-1][0];
            const dy = coords[i][1] - coords[i-1][1];
            const length = Math.sqrt(dx*dx + dy*dy);
            perpX = -dy / length * halfWidth;
            perpY = dx / length * halfWidth;
        } else {
            const dx1 = coords[i][0] - coords[i-1][0];
            const dy1 = coords[i][1] - coords[i-1][1];
            const dx2 = coords[i+1][0] - coords[i][0];
            const dy2 = coords[i+1][1] - coords[i][1];
            
            const len1 = Math.sqrt(dx1*dx1 + dy1*dy1);
            const len2 = Math.sqrt(dx2*dx2 + dy2*dy2);
            
            const avgDx = (dx1/len1 + dx2/len2) / 2;
            const avgDy = (dy1/len1 + dy2/len2) / 2;
            const avgLen = Math.sqrt(avgDx*avgDx + avgDy*avgDy);
            
            perpX = -avgDy / avgLen * halfWidth;
            perpY = avgDx / avgLen * halfWidth;
        }
        
        leftSide.push([coords[i][0] + perpX, coords[i][1] + perpY]);
        rightSide.push([coords[i][0] - perpX, coords[i][1] - perpY]);
    }
    
    const polygon = [...leftSide, ...rightSide.reverse(), leftSide[0]];
    
    return {
        type: 'Polygon',
        coordinates: [polygon]
    };
}

function isPointInPolygon(point, polygon) {
    const [x, y] = point;
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    
    return inside;
}

function isPointOnAccessRoad(point, roadCoords, buffer) {
    if (!roadCoords || roadCoords.length < 2) return false;
    
    for (let i = 1; i < roadCoords.length; i++) {
        const distance = pointToLineDistance(point, roadCoords[i-1], roadCoords[i]);
        if (distance < buffer) {
            return true;
        }
    }
    return false;
}

function pointToLineDistance(point, lineStart, lineEnd) {
    const dx = lineEnd[0] - lineStart[0];
    const dy = lineEnd[1] - lineStart[1];
    const length = Math.sqrt(dx*dx + dy*dy);
    
    if (length === 0) return Math.sqrt((point[0] - lineStart[0])**2 + (point[1] - lineStart[1])**2);
    
    const t = Math.max(0, Math.min(1, ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / (length * length)));
    const projection = [lineStart[0] + t * dx, lineStart[1] + t * dy];
    
    return Math.sqrt((point[0] - projection[0])**2 + (point[1] - projection[1])**2);
}

function clearAll() {
    siteBoundary = null;
    accessRoads = [];
    houses = [];
    stats = { totalArea: 0, homeCount: 0, density: 0 };
    
    map.getSource('site-boundary').setData({ type: 'FeatureCollection', features: [] });
    map.getSource('access-roads').setData({ type: 'FeatureCollection', features: [] });
    map.getSource('houses').setData({ type: 'FeatureCollection', features: [] });
    
    draw.deleteAll();
    
    currentTool = null;
    document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
    draw.changeMode('simple_select');
    
    updateStats();
    showNotification('All cleared!', 'success');
}

function calculateArea(coordinates) {
    let area = 0;
    const numPoints = coordinates.length - 1;

    for (let i = 0; i < numPoints; i++) {
        const j = (i + 1) % numPoints;
        area += coordinates[i][0] * coordinates[j][1];
        area -= coordinates[j][0] * coordinates[i][1];
    }

    area = Math.abs(area) / 2;

    // Approximate meters per degree at current latitude
    const avgLat = coordinates.reduce((sum, c) => sum + c[1], 0) / coordinates.length;
    const metersPerDegLat = 111320;
    const metersPerDegLng = 40075000 * Math.cos(avgLat * Math.PI / 180) / 360;

    const sqMeters = area * metersPerDegLat * metersPerDegLng;
    const hectares = sqMeters / 10000;

    return Math.round(hectares * 100) / 100;
}

function showNotification(message, type) {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = 'notification show ' + (type || 'info');
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
}

function updateStats() {
    const displayArea = stats.totalArea || 0;
    document.getElementById('total-area').textContent = displayArea + ' ha';
    document.getElementById('home-count').textContent = stats.homeCount;

    if (stats.totalArea > 0) {
        stats.density = Math.round(stats.homeCount / stats.totalArea);
    } else {
        stats.density = 0;
    }

    document.getElementById('density').textContent = stats.density + ' homes/ha';
}

function metersToDegrees(meters, latitude = 51.5) {
  const metersPerDegLat = 111320;
  const metersPerDegLng = 40075000 * Math.cos(latitude * Math.PI / 180) / 360;

  return {
    lat: meters / metersPerDegLat,
    lng: meters / metersPerDegLng
  };
}

updateStats();
