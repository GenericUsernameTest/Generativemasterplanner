// js/map.js - Map initialization and management
export class MapManager {
    constructor() {
        this.map = null;
        this.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
        this.styleUrl = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';
    }
    
    async initialize() {
        // Set access token
        mapboxgl.accessToken = this.accessToken;
        
        // Create map instance
        this.map = new mapboxgl.Map({
            container: 'map',
            style: this.styleUrl,
            center: [-0.1278, 51.5074], // London coordinates
            zoom: 15,
            pitch: 0,
            bearing: 0
        });
        
        // Wait for map to load
        return new Promise((resolve, reject) => {
            this.map.on('load', () => {
                console.log('🗺️ Map loaded successfully');
                this.setupMapControls();
                resolve();
            });
            
            this.map.on('error', (error) => {
                console.error('❌ Map loading error:', error);
                reject(error);
            });
        });
    }
    
    setupMapControls() {
        // Add navigation control
        this.map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
        
        // Add scale control
        this.map.addControl(new mapboxgl.ScaleControl(), 'bottom-left');
        
        // Add fullscreen control
        this.map.addControl(new mapboxgl.FullscreenControl(), 'bottom-right');
    }
    
    addLayer(layerConfig) {
        try {
            // Remove layer if it already exists
            if (this.map.getLayer(layerConfig.id)) {
                this.removeLayer(layerConfig.id);
            }
            
            // Add source if it doesn't exist
            const sourceId = layerConfig.source.type ? `${layerConfig.id}-source` : layerConfig.source;
            if (layerConfig.source.type && !this.map.getSource(sourceId)) {
                this.map.addSource(sourceId, layerConfig.source);
                layerConfig.source = sourceId;
            }
            
            // Add layer
            this.map.addLayer(layerConfig);
            
            console.log(`✅ Layer '${layerConfig.id}' added successfully`);
        } catch (error) {
            console.error(`❌ Failed to add layer '${layerConfig.id}':`, error);
        }
    }
    
    removeLayer(layerId) {
        try {
            if (this.map.getLayer(layerId)) {
                this.map.removeLayer(layerId);
            }
            
            const sourceId = `${layerId}-source`;
            if (this.map.getSource(sourceId)) {
                this.map.removeSource(sourceId);
            }
            
            console.log(`🗑️ Layer '${layerId}' removed`);
        } catch (error) {
            console.error(`❌ Failed to remove layer '${layerId}':`, error);
        }
    }
    
    fitBounds(feature, padding = 50) {
        try {
            const bbox = turf.bbox(feature);
            this.map.fitBounds(bbox, { padding });
        } catch (error) {
            console.error('❌ Failed to fit bounds:', error);
        }
    }
    
    getCenter() {
        return this.map.getCenter();
    }
    
    getZoom() {
        return this.map.getZoom();
    }
    
    setCenter(coordinates) {
        this.map.setCenter(coordinates);
    }
    
    setZoom(zoom) {
        this.map.setZoom(zoom);
    }
}
