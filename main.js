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

    } else if (currentTool === 'road') {
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
            road.geometry = accessRoadPolygon;
            road.properties = { type: 'access-road' };
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
        const secondSpineRoads = addSecondSpine(boundaryCoords, spineLine, closestEdge.direction);
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

// Extract house generation logic into separate function for reuse
function generateHousesAlongSpine(spineLine, spineWidth, boundaryCoords) {
    const houseSpacing = 0.000063;
    const rowOffset = 0.00008;
    const houseWidth = 0.000045;
    const houseLength = 0.000045;
    const houseHeight = 4;

    const spineDirection = [
        spineLine[1][0] - spineLine[0][0],
        spineLine[1][1] - spineLine[0][1]
    ];

    const totalSpineLength = Math.sqrt(spineDirection[0] ** 2 + spineDirection[1] ** 2);
    if (totalSpineLength === 0) return;

    const spineAngle = Math.atan2(spineDirection[1], spineDirection[0]);

    const perpDirection = [
        -spineDirection[1] / totalSpineLength,
        spineDirection[0] / totalSpineLength
    ];

    const numHouses = Math.floor(totalSpineLength / houseSpacing);

    for (let i = 0; i <= numHouses; i++) {
        const t = i / Math.max(numHouses, 1);
        const spineX = spineLine[0][0] + t * spineDirection[0];
        const spineY = spineLine[0][1] + t * spineDirection[1];

        [-1, 1].forEach(side => {
            const houseX = spineX + perpDirection[0] * side * (spineWidth / 2 + rowOffset);
            const houseY = spineY + perpDirection[1] * side * (spineWidth / 2 + rowOffset);
            const housePoint = [houseX, houseY];

            if (
                isPointInPolygon(housePoint, boundaryCoords) &&
                !isPointOnAccessRoad(housePoint, accessRoads[0]?.geometry?.coordinates || [], 0.00008)
            ) {
                const house = createRotatedHouse(houseX, houseY, houseLength, houseWidth, spineAngle);
                
                if (house && house.coordinates[0].every(corner => isPointInPolygon(corner, boundaryCoords))) {
                    houses.push({
                        type: 'Feature',
                        geometry: house,
                        properties: {
                            type: 'house',
                            id: houses.length + 1,
                            height: houseHeight
                        }
                    });
                }
            }
        });
    }
}

function findOppositeBoundaryEdge(firstSpineLine, boundaryCoords) {
    const [start, end] = firstSpineLine;
    const spineDx = end[0] - start[0];
    const spineDy = end[1] - start[1];
    const spineLength = Math.sqrt(spineDx * spineDx + spineDy * spineDy);
    const spineDir = [spineDx / spineLength, spineDy / spineLength];

    let bestEdge = null;
    let bestAlignment = -1;

    for (let i = 0; i < boundaryCoords.length - 1; i++) {
        const a = boundaryCoords[i];
        const b = boundaryCoords[i + 1];

        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const length = Math.sqrt(dx * dx + dy * dy);
        const dir = [dx / length, dy / length];

        // Take absolute dot product to find alignment (1 = parallel, 0 = perpendicular)
        const dot = Math.abs(spineDir[0] * dir[0] + spineDir[1] * dir[1]);

        if (dot > bestAlignment) {
            bestAlignment = dot;
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

function addSecondSpine(boundaryCoords, firstSpineLine, firstSpineDirection) {
    const spineWidth = 0.000045;
    const boundaryBuffer = 0.000050;

    // Midpoint of first spine
    const midX = (firstSpineLine[0][0] + firstSpineLine[1][0]) / 2;
    const midY = (firstSpineLine[0][1] + firstSpineLine[1][1]) / 2;

    // Vector perpendicular to first spine
    const perp = [-firstSpineDirection[1], firstSpineDirection[0]];
    const perpLength = Math.sqrt(perp[0] ** 2 + perp[1] ** 2);
    const unitPerp = [perp[0] / perpLength, perp[1] / perpLength];

    const houseOffsetFromRoad = 0.00008;
    const spineToEdgeOffset = houseOffsetFromRoad + spineWidth / 2;

    const oppositeEdge = findOppositeBoundaryEdge(firstSpineLine, boundaryCoords);
    if (!oppositeEdge) return [];

    const edgeMidX = (oppositeEdge.start[0] + oppositeEdge.end[0]) / 2;
    const edgeMidY = (oppositeEdge.start[1] + oppositeEdge.end[1]) / 2;

    const secondMidpoint = [
        edgeMidX - oppositeEdge.direction[0] * spineToEdgeOffset,
        edgeMidY - oppositeEdge.direction[1] * spineToEdgeOffset
    ];
    // ✅ Add this check here
if (!isPointInPolygon(secondMidpoint, boundaryCoords)) {
    return []; // Don't add second spine if midpoint is outside the site
}

    const spineDirection = oppositeEdge.direction;

    const leftLength = calculateSpineLengthInDirection(
        secondMidpoint,
        [-spineDirection[0], -spineDirection[1]],
        boundaryCoords,
        boundaryBuffer
    );

    const rightLength = calculateSpineLengthInDirection(
        secondMidpoint,
        spineDirection,
        boundaryCoords,
        boundaryBuffer
    );

    const spineStart = [
        secondMidpoint[0] - spineDirection[0] * leftLength,
        secondMidpoint[1] - spineDirection[1] * leftLength
    ];

    const spineEnd = [
        secondMidpoint[0] + spineDirection[0] * rightLength,
        secondMidpoint[1] + spineDirection[1] * rightLength
    ];

    const spineLine = [spineStart, spineEnd];
    const spinePolygon = createSpineRoadPolygon(spineLine, spineWidth);
    if (!spinePolygon) return [];

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
    // Create perfect rectangular house that rotates to match spine angle
    const halfWidth = width / 2;
    const halfLength = length / 2;
    
    // Create corners as a perfect rectangle (5m x 5m)
    const corners = [
        [-halfLength, -halfWidth],
        [halfLength, -halfWidth], 
        [halfLength, halfWidth],
        [-halfLength, halfWidth],
        [-halfLength, -halfWidth]
    ];
    
    // Apply rotation transformation
    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);
    
    const rotatedCorners = corners.map(([x, y]) => {
        // Rotate each corner around the center
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

updateStats();
