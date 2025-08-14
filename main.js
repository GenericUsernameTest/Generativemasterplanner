// Mapbox Configuration
mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';

// Clean initialization with your B&W style - no forcing or overrides
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n',
    center: [-0.1278, 51.5074],
    zoom: 15
});

// Simple error logging - no fallbacks or forcing
map.on('error', function(e) {
    console.error('Map error:', e.error);
    showNotification('Map error: ' + e.error.message, 'error');
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
    console.log('Map loaded with style');
    showNotification('Map loaded with custom style!', 'success');

    // Add sources for features
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

    // Access roads (8m wide)
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

    // Spine roads (5m wide)
    map.addLayer({
        id: 'access-roads',
        type: 'fill',
        source: 'access-roads',
        filter: ['==', ['get', 'type'], 'spine-road'],
        paint: { 
            'fill-color': '#7f8c8d',
            'fill-opacity': 0.8
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
    // Reset all buttons
    document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));

    if (currentTool === tool) {
        // Deactivate current tool
        currentTool = null;
        draw.changeMode('simple_select');
        showNotification('Tool deactivated');
    } else {
        // Activate new tool
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
        
        // Force deactivate boundary tool
        currentTool = null;
        document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
        draw.changeMode('simple_select');
        
    } else if (currentTool === 'road') {
        accessRoads.push(feature);
        map.getSource('access-roads').setData({
            type: 'FeatureCollection',
            features: accessRoads
        });
        showNotification('Access road created!', 'success');
        
        // Force deactivate road tool
        currentTool = null;
        document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
        draw.changeMode('simple_select');
    }
});

// Also handle when user finishes drawing manually
map.on('draw.modechange', function(e) {
    if (e.mode === 'simple_select' && currentTool) {
        // User manually finished drawing, deactivate tool
        currentTool = null;
        document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
        showNotification('Drawing completed');
    }
});

// Handle double-click to finish polygon
map.on('dblclick', function() {
    if (currentTool) {
        setTimeout(() => {
            currentTool = null;
            document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
            draw.changeMode('simple_select');
        }, 100);
    }
});

// Generate plan with visual feedback
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
        // Simulate house generation along roads
        generateHousesAlongRoads();
        
        showLoading(false);
        showNotification('Masterplan generated with ' + stats.homeCount + ' houses!', 'success');
        updateStats();
    }, 2000);
}

// Generate houses along access roads with proper spine alignment
function generateHousesAlongRoads() {
    houses = []; // Clear existing houses
    let spineRoads = []; // Array to hold spine roads
    
    if (!siteBoundary) {
        console.log('No site boundary found');
        return;
    }
    
    accessRoads.forEach(road => {
        const coords = road.geometry.coordinates;
        const boundaryCoords = siteBoundary.geometry.coordinates[0];
        
        // Get the END point of the access road (last coordinate)
        const accessEndPoint = coords[coords.length - 1];
        
        // Find the closest boundary edge to run spine parallel to
        const closestEdge = findClosestBoundaryEdge(accessEndPoint, boundaryCoords);
        if (!closestEdge) return;
        
        // Create spine road starting from access road end point
        const spineWidth = 0.000045; // 5m spine road width
        const buffer = 0.000045; // 5m buffer from edges
        
        // Calculate spine length in both directions from access end point
        const leftLength = calculateSpineLengthInDirection(
            accessEndPoint, 
            [-closestEdge.direction[0], -closestEdge.direction[1]], // Opposite direction
            boundaryCoords, 
            buffer
        );
        
        const rightLength = calculateSpineLengthInDirection(
            accessEndPoint, 
            closestEdge.direction, 
            boundaryCoords, 
            buffer
        );
        
        // Create spine coordinates spanning across the site
        const spineStart = [
            accessEndPoint[0] - closestEdge.direction[0] * leftLength,
            accessEndPoint[1] - closestEdge.direction[1] * leftLength
        ];
        
        const spineEnd = [
            accessEndPoint[0] + closestEdge.direction[0] * rightLength,
            accessEndPoint[1] + closestEdge.direction[1] * rightLength
        ];
        
        // Create spine road polygon
        const spineCoords = [spineStart, spineEnd];
        const spinePolygon = createSpineRoadPolygon(spineCoords, spineWidth);
        
        if (spinePolygon) {
            spineRoads.push({
                type: 'Feature',
                geometry: spinePolygon,
                properties: {
                    type: 'spine-road'
                }
            });
        }
        
        // Generate houses along the spine with proper rotation
        const houseSpacing = 0.00006; // Distance between houses along spine
        const rowOffset = 0.00008; // Distance from spine edge to houses
        const houseWidth = 0.000025; // House width
        const houseLength = 0.000035; // House length (oriented along spine)
        
        // Calculate spine direction and angle
        const spineDirection = [
            spineEnd[0] - spineStart[0],
            spineEnd[1] - spineStart[1]
        ];
        const totalSpineLength = Math.sqrt(spineDirection[0]**2 + spineDirection[1]**2);
        const spineAngle = Math.atan2(spineDirection[1], spineDirection[0]);
        
        // Perpendicular direction for house rows
        const perpDirection = [
            -spineDirection[1] / totalSpineLength,
            spineDirection[0] / totalSpineLength
        ];
        
        // Number of houses along entire spine
        const numHouses = Math.floor(totalSpineLength / houseSpacing);
        
        for (let i = 0; i <= numHouses; i++) {
            const t = i / Math.max(numHouses, 1);
            const spineX = spineStart[0] + t * spineDirection[0];
            const spineY = spineStart[1] + t * spineDirection[1];
            
            // Create houses on both sides of spine
            [-1, 1].forEach(side => {
                const houseX = spineX + perpDirection[0] * side * (spineWidth/2 + rowOffset);
                const houseY = spineY + perpDirection[1] * side * (spineWidth/2 + rowOffset);
                
                // Create rotated house polygon
                const house = createRotatedHouse(houseX, houseY, houseWidth, houseLength, spineAngle);
                
                // Check if house is inside boundary
                if (house && isPointInPolygon([houseX, houseY], boundaryCoords)) {
                    houses.push({
                        type: 'Feature',
                        geometry: house,
                        properties: {
                            type: 'house',
                            id: houses.length + 1,
                            side: side
                        }
                    });
                }
            });
        }
    });
    
    // Update access roads to include spine roads
    const allRoads = [...accessRoads, ...spineRoads];
    map.getSource('access-roads').setData({
        type: 'FeatureCollection',
        features: allRoads
    });
    
    // Update houses on map
    map.getSource('houses').setData({
        type: 'FeatureCollection',
        features: houses
    });
    
    stats.homeCount = houses.length;
}

// Calculate spine length in a specific direction from start point
function calculateSpineLengthInDirection(startPoint, direction, boundaryCoords, buffer) {
    let maxLength = 0;
    const step = 0.00005; // Larger steps for better performance
    
    // Test points along the direction until we hit boundary
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
    
    // Extend spine to 100% of available space (minimal buffer)
    return Math.max(0, maxLength - buffer/2); // Reduce buffer for full coverage
}

// Generate houses along access roads with fixes
function generateHousesAlongRoads() {
    houses = []; // Clear existing houses
    let spineRoads = []; // Array to hold spine roads
    
    if (!siteBoundary) {
        console.log('No site boundary found');
        return;
    }
    
    accessRoads.forEach(road => {
        const coords = road.geometry.coordinates;
        const boundaryCoords = siteBoundary.geometry.coordinates[0];
        
        // Get the END point of the access road (last coordinate)
        const accessEndPoint = coords[coords.length - 1];
        
        // Find the closest boundary edge to run spine parallel to
        const closestEdge = findClosestBoundaryEdge(accessEndPoint, boundaryCoords);
        if (!closestEdge) return;
        
        // Create spine road starting from access road end point
        const spineWidth = 0.000045; // 5m spine road width
        const buffer = 0.000030; // Smaller buffer for 100% coverage
        
        // Calculate spine length in both directions from access end point
        const leftLength = calculateSpineLengthInDirection(
            accessEndPoint, 
            [-closestEdge.direction[0], -closestEdge.direction[1]], // Opposite direction
            boundaryCoords, 
            buffer
        );
        
        const rightLength = calculateSpineLengthInDirection(
            accessEndPoint, 
            closestEdge.direction, 
            boundaryCoords, 
            buffer
        );
        
        // Create spine coordinates spanning 100% across the site
        const spineStart = [
            accessEndPoint[0] - closestEdge.direction[0] * leftLength,
            accessEndPoint[1] - closestEdge.direction[1] * leftLength
        ];
        
        const spineEnd = [
            accessEndPoint[0] + closestEdge.direction[0] * rightLength,
            accessEndPoint[1] + closestEdge.direction[1] * rightLength
        ];
        
        // Create spine road polygon (clipped to boundary)
        const spineCoords = [spineStart, spineEnd];
        const spinePolygon = createSpineRoadPolygon(spineCoords, spineWidth);
        
        if (spinePolygon) {
            // Clip spine to boundary
            const clippedSpine = clipPolygonToBoundary(spinePolygon, boundaryCoords);
            if (clippedSpine) {
                spineRoads.push({
                    type: 'Feature',
                    geometry: clippedSpine,
                    properties: {
                        type: 'spine-road'
                    }
                });
            }
        }
        
        // Generate houses along the spine (avoiding roads)
        const houseSpacing = 0.00005; // Closer spacing
        const rowOffset = 0.00008; // Distance from spine edge to houses
        const houseWidth = 0.000025; // House width
        const houseLength = 0.000035; // House length
        
        // Calculate spine direction and angle
        const spineDirection = [
            spineEnd[0] - spineStart[0],
            spineEnd[1] - spineStart[1]
        ];
        const totalSpineLength = Math.sqrt(spineDirection[0]**2 + spineDirection[1]**2);
        const spineAngle = Math.atan2(spineDirection[1], spineDirection[0]);
        
        // Perpendicular direction for house rows
        const perpDirection = [
            -spineDirection[1] / totalSpineLength,
            spineDirection[0] / totalSpineLength
        ];
        
        // Number of houses along entire spine
        const numHouses = Math.floor(totalSpineLength / houseSpacing);
        
        for (let i = 0; i <= numHouses; i++) {
            const t = i / Math.max(numHouses, 1);
            const spineX = spineStart[0] + t * spineDirection[0];
            const spineY = spineStart[1] + t * spineDirection[1];
            
            // Create houses on both sides of spine
            [-1, 1].forEach(side => {
                const houseX = spineX + perpDirection[0] * side * (spineWidth/2 + rowOffset);
                const houseY = spineY + perpDirection[1] * side * (spineWidth/2 + rowOffset);
                
                // Check if house location is NOT on access road
                const housePoint = [houseX, houseY];
                if (!isPointOnAccessRoad(housePoint, coords, 0.00008)) { // Road avoidance
                    // Create rotated house polygon
                    const house = createRotatedHouse(houseX, houseY, houseWidth, houseLength, spineAngle);
                    
                    // Check if house is inside boundary
                    if (house && isPointInPolygon([houseX, houseY], boundaryCoords)) {
                        houses.push({
                            type: 'Feature',
                            geometry: house,
                            properties: {
                                type: 'house',
                                id: houses.length + 1,
                                side: side
                            }
                        });
                    }
                }
            });
        }
    });
    
    // Clip access roads to boundary
    const clippedAccessRoads = accessRoads.map(road => {
        const clippedCoords = clipLineStringToBoundary(road.geometry.coordinates, siteBoundary.geometry.coordinates[0]);
        return {
            ...road,
            geometry: {
                ...road.geometry,
                coordinates: clippedCoords
            }
        };
    });
    
    // Update access roads to include spine roads
    const allRoads = [...clippedAccessRoads, ...spineRoads];
    map.getSource('access-roads').setData({
        type: 'FeatureCollection',
        features: allRoads
    });
    
    // Update houses on map
    map.getSource('houses').setData({
        type: 'FeatureCollection',
        features: houses
    });
    
    stats.homeCount = houses.length;
}

// Check if point is on access road
function isPointOnAccessRoad(point, roadCoords, buffer) {
    for (let i = 1; i < roadCoords.length; i++) {
        const distance = pointToLineDistance(point, roadCoords[i-1], roadCoords[i]);
        if (distance < buffer) {
            return true;
        }
    }
    return false;
}

// Clip polygon to boundary
function clipPolygonToBoundary(polygon, boundary) {
    // Simple clipping - just return if all vertices are inside
    const coords = polygon.coordinates[0];
    const clippedCoords = coords.filter(coord => isPointInPolygon(coord, boundary));
    
    if (clippedCoords.length > 3) {
        return {
            type: 'Polygon',
            coordinates: [clippedCoords]
        };
    }
    return polygon; // Return original if clipping fails
}

// Clip LineString to boundary
function clipLineStringToBoundary(lineCoords, boundary) {
    return lineCoords.filter(coord => isPointInPolygon(coord, boundary));
}

// Calculate maximum spine length within boundary with buffer
function calculateMaxSpineLength(boundaryCoords, direction, startPoint, buffer) {
    let maxLength = 0;
    const step = 0.00001;
    
    // Test points along the direction until we hit boundary
    for (let length = 0; length < 0.002; length += step) {
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
    
    return Math.max(0, maxLength - buffer);
}

// Create properly rotated rectangular house
function createRotatedHouse(centerX, centerY, width, length, angle) {
    // House corners relative to center (rectangular, not square)
    const halfWidth = width / 2;
    const halfLength = length / 2;
    
    const corners = [
        [-halfLength, -halfWidth], // Bottom left
        [halfLength, -halfWidth],  // Bottom right  
        [halfLength, halfWidth],   // Top right
        [-halfLength, halfWidth],  // Top left
        [-halfLength, -halfWidth]  // Close polygon
    ];
    
    // Rotate corners around center
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

// Strict boundary checking - only allow elements INSIDE boundary
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

// Clip all coordinates to boundary
function clipLineStringToBoundary(lineCoords, boundary) {
    const clipped = [];
    
    for (let coord of lineCoords) {
        if (isPointInPolygon(coord, boundary)) {
            clipped.push(coord);
        }
    }
    
    return clipped.length > 1 ? clipped : lineCoords; // Return original if too few points
}

// Better house generation with strict boundary checking
function generateHousesAlongRoads() {
    houses = []; // Clear existing houses
    let spineRoads = []; // Array to hold spine roads
    
    if (!siteBoundary) {
        console.log('No site boundary found');
        return;
    }
    
    accessRoads.forEach(road => {
        const coords = road.geometry.coordinates;
        const boundaryCoords = siteBoundary.geometry.coordinates[0];
        
        // Clip access road to boundary first
        const clippedCoords = clipLineStringToBoundary(coords, boundaryCoords);
        
        if (clippedCoords.length < 2) return;
        
        // Get the END point of the clipped access road
        const accessEndPoint = clippedCoords[clippedCoords.length - 1];
        
        // Ensure access end point is inside boundary
        if (!isPointInPolygon(accessEndPoint, boundaryCoords)) {
            console.log('Access end point outside boundary');
            return;
        }
        
        // Find the closest boundary edge
        const closestEdge = findClosestBoundaryEdge(accessEndPoint, boundaryCoords);
        if (!closestEdge) return;
        
        // Create spine road with strict boundary checking
        const spineWidth = 0.000045; // 5m spine road width
        const buffer = 0.000020; // Smaller buffer for strict boundary
        
        // Calculate spine in both directions
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
        
        // Create spine coordinates
        const spineStart = [
            accessEndPoint[0] - closestEdge.direction[0] * leftLength,
            accessEndPoint[1] - closestEdge.direction[1] * leftLength
        ];
        
        const spineEnd = [
            accessEndPoint[0] + closestEdge.direction[0] * rightLength,
            accessEndPoint[1] + closestEdge.direction[1] * rightLength
        ];
        
        // Ensure spine points are inside boundary
        if (isPointInPolygon(spineStart, boundaryCoords) && isPointInPolygon(spineEnd, boundaryCoords)) {
            const spineCoords = [spineStart, spineEnd];
            const spinePolygon = createSpineRoadPolygon(spineCoords, spineWidth);
            
            if (spinePolygon) {
                spineRoads.push({
                    type: 'Feature',
                    geometry: spinePolygon,
                    properties: {
                        type: 'spine-road'
                    }
                });
            }
        }
        
        // Generate houses with strict boundary and road checking
        const houseSpacing = 0.00005;
        const rowOffset = 0.00008;
        const houseWidth = 0.000020; // Smaller houses
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
                
                // Multiple checks: boundary, road avoidance
                if (isPointInPolygon(housePoint, boundaryCoords) &&
                    !isPointOnAccessRoad(housePoint, clippedCoords, 0.00008)) {
                    
                    const house = createRotatedHouse(houseX, houseY, houseWidth, houseLength, spineAngle);
                    
                    // Check all house corners are inside boundary
                    const allCornersInside = house.coordinates[0].every(corner => 
                        isPointInPolygon(corner, boundaryCoords)
                    );
                    
                    if (allCornersInside) {
                        houses.push({
                            type: 'Feature',
                            geometry: house,
                            properties: {
                                type: 'house',
                                id: houses.length + 1,
                                side: side
                            }
                        });
                    }
                }
            });
        }
        
        // Update clipped road in the array
        road.geometry.coordinates = clippedCoords;
    });
    
    // Update roads (all clipped to boundary)
    const allRoads = [...accessRoads, ...spineRoads];
    map.getSource('access-roads').setData({
        type: 'FeatureCollection',
        features: allRoads
    });
    
    // Update houses
    map.getSource('houses').setData({
        type: 'FeatureCollection',
        features: houses
    });
    
    stats.homeCount = houses.length;
}

// Check if point is inside polygon
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

// Find where access road connects to site boundary
function findBoundaryConnection(roadCoords, boundaryCoords) {
    let closestDistance = Infinity;
    let closestPoint = null;
    let closestRoadPoint = null;
    
    // Check each road point against boundary
    roadCoords.forEach(roadPoint => {
        // Check distance to each boundary segment
        for (let i = 0; i < boundaryCoords.length - 1; i++) {
            const boundaryStart = boundaryCoords[i];
            const boundaryEnd = boundaryCoords[i + 1];
            
            const distance = pointToLineDistance(roadPoint, boundaryStart, boundaryEnd);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestPoint = roadPoint;
                closestRoadPoint = roadPoint;
            }
        }
    });
    
    return closestPoint ? { point: closestPoint, distance: closestDistance } : null;
}

// Find the closest boundary edge to a point
function findClosestBoundaryEdge(point, boundaryCoords) {
    let closestDistance = Infinity;
    let closestEdge = null;
    
    for (let i = 0; i < boundaryCoords.length - 1; i++) {
        const start = boundaryCoords[i];
        const end = boundaryCoords[i + 1];
        
        const distance = pointToLineDistance(point, start, end);
        if (distance < closestDistance) {
            closestDistance = distance;
            
            // Calculate edge direction (normalized)
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

// Calculate distance from point to line segment
function pointToLineDistance(point, lineStart, lineEnd) {
    const dx = lineEnd[0] - lineStart[0];
    const dy = lineEnd[1] - lineStart[1];
    const length = Math.sqrt(dx*dx + dy*dy);
    
    if (length === 0) return Math.sqrt((point[0] - lineStart[0])**2 + (point[1] - lineStart[1])**2);
    
    const t = Math.max(0, Math.min(1, ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / (length * length)));
    const projection = [lineStart[0] + t * dx, lineStart[1] + t * dy];
    
    return Math.sqrt((point[0] - projection[0])**2 + (point[1] - projection[1])**2);
}

// Helper function to create spine road polygon with rounded ends
function createSpineRoadPolygon(coords, width) {
    if (coords.length < 2) return null;
    
    const halfWidth = width / 2;
    const leftSide = [];
    const rightSide = [];
    
    // Create parallel lines on both sides of the centerline
    for (let i = 0; i < coords.length; i++) {
        let perpX, perpY;
        
        if (i === 0) {
            // First point - use direction to next point
            const dx = coords[1][0] - coords[0][0];
            const dy = coords[1][1] - coords[0][1];
            const length = Math.sqrt(dx*dx + dy*dy);
            perpX = -dy / length * halfWidth;
            perpY = dx / length * halfWidth;
        } else if (i === coords.length - 1) {
            // Last point - use direction from previous point
            const dx = coords[i][0] - coords[i-1][0];
            const dy = coords[i][1] - coords[i-1][1];
            const length = Math.sqrt(dx*dx + dy*dy);
            perpX = -dy / length * halfWidth;
            perpY = dx / length * halfWidth;
        } else {
            // Middle points - average of adjacent segments
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
    
    // Create closed polygon: left side + reversed right side
    const polygon = [...leftSide, ...rightSide.reverse(), leftSide[0]];
    
    return {
        type: 'Polygon',
        coordinates: [polygon]
    };
}

// Clear all function
function clearAll() {
    // Clear application state
    siteBoundary = null;
    accessRoads = [];
    houses = [];
    stats = { totalArea: 0, homeCount: 0, density: 0 };
    
    // Clear map sources
    map.getSource('site-boundary').setData({ type: 'FeatureCollection', features: [] });
    map.getSource('access-roads').setData({ type: 'FeatureCollection', features: [] });
    map.getSource('houses').setData({ type: 'FeatureCollection', features: [] });
    
    // Clear drawing tool
    draw.deleteAll();
    
    // Reset tools
    currentTool = null;
    document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
    draw.changeMode('simple_select');
    
    // Update UI
    updateStats();
    showNotification('All cleared!', 'success');
}

// Utility functions
function calculateArea(coordinates) {
    let area = 0;
    const numPoints = coordinates.length - 1;
    
    for (let i = 0; i < numPoints; i++) {
        const j = (i + 1) % numPoints;
        area += coordinates[i][0] * coordinates[j][1];
        area -= coordinates[j][0] * coordinates[i][1];
    }
    
    area = Math.abs(area) / 2;
    const hectares = area * 12100; // Rough conversion
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

// Initialize
updateStats();
