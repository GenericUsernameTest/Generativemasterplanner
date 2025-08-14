// Mapbox Configuration
mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';

// Initialize map
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n',
    center: [-0.1278, 51.5074], // Default to London
    zoom: 15
});

// Drawing tools
const draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: {
        polygon: false,
        trash: true
    }
});

map.addControl(draw);

// Application state
let currentTool = null;
let siteBoundary = null;
let accessRoads = [];
let houses = [];
let stats = {
    totalArea: 0,
    homeCount: 0,
    density: 0
};

// Constants for house generation (future-proofing)
const HOUSE_TYPES = {
    standard: {
        width: 5,
        length: 5,
        height: 4,
        spacing: 2
    }
    // Add more house types here in the future
};

const SPACING_STANDARDS = {
    standard: 2,
    compact: 1.5,
    spacious: 3
    // Add more spacing standards here
};

// Initialize map
map.on('load', function() {
    // Add sources for our features
    map.addSource('site-boundary', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: []
        }
    });

    map.addSource('access-roads', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: []
        }
    });

    map.addSource('houses', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: []
        }
    });

    // Add layers
    // Site boundary fill
    map.addLayer({
        id: 'site-boundary-fill',
        type: 'fill',
        source: 'site-boundary',
        paint: {
            'fill-color': '#3498db',
            'fill-opacity': 0.1
        }
    });

    // Site boundary outline
    map.addLayer({
        id: 'site-boundary-outline',
        type: 'line',
        source: 'site-boundary',
        paint: {
            'line-color': '#3498db',
            'line-width': 2
        }
    });

    // Access roads
    map.addLayer({
        id: 'access-roads',
        type: 'fill',
        source: 'access-roads',
        paint: {
            'fill-color': '#95a5a6',
            'fill-opacity': 0.8
        }
    });

    // Houses
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

    showNotification('Map loaded successfully!', 'success');
});

// Tool button event listeners
document.getElementById('draw-boundary').addEventListener('click', function() {
    activateTool('boundary', this);
});

document.getElementById('draw-road').addEventListener('click', function() {
    activateTool('road', this);
});

document.getElementById('generate-plan').addEventListener('click', function() {
    generatePlan();
});

// Tool activation function
function activateTool(tool, button) {
    // Reset all buttons
    document.querySelectorAll('.tool-button').forEach(btn => {
        btn.classList.remove('active');
    });

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
            showNotification('Click to start drawing site boundary');
        } else if (tool === 'road') {
            draw.changeMode('draw_polygon');
            showNotification('Click to start drawing access road');
        }
    }
}

// Drawing event listeners
map.on('draw.create', function(e) {
    const feature = e.features[0];
    
    if (currentTool === 'boundary') {
        handleSiteBoundaryCreation(feature);
    } else if (currentTool === 'road') {
        handleAccessRoadCreation(feature);
    }
    
    // Reset tool
    currentTool = null;
    document.querySelectorAll('.tool-button').forEach(btn => {
        btn.classList.remove('active');
    });
    draw.changeMode('simple_select');
});

// Handle site boundary creation
function handleSiteBoundaryCreation(feature) {
    siteBoundary = feature;
    
    // Update the site boundary source
    map.getSource('site-boundary').setData({
        type: 'FeatureCollection',
        features: [feature]
    });

    // Calculate area
    const area = calculatePolygonArea(feature.geometry.coordinates[0]);
    stats.totalArea = area;
    updateStats();
    
    showNotification('Site boundary created!', 'success');
}

// Handle access road creation
function handleAccessRoadCreation(feature) {
    // TODO: Implement road width constraint (5m)
    // For now, just add the road polygon as drawn
    
    accessRoads.push(feature);
    
    // Update the access roads source
    map.getSource('access-roads').setData({
        type: 'FeatureCollection',
        features: accessRoads
    });

    // TODO: Generate spine road aligned to closest boundary point
    // PLACEHOLDER: generateSpineRoad(feature);
    
    // TODO: Generate houses along spine
    // PLACEHOLDER: generateHousesAlongSpine(spineRoad);
    
    showNotification('Access road created! (House generation coming soon)', 'success');
}

// Generate plan function
function generatePlan() {
    if (!siteBoundary) {
        showNotification('Please draw a site boundary first!', 'error');
        return;
    }

    showLoading(true);
    
    // Simulate processing time
    setTimeout(() => {
        // TODO: Implement comprehensive plan generation
        // This would include:
        // - Optimizing house placement
        // - Generating infrastructure
        // - Creating detailed layouts
        
        showLoading(false);
        showNotification('Plan generated successfully!', 'success');
        
        // Update all visualizations
        updateAllLayers();
    }, 2000);
}

// Utility functions
function calculatePolygonArea(coordinates) {
    // Simple area calculation for polygon (in square meters, converted to hectares)
    let area = 0;
    const numPoints = coordinates.length - 1; // Last point is same as first
    
    for (let i = 0; i < numPoints; i++) {
        const j = (i + 1) % numPoints;
        area += coordinates[i][0] * coordinates[j][1];
        area -= coordinates[j][0] * coordinates[i][1];
    }
    
    area = Math.abs(area) / 2;
    
    // Convert from degrees to approximate hectares (rough conversion)
    // This is a simplified calculation - in production, use proper projection
    const hectares = area * 12100; // Rough conversion factor
    return Math.round(hectares * 100) / 100;
}

function updateStats() {
    document.getElementById('total-area').textContent = `${stats.totalArea} ha`;
    document.getElementById('home-count').textContent = stats.homeCount;
    
    if (stats.totalArea > 0) {
        stats.density = Math.round((stats.homeCount / stats.totalArea) * 10) / 10;
    } else {
        stats.density = 0;
    }
    
    document.getElementById('density').textContent = `${stats.density} homes/ha`;
}

function updateAllLayers() {
    // Update all map layers with current data
    map.getSource('site-boundary').setData({
        type: 'FeatureCollection',
        features: siteBoundary ? [siteBoundary] : []
    });

    map.getSource('access-roads').setData({
        type: 'FeatureCollection',
        features: accessRoads
    });

    map.getSource('houses').setData({
        type: 'FeatureCollection',
        features: houses
    });
}

function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification show ${type}`;
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function showLoading(show) {
    const loading = document.getElementById('loading');
    loading.style.display = show ? 'block' : 'none';
}

// TODO: Implement these complex functions
function generateSpineRoad(roadPolygon) {
    // PLACEHOLDER: Generate spine road aligned to closest boundary point
    // This would:
    // 1. Find the center line of the road polygon
    // 2. Find the closest point on the site boundary
    // 3. Align the spine to connect to that point
    // 4. Return spine road geometry
    console.log('generateSpineRoad - TO BE IMPLEMENTED');
}

function generateHousesAlongSpine(spineRoad) {
    // PLACEHOLDER: Generate houses along the spine road
    // This would:
    // 1. Calculate placement points along spine at regular intervals
    // 2. Account for house dimensions and spacing
    // 3. Generate house polygons at each placement point
    // 4. Update houses array and stats
    console.log('generateHousesAlongSpine - TO BE IMPLEMENTED');
    
    // For now, simulate some houses being added
    stats.homeCount = Math.floor(Math.random() * 20) + 5;
    updateStats();
}

// Initialize stats on page load
updateStats();
