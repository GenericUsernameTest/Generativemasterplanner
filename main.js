// Mapbox Configuration
mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';

// Initialize map with center and zoom
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n',
    center: [-0.1278, 51.5074],
    zoom: 15
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

map.on('load', function() {
    console.log('Map loaded');
    showNotification('Map loaded!', 'success');

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

    // Site boundary layers
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

    // Access roads (8m wide) - LINES
    map.addLayer({
        id: 'access-road-lines',
        type: 'line',
        source: 'access-roads',
        filter: ['!=', ['get', 'type'], 'spine-road'],
        paint: { 
            'line-color': '#95a5a6',
            'line-width': 20,
            'line-opacity': 0.8 
        }
    });

    // Spine roads (5m wide) - POLYGONS
    map.addLayer({
        id: 'spine-roads',
        type: 'fill',
        source: 'access-roads',
        filter: ['==', ['get', 'type'], 'spine-road'],
        paint: { 
            'fill-color': '#7f8c8d',
            'fill-opacity': 0.9
        }
    });

    // Houses layer
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

// Drawing events
map.on('draw.create', function(e) {
    const feature = e.features[0];
    
    if (currentTool === 'boundary') {
        siteBoundary = feature;
        map.getSource('site-boundary').setData({
            type: 'FeatureCollection',
            features: [feature]
        });
        
        const area = calculateArea(feature.geometry.coordinates[0]);
        stats.totalArea = area;
        updateStats();
        showNotification('Site boundary created!', 'success');
        
    } else if (currentTool === 'road') {
        accessRoads.push(feature);
        map.getSource('access-roads').setData({
            type: 'FeatureCollection',
            features: accessRoads
        });
        showNotification('Access road created!', 'success');
    }
    
    // Deactivate tool
    currentTool = null;
    document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
    draw.changeMode('simple_select');
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

// Main house generation function
function generateHousesAlongRoads() {
    houses = [];
    let spineRoads = [];
    
    if (!siteBoundary) return;
    
    const boundaryCoords = siteBoundary.geometry.coordinates[0];
    
    accessRoads.forEach(road => {
        const coords = road.geometry.coordinates;
        
        // Get END point of access road
        const accessEndPoint = coords[coords.length - 1];
        
        if (!isPointInPolygon(accessEndPoint, boundaryCoords)) return;
        
        // Find closest boundary edge
        const closestEdge = findClosestBoundaryEdge(accessEndPoint, boundaryCoords);
        if (!closestEdge) return;
        
        // Create spine road
        const spineWidth = 0.000045; // 5m
        const buffer = 0.000020;
        
        const leftLength = calculateSpineLengthInDirection(
            accessEndPoint, 
            [-closestEdge.direction[0], -closestEdge.direction[1]],
            boundaryCoords, 
            buffer
        );
        
        const rightLength = calculateSpineLengthInDirection(
            accessEndPoint, 
            closestEdge.direction, 
            boundaryCoords, 
            buffer
        );
        
        const spineStart = [
            accessEndPoint[0] - closestEdge.direction[0] * leftLength,
            accessEndPoint[1] - closestEdge.direction[1] * leftLength
        ];
        
        const spineEnd = [
            accessEndPoint[0] + closestEdge.direction[0] * rightLength,
            accessEndPoint[1] + closestEdge.direction[1] * rightLength
        ];
        
        // Create spine polygon
        const spinePolygon = createSpineRoadPolygon([spineStart, spineEnd], spineWidth);
        
        if (spinePolygon) {
            spineRoads.push({
                type: 'Feature',
                geometry: spinePolygon,
                properties: { type: 'spine-road' }
            });
        }
        
        // Generate houses
        const houseSpacing = 0.00005;
        const rowOffset = 0.00008;
        const houseWidth = 0.000020;
        const houseLength = 0.000030;
        
        const spineDirection = [spineEnd[0] - spineStart[0], spineEnd[1] - spineStart[1]];
        const totalSpineLength = Math.sqrt(spineDirection[0]**2 + spineDirection[1]**2);
        const spineAngle = Math.atan2(spineDirection[1], spineDirection[0]);
        
        const perpDirection = [
            -spineDirection[1] / totalSpineLength,
            spineDirection[0] / totalSpineLength
        ];
        
        const numHouses = Math.floor(totalSpineLength / houseSpacing);
        
        for (let i = 0; i <= numHouses; i++) {
            const t = i / Math.max(numHouses, 1);
            const spineX = spineStart[0] + t * spineDirection[0];
            const spineY = spineStart[1] + t * spineDirection[1];
            
            [-1, 1].forEach(side => {
                const houseX = spineX + perpDirection[0] * side * (spineWidth/2 + rowOffset);
                const houseY = spineY + perpDirection[1] * side * (spineWidth/2 + rowOffset);
                
                const housePoint = [houseX, houseY];
                
                if (isPointInPolygon(housePoint, boundaryCoords) &&
                    !isPointOnAccessRoad(housePoint, coords, 0.00008)) {
                    
                    const house = createRotatedHouse(houseX, houseY, houseWidth, houseLength, spineAngle);
                    
                    if (house && house.coordinates[0].every(corner => isPointInPolygon(corner, boundaryCoords))) {
                        houses.push({
                            type: 'Feature',
                            geometry: house,
                            properties: { type: 'house', id: houses.length + 1 }
                        });
                    }
                }
            });
        }
    });
    
    // Update map
    const allRoads = [...accessRoads, ...spineRoads];
    map.getSource('access-roads').setData({
        type: 'FeatureCollection',
        features: allRoads
    });
    
    map.getSource('houses').setData({
        type: 'FeatureCollection',
        features: houses
    });
    
    stats.homeCount = houses.length;
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
    
    const rotatedCorners = corners.map(([x, y]) => {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rotatedX = x * cos - y * sin;
        const rotatedY = x * sin + y * cos;
        return [centerX + rotatedX, centerY + rotatedY];
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
    const hectares = area * 12100;
    return Math.round(hectares * 100) / 100;
}

function updateStats() {
    document.getElementById('total-area').textContent = stats.totalArea + ' ha';
    document.getElementById('home-count').textContent = stats.homeCount;
    
    if (stats.totalArea > 0) {
        stats.density = Math.round((stats.homeCount / stats.totalArea) * 10) / 10;
    } else {
        stats.density = 0;
    }
    
    document.getElementById('density').textContent = stats.density + ' homes/ha';
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

updateStats();
