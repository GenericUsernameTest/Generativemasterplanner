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
        // This would include
