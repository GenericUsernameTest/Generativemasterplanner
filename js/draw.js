// js/draw.js - Drawing tools management
export class DrawManager {
    constructor(map, onDrawCreate) {
        this.map = map;
        this.onDrawCreate = onDrawCreate;
        this.draw = null;
        this.init();
    }
    
    init() {
        // Initialize Mapbox Draw
        this.draw = new MapboxDraw({
            displayControlsDefault: false,
            controls: {},
            styles: this.getDrawStyles()
        });
        
        // Add draw control to map
        this.map.addControl(this.draw);
        
        // Setup event listeners
        this.map.on('draw.create', this.onDrawCreate);
        
        console.log('✏️ Draw manager initialized');
    }
    
    getDrawStyles() {
        return [
            // Polygon fill
            {
                'id': 'gl-draw-polygon-fill-inactive',
                'type': 'fill',
                'filter': ['all',
                    ['==', 'active', 'false'],
                    ['==', '$type', 'Polygon'],
                    ['!=', 'mode', 'static']
                ],
                'paint': {
                    'fill-color': '#3498db',
                    'fill-outline-color': '#3498db',
                    'fill-opacity': 0.2
                }
            },
            // Polygon outline
            {
                'id': 'gl-draw-polygon-stroke-inactive',
                'type': 'line',
                'filter': ['all',
                    ['==', 'active', 'false'],
                    ['==', '$type', 'Polygon'],
                    ['!=', 'mode', 'static']
                ],
                'layout': {
                    'line-cap': 'round',
                    'line-join': 'round'
                },
                'paint': {
                    'line-color': '#3498db',
                    'line-width': 2
                }
            },
            // Active polygon fill
            {
                'id': 'gl-draw-polygon-fill-active',
                'type': 'fill',
                'filter': ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
                'paint': {
                    'fill-color': '#e74c3c',
                    'fill-outline-color': '#e74c3c',
                    'fill-opacity': 0.2
                }
            },
            // Active polygon outline
            {
                'id': 'gl-draw-polygon-stroke-active',
                'type': 'line',
                'filter': ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
                'layout': {
                    'line-cap': 'round',
                    'line-join': 'round'
                },
                'paint': {
                    'line-color': '#e74c3c',
                    'line-width': 3
                }
            },
            // Line
            {
                'id': 'gl-draw-line-inactive',
                'type': 'line',
                'filter': ['all',
                    ['==', 'active', 'false'],
                    ['==', '$type', 'LineString'],
                    ['!=', 'mode', 'static']
                ],
                'layout': {
                    'line-cap': 'round',
                    'line-join': 'round'
                },
                'paint': {
                    'line-color': '#e74c3c',
                    'line-width': 3
                }
            },
            // Active line
            {
                'id': 'gl-draw-line-active',
                'type': 'line',
                'filter': ['all',
                    ['==', '$type', 'LineString'],
                    ['==', 'active', 'true']
                ],
                'layout': {
                    'line-cap': 'round',
                    'line-join': 'round'
                },
                'paint': {
                    'line-color': '#e74c3c',
                    'line-width': 4
                }
            },
            // Vertex points
            {
                'id': 'gl-draw-polygon-and-line-vertex-stroke-inactive',
                'type': 'circle',
                'filter': ['all',
                    ['==', 'meta', 'vertex'],
                    ['==', '$type', 'Point'],
                    ['!=', 'mode', 'static']
                ],
                'paint': {
                    'circle-radius': 4,
                    'circle-color': '#fff'
                }
            },
            // Active vertex points
            {
                'id': 'gl-draw-polygon-and-line-vertex-inactive',
                'type': 'circle',
                'filter': ['all',
                    ['==', 'meta', 'vertex'],
                    ['==', '$type', 'Point'],
                    ['!=', 'mode', 'static']
                ],
                'paint': {
                    'circle-radius': 3,
                    'circle-color': '#3498db'
                }
            }
        ];
    }
    
    activatePolygonMode() {
        try {
            this.draw.changeMode('draw_polygon');
            console.log('🔲 Polygon drawing mode activated');
        } catch (error) {
            console.error('❌ Failed to activate polygon mode:', error);
        }
    }
    
    activateLineMode() {
        try {
            this.draw.changeMode('draw_line_string');
            console.log('📏 Line drawing mode activated');
        } catch (error) {
            console.error('❌ Failed to activate line mode:', error);
        }
    }
    
    deactivate() {
        try {
            this.draw.changeMode('simple_select');
            console.log('✋ Drawing mode deactivated');
        } catch (error) {
            console.error('❌ Failed to deactivate drawing mode:', error);
        }
    }
    
    clear() {
        try {
            this.draw.deleteAll();
            console.log('🧹 Draw features cleared');
        } catch (error) {
            console.error('❌ Failed to clear draw features:', error);
        }
    }
    
    getAll() {
        return this.draw.getAll();
    }
    
    add(feature) {
        try {
            this.draw.add(feature);
        } catch (error) {
            console.error('❌ Failed to add feature to draw:', error);
        }
    }
    
    delete(featureId) {
        try {
            this.draw.delete(featureId);
        } catch (error) {
            console.error('❌ Failed to delete feature from draw:', error);
        }
    }
}
