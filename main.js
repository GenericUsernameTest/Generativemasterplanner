// main.js - Main application controller
import { MapManager } from './js/map.js';
import { DrawManager } from './js/draw.js';
import { SpineManager } from './js/spines.js';
import { HousingManager } from './js/housing.js';
import { StatsManager } from './js/stats.js';

class MasterplanningTool {
    constructor() {
        // Initialize managers
        this.mapManager = new MapManager();
        this.drawManager = null;
        this.spineManager = null;
        this.housingManager = null;
        this.statsManager = new StatsManager();
        
        // Application state
        this.state = {
            siteBoundary: null,
            accessRoad: null,
            spines: [],
            houses: [],
            currentTool: null
        };
        
        this.init();
    }
    
    async init() {
        try {
            // Initialize map first
            await this.mapManager.initialize();
            
            // Initialize other managers with map instance
            this.drawManager = new DrawManager(this.mapManager.map, this.onDrawCreate.bind(this));
            this.spineManager = new SpineManager(this.mapManager.map);
            this.housingManager = new HousingManager(this.mapManager.map);
            
            // Setup UI event listeners
            this.setupEventListeners();
            
            console.log('✅ Masterplanning Tool initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize tool:', error);
            this.showNotification('Failed to initialize tool', 'error');
        }
    }
    
    setupEventListeners() {
        // Drawing tools
        document.getElementById('draw-boundary').addEventListener('click', () => {
            this.activateTool('boundary');
        });
        
        document.getElementById('draw-road').addEventListener('click', () => {
            this.activateTool('road');
        });
        
        document.getElementById('generate-plan').addEventListener('click', () => {
            this.generatePlan();
        });
        
        document.getElementById('clear-all').addEventListener('click', () => {
            this.clearAll();
        });
    }
    
    activateTool(toolType) {
        // Update UI
        document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
        
        switch (toolType) {
            case 'boundary':
                document.getElementById('draw-boundary').classList.add('active');
                this.drawManager.activatePolygonMode();
                this.state.currentTool = 'boundary';
                this.showNotification('Click to start drawing site boundary', 'info');
                break;
                
            case 'road':
                if (!this.state.siteBoundary) {
                    this.showNotification('Please draw site boundary first', 'error');
                    return;
                }
                document.getElementById('draw-road').classList.add('active');
                this.drawManager.activateLineMode();
                this.state.currentTool = 'road';
                this.showNotification('Draw access road from outside into the site', 'info');
                break;
        }
    }
    
    onDrawCreate(e) {
        const feature = e.features[0];
        console.log('🎨 Feature created:', feature.geometry.type);
        
        switch (this.state.currentTool) {
            case 'boundary':
                this.handleBoundaryCreated(feature);
                break;
                
            case 'road':
                this.handleRoadCreated(feature);
                break;
        }
        
        // Deactivate tool
        this.deactivateTools();
    }
    
    handleBoundaryCreated(feature) {
        // Remove existing boundary if present
        if (this.state.siteBoundary) {
            this.mapManager.removeLayer('site-boundary');
        }
        
        this.state.siteBoundary = feature;
        
        // Add to map with styling
        this.mapManager.addLayer({
            id: 'site-boundary',
            type: 'fill',
            source: {
                type: 'geojson',
                data: feature
            },
            paint: {
                'fill-color': '#3498db',
                'fill-opacity': 0.1,
                'fill-outline-color': '#3498db'
            }
        });
        
        // Add boundary outline
        this.mapManager.addLayer({
            id: 'site-boundary-outline',
            type: 'line',
            source: {
                type: 'geojson',
                data: feature
            },
            paint: {
                'line-color': '#3498db',
                'line-width': 3,
                'line-dasharray': [2, 2]
            }
        });
        
        this.updateStats();
        this.showNotification('Site boundary created successfully', 'success');
        console.log('✅ Site boundary created');
    }
    
    handleRoadCreated(feature) {
        // Validate road intersects boundary
        if (!this.spineManager.validateRoadIntersection(feature, this.state.siteBoundary)) {
            this.showNotification('Access road must enter the site boundary', 'error');
            return;
        }
        
        // Remove existing road if present
        if (this.state.accessRoad) {
            this.mapManager.removeLayer('access-road');
        }
        
        this.state.accessRoad = feature;
        
        // Add to map
        this.mapManager.addLayer({
            id: 'access-road',
            type: 'line',
            source: {
                type: 'geojson',
                data: feature
            },
            paint: {
                'line-color': '#e74c3c',
                'line-width': 4
            }
        });
        
        this.showNotification('Access road created. Click "Generate Plan" to continue', 'success');
        console.log('✅ Access road created');
    }
    
    async generatePlan() {
        if (!this.state.siteBoundary || !this.state.accessRoad) {
            this.showNotification('Please draw both site boundary and access road first', 'error');
            return;
        }
        
        this.showLoading(true);
        
        try {
            // Clear existing generated features
            this.clearGeneratedFeatures();
            
            // Generate spines
            const spines = this.spineManager.generateSpines(
                this.state.siteBoundary,
                this.state.accessRoad
            );
            
            if (spines.length === 0) {
                throw new Error('Could not generate spine roads');
            }
            
            this.state.spines = spines;
            
            // Add spines to map
            spines.forEach((spine, index) => {
                this.mapManager.addLayer({
                    id: `spine-${index}`,
                    type: 'fill',
                    source: {
                        type: 'geojson',
                        data: spine
                    },
                    paint: {
                        'fill-color': '#95a5a6',
                        'fill-opacity': 0.8
                    }
                });
            });
            
            // Generate houses along spines
            const allHouses = [];
            for (let i = 0; i < spines.length; i++) {
                const houses = this.housingManager.generateHousesAlongSpine(
                    spines[i],
                    this.state.siteBoundary,
                    [...spines, this.state.accessRoad] // All roads to avoid
                );
                allHouses.push(...houses);
            }
            
            this.state.houses = allHouses;
            
            // Add houses to map
            if (allHouses.length > 0) {
                this.mapManager.addLayer({
                    id: 'houses',
                    type: 'fill',
                    source: {
                        type: 'geojson',
                        data: {
                            type: 'FeatureCollection',
                            features: allHouses
                        }
                    },
                    paint: {
                        'fill-color': [
                            'case',
                            ['==', ['get', 'type'], 'small'], '#27ae60',
                            ['==', ['get', 'type'], 'medium'], '#f39c12',
                            ['==', ['get', 'type'], 'large'], '#8e44ad',
                            '#34495e'
                        ],
                        'fill-opacity': 0.8,
                        'fill-outline-color': '#2c3e50'
                    }
                });
            }
            
            this.updateStats();
            this.showNotification(`Generated ${spines.length} spine roads and ${allHouses.length} houses`, 'success');
            
        } catch (error) {
            console.error('❌ Plan generation failed:', error);
            this.showNotification('Failed to generate plan: ' + error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }
    
    clearGeneratedFeatures() {
        // Remove existing generated layers
        const layersToRemove = [];
        this.state.spines.forEach((_, index) => {
            layersToRemove.push(`spine-${index}`);
        });
        layersToRemove.push('houses');
        
        layersToRemove.forEach(layerId => {
            this.mapManager.removeLayer(layerId);
        });
        
        this.state.spines = [];
        this.state.houses = [];
    }
    
    clearAll() {
        // Clear all features
        this.clearGeneratedFeatures();
        
        // Clear drawn features
        if (this.state.siteBoundary) {
            this.mapManager.removeLayer('site-boundary');
            this.mapManager.removeLayer('site-boundary-outline');
            this.state.siteBoundary = null;
        }
        
        if (this.state.accessRoad) {
            this.mapManager.removeLayer('access-road');
            this.state.accessRoad = null;
        }
        
        // Clear drawing
        this.drawManager.clear();
        
        // Reset UI
        this.deactivateTools();
        this.updateStats();
        
        this.showNotification('All features cleared', 'info');
        console.log('🧹 All features cleared');
    }
    
    deactivateTools() {
        document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
        this.drawManager.deactivate();
        this.state.currentTool = null;
    }
    
    updateStats() {
        this.statsManager.updateStats(
            this.state.siteBoundary,
            this.state.houses
        );
    }
    
    showLoading(show) {
        document.getElementById('loading').style.display = show ? 'block' : 'none';
    }
    
    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type} show`;
        
        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.masterplanningTool = new MasterplanningTool();
});
