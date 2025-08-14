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

map.on('load', function() {
    console.log('Map loaded with style');
    showNotification('Map loaded!', 'success');
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

// Map load event
map.on('load', function() {
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

    // Access roads and spine roads
    map.addLayer({
        id: 'access-roads',
        type: 'line',
        source: 'access-roads',
        paint: { 
            'line-color': [
                'case',
                ['==', ['get', 'type'], 'spine'], '#2c3e50', // Dark spine road
                '#95a5a6' // Light access road outline
            ],
            'line-width': [
                'case', 
                ['==', ['get', 'type'], 'spine'], 3, // Thinner spine
                8 // Thicker access road
            ],
            'line-opacity': 0.8 
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

    showNotification('Map loaded with custom style!', 'success');
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
    
    accessRoads.forEach(road => {
        const coords = road.geometry.coordinates;
        
        // Create the spine road (centerline) - this will be visible
        const spineRoad = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: coords
            },
            properties: {
                type: 'spine'
            }
        };
        
        // Add spine road to the roads source for visualization
        const allRoads = [...accessRoads, spineRoad];
        map.getSource('access-roads').setData({
            type: 'FeatureCollection',
            features: allRoads
        });
        
        // Generate houses along the spine
        const houseSpacing = 0.0001; // Closer spacing for more houses
        const rowDepth = 0.00008; // How far back houses go from spine
        const houseSize = 0.000025; // Smaller house size
        
        // Create houses along each segment of the spine
        for (let i = 1; i < coords.length; i++) {
            const start = coords[i-1];
            const end = coords[i];
            
            // Calculate segment vector
            const dx = end[0] - start[0];
            const dy = end[1] - start[1];
            const segmentLength = Math.sqrt(dx*dx + dy*dy);
            
            // Normalized direction vector
            const dirX = dx / segmentLength;
            const dirY = dy / segmentLength;
            
            // Perpendicular vector for house rows
            const perpX = -dirY;
            const perpY = dirX;
            
            // Number of house positions along this segment
            const housesInSegment = Math.floor(segmentLength / houseSpacing);
            
            for (let j = 0; j <= housesInSegment; j++) {
                const t = j / Math.max(housesInSegment, 1);
                const spineX = start[0] + t * dx;
                const spineY = start[1] + t * dy;
                
                // Create houses on both sides of spine (multiple rows)
                [-1, 1].forEach(side => {
                    // Multiple rows of houses (2 rows on each side)
                    [1, 2].forEach(row => {
                        const offsetDistance = row * rowDepth;
                        const houseX = spineX + perpX * side * offsetDistance;
                        const houseY = spineY + perpY * side * offsetDistance;
                        
                        // Create house polygon
                        const house = {
                            type: 'Feature',
                            geometry: {
                                type: 'Polygon',
                                coordinates: [[
                                    [houseX - houseSize, houseY - houseSize],
                                    [houseX + houseSize, houseY - houseSize],
                                    [houseX + houseSize, houseY + houseSize],
                                    [houseX - houseSize, houseY + houseSize],
                                    [houseX - houseSize, houseY - houseSize]
                                ]]
                            },
                            properties: {
                                type: 'house',
                                id: houses.length + 1,
                                row: row,
                                side: side
                            }
                        };
                        
                        houses.push(house);
                    });
                });
            }
        }
    });
    
    // Update houses on map
    map.getSource('houses').setData({
        type: 'FeatureCollection',
        features: houses
    });
    
    stats.homeCount = houses.length;
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
