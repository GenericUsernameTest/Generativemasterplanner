// main.js - Complete Masterplanning Tool
// All modules combined for browser compatibility

// Utility Functions
class GeometryUtils {
    static distance(point1, point2) {
        const dx = point2[0] - point1[0];
        const dy = point2[1] - point1[1];
        const metersPerDegree = 111000;
        return Math.sqrt(dx * dx + dy * dy) * metersPerDegree;
    }
    
    static normalize(vector) {
        const mag = Math.sqrt(vector[0] * vector[0] + vector[1] * vector[1]);
        if (mag === 0) return [0, 0];
        return [vector[0] / mag, vector[1] / mag];
    }
    
    static perpendicular(vector) {
        return [-vector[1], vector[0]];
    }
    
    static movePoint(point, vector, distance) {
        const normalizedVector = this.normalize(vector);
        const degreesPerMeter = 1 / 111000;
        const distanceInDegrees = distance * degreesPerMeter;
        
        return [
            point[0] + normalizedVector[0] * distanceInDegrees,
            point[1] + normalizedVector[1] * distanceInDegrees
        ];
    }
    
    static dotProduct(v1, v2) {
        return v1[0] * v2[0] + v1[1] * v2[1];
    }
    
    static findClosestEdgePoint(polygon, point) {
        const coords = polygon.geometry.coordinates[0];
        let closestDistance = Infinity;
        let closestPoint = null;
        let closestEdgeIndex = -1;
        
        for (let i = 0; i < coords.length - 1; i++) {
            const edgeStart = coords[i];
            const edgeEnd = coords[i + 1];
            const closestOnEdge = this.closestPointOnLine(edgeStart, edgeEnd, point);
            const distance = this.distance(point, closestOnEdge);
            
            if (distance < closestDistance) {
                closestDistance = distance;
                closestPoint = closestOnEdge;
                closestEdgeIndex = i;
            }
        }
        
        return { point: closestPoint, distance: closestDistance, edgeIndex: closestEdgeIndex };
    }
    
    static closestPointOnLine(lineStart, lineEnd, point) {
        const A = point[0] - lineStart[0];
        const B = point[1] - lineStart[1];
        const C = lineEnd[0] - lineStart[0];
        const D = lineEnd[1] - lineStart[1];
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        
        if (lenSq === 0) return lineStart;
        
        let param = dot / lenSq;
        param = Math.max(0, Math.min(1, param));
        
        return [lineStart[0] + param * C, lineStart[1] + param * D];
    }
    
    static getPolygonEdgeDirection(polygon, edgeIndex) {
        const coords = polygon.geometry.coordinates[0];
        const start = coords[edgeIndex];
        const end = coords[(edgeIndex + 1) % (coords.length - 1)];
        return this.normalize([end[0] - start[0], end[1] - start[1]]);
    }
    
    static findOppositeEdge(polygon, direction) {
        const coords = polygon.geometry.coordinates[0];
        let mostOpposite = -1;
        let minDot = 1;
        
        for (let i = 0; i < coords.length - 1; i++) {
            const edgeDir = this.getPolygonEdgeDirection(polygon, i);
            const dot = this.dotProduct(direction, edgeDir);
            
            if (dot < minDot) {
                minDot = dot;
                mostOpposite = i;
            }
        }
        
        return mostOpposite;
    }
    
    static createRectangle(center, width, height, rotationDegrees = 0) {
        const degreesPerMeter = 1 / 111000;
        const w = width * degreesPerMeter / 2;
        const h = height * degreesPerMeter / 2;
        
        let corners = [[-w, -h], [w, -h], [w, h], [-w, h], [-w, -h]];
        
        if (rotationDegrees !== 0) {
            const radians = rotationDegrees * Math.PI / 180;
            const cos = Math.cos(radians);
            const sin = Math.sin(radians);
            
            corners = corners.map(corner => [
                corner[0] * cos - corner[1] * sin,
                corner[0] * sin + corner[1] * cos
            ]);
        }
        
        const coordinates = corners.map(corner => [
            center[0] + corner[0],
            center[1] + corner[1]
        ]);
        
        return {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [coordinates] },
            properties: {}
        };
    }
    
    static pointInPolygon(point, polygon) {
        const coords = polygon.geometry ? polygon.geometry.coordinates[0] : polygon.coordinates[0];
        const x = point[0];
        const y = point[1];
        
        let inside = false;
        for (let i = 0, j = coords.length - 2; i < coords.length - 1; j = i++) {
            const xi = coords[i][0], yi = coords[i][1];
            const xj = coords[j][0], yj = coords[j][1];
            
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        
        return inside;
    }
    
    static polygonInPolygon(innerPolygon, outerPolygon) {
        const innerCoords = innerPolygon.geometry ? innerPolygon.geometry.coordinates[0] : innerPolygon.coordinates[0];
        
        for (let i = 0; i < innerCoords.length - 1; i++) {
            if (!this.pointInPolygon(innerCoords[i], outerPolygon)) {
                return false;
            }
        }
        
        return true;
    }
    
    static polygonArea(polygon) {
        const coords = polygon.geometry ? polygon.geometry.coordinates[0] : polygon.coordinates[0];
        let area = 0;
        
        for (let i = 0; i < coords.length - 1; i++) {
            const j = (i + 1) % (coords.length - 1);
            area += coords[i][0] * coords[j][1];
            area -= coords[j][0] * coords[i][1];
        }
        
        area = Math.abs(area) / 2;
        const metersPerDegree = 111000;
        return area * metersPerDegree * metersPerDegree;
    }
    
    static bufferLine(line, width) {
        const coords = line.geometry ? line.geometry.coordinates : line.coordinates;
        const halfWidth = width / 2;
        const degreesPerMeter = 1 / 111000;
        const halfWidthDegrees = halfWidth * degreesPerMeter;
        
        const leftSide = [];
        const rightSide = [];
        
        for (let i = 0; i < coords.length - 1; i++) {
            const start = coords[i];
            const end = coords[i + 1];
            const direction = this.normalize([end[0] - start[0], end[1] - start[1]]);
            const perpendicular = this.perpendicular(direction);
            
            leftSide.push([
                start[0] + perpendicular[0] * halfWidthDegrees,
                start[1] + perpendicular[1] * halfWidthDegrees
            ]);
            rightSide.push([
                start[0] - perpendicular[0] * halfWidthDegrees,
                start[1] - perpendicular[1] * halfWidthDegrees
            ]);
        }
        
        const lastIdx = coords.length - 1;
        const lastStart = coords[lastIdx - 1];
        const lastEnd = coords[lastIdx];
        const lastDirection = this.normalize([lastEnd[0] - lastStart[0], lastEnd[1] - lastStart[1]]);
        const lastPerpendicular = this.perpendicular(lastDirection);
        
        leftSide.push([
            lastEnd[0] + lastPerpendicular[0] * halfWidthDegrees,
            lastEnd[1] + lastPerpendicular[1] * halfWidthDegrees
        ]);
        rightSide.push([
            lastEnd[0] - lastPerpendicular[0] * halfWidthDegrees,
            lastEnd[1] - lastPerpendicular[1] * halfWidthDegrees
        ]);
        
        const polygonCoords = [...leftSide, ...rightSide.reverse(), leftSide[0]];
        
        return {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [polygonCoords] },
            properties: { width: width }
        };
    }
}

// Main Application Class
class MasterplanningTool {
    constructor() {
        this.map = null;
        this.draw = null;
        this.state = {
            siteBoundary: null,
            accessRoad: null,
            spines: [],
            houses: [],
            currentTool: null
        };
        
        // Configuration
        this.config = {
            spineWidth: 8,
            setback: 3,
            houseSpacing: 4,
            insetDistance: 10,
            houseTypes: {
                small: { width: 8, depth: 12, name: 'Small House' },
                medium: { width: 10, depth: 15, name: 'Medium House' },
                large: { width: 12, depth: 18, name: 'Large House' }
            },
            currentHouseType: 'medium'
        };
        
        this.init();
    }
    
    async init() {
        try {
            await this.initializeMap();
            this.initializeDraw();
            this.setupEventListeners();
            console.log('✅ Masterplanning Tool initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize tool:', error);
            this.showNotification('Failed to initialize tool', 'error');
        }
    }
    
    async initializeMap() {
        mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
        
        this.map = new mapboxgl.Map({
            container: 'map',
            style: 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n',
            center: [-0.1278, 51.5074],
            zoom: 15,
            pitch: 0,
            bearing: 0
        });
        
        return new Promise((resolve, reject) => {
            this.map.on('load', () => {
                this.map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
                this.map.addControl(new mapboxgl.ScaleControl(), 'bottom-left');
                console.log('🗺️ Map loaded successfully');
                resolve();
            });
            
            this.map.on('error', (error) => {
                console.error('❌ Map loading error:', error);
                reject(error);
            });
        });
    }
    
    initializeDraw() {
        this.draw = new MapboxDraw({
            displayControlsDefault: false,
            controls: {},
            styles: [
                {
                    'id': 'gl-draw-polygon-fill-inactive',
                    'type': 'fill',
                    'filter': ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                    'paint': {
                        'fill-color': '#3498db',
                        'fill-outline-color': '#3498db',
                        'fill-opacity': 0.2
                    }
                },
                {
                    'id': 'gl-draw-polygon-stroke-inactive',
                    'type': 'line',
                    'filter': ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                    'layout': { 'line-cap': 'round', 'line-join': 'round' },
                    'paint': { 'line-color': '#3498db', 'line-width': 2 }
                },
                {
                    'id': 'gl-draw-line-inactive',
                    'type': 'line',
                    'filter': ['all', ['==', 'active', 'false'], ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
                    'layout': { 'line-cap': 'round', 'line-join': 'round' },
                    'paint': { 'line-color': '#e74c3c', 'line-width': 3 }
                },
                {
                    'id': 'gl-draw-polygon-and-line-vertex-stroke-inactive',
                    'type': 'circle',
                    'filter': ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
                    'paint': { 'circle-radius': 4, 'circle-color': '#fff' }
                },
                {
                    'id': 'gl-draw-polygon-and-line-vertex-inactive',
                    'type': 'circle',
                    'filter': ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
                    'paint': { 'circle-radius': 3, 'circle-color': '#3498db' }
                }
            ]
        });
        
        this.map.addControl(this.draw);
        this.map.on('draw.create', this.onDrawCreate.bind(this));
    }
    
    setupEventListeners() {
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
        document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
        
        switch (toolType) {
            case 'boundary':
                document.getElementById('draw-boundary').classList.add('active');
                this.draw.changeMode('draw_polygon');
                this.state.currentTool = 'boundary';
                this.showNotification('Click to start drawing site boundary', 'info');
                break;
                
            case 'road':
                if (!this.state.siteBoundary) {
                    this.showNotification('Please draw site boundary first', 'error');
                    return;
                }
                document.getElementById('draw-road').classList.add('active');
                this.draw.changeMode('draw_line_string');
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
        
        this.deactivateTools();
    }
    
    handleBoundaryCreated(feature) {
        if (this.state.siteBoundary) {
            this.removeLayer('site-boundary');
            this.removeLayer('site-boundary-outline');
        }
        
        this.state.siteBoundary = feature;
        
        this.addLayer({
            id: 'site-boundary',
            type: 'fill',
            source: { type: 'geojson', data: feature },
            paint: {
                'fill-color': '#3498db',
                'fill-opacity': 0.1,
                'fill-outline-color': '#3498db'
            }
        });
        
        this.addLayer({
            id: 'site-boundary-outline',
            type: 'line',
            source: { type: 'geojson', data: feature },
            paint: {
                'line-color': '#3498db',
                'line-width': 3,
                'line-dasharray': [2, 2]
            }
        });
        
        this.updateStats();
        this.showNotification('Site boundary created successfully', 'success');
    }
    
    handleRoadCreated(feature) {
        if (!this.validateRoadIntersection(feature, this.state.siteBoundary)) {
            this.showNotification('Access road must enter the site boundary', 'error');
            return;
        }
        
        if (this.state.accessRoad) {
            this.removeLayer('access-road');
        }
        
        this.state.accessRoad = feature;
        
        this.addLayer({
            id: 'access-road',
            type: 'line',
            source: { type: 'geojson', data: feature },
            paint: { 'line-color': '#e74c3c', 'line-width': 4 }
        });
        
        this.showNotification('Access road created. Click "Generate Plan" to continue', 'success');
    }
    
    validateRoadIntersection(accessRoad, siteBoundary) {
        try {
            const roadCoords = accessRoad.geometry.coordinates;
            const endPoint = roadCoords[roadCoords.length - 1];
            return GeometryUtils.pointInPolygon(endPoint, siteBoundary);
        } catch (error) {
            console.error('❌ Error validating road intersection:', error);
            return false;
        }
    }
    
    async generatePlan() {
        if (!this.state.siteBoundary || !this.state.accessRoad) {
            this.showNotification('Please draw both site boundary and access road first', 'error');
            return;
        }
        
        this.showLoading(true);
        
        try {
            this.clearGeneratedFeatures();
            
            const spines = this.generateSpines(this.state.siteBoundary, this.state.accessRoad);
            
            if (spines.length === 0) {
                throw new Error('Could not generate spine roads');
            }
            
            this.state.spines = spines;
            
            spines.forEach((spine, index) => {
                this.addLayer({
                    id: `spine-${index}`,
                    type: 'fill',
                    source: { type: 'geojson', data: spine },
                    paint: { 'fill-color': '#95a5a6', 'fill-opacity': 0.8 }
                });
            });
            
            const allHouses = [];
            for (let i = 0; i < spines.length; i++) {
                const houses = this.generateHousesAlongSpine(
                    spines[i],
                    this.state.siteBoundary,
                    [...spines, this.state.accessRoad]
                );
                allHouses.push(...houses);
            }
            
            this.state.houses = allHouses;
            
            if (allHouses.length > 0) {
                this.addLayer({
                    id: 'houses',
                    type: 'fill',
                    source: {
                        type: 'geojson',
                        data: { type: 'FeatureCollection', features: allHouses }
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
    
    generateSpines(siteBoundary, accessRoad) {
        try {
            const spines = [];
            
            const firstSpine = this.generateFirstSpine(siteBoundary, accessRoad);
            if (firstSpine) {
                spines.push(firstSpine);
            }
            
            const secondSpine = this.generateSecondSpine(siteBoundary, firstSpine);
            if (secondSpine) {
                spines.push(secondSpine);
            }
            
            return spines;
        } catch (error) {
            console.error('❌ Error generating spines:', error);
            return [];
        }
    }
    
    generateFirstSpine(siteBoundary, accessRoad) {
        try {
            const roadCoords = accessRoad.geometry.coordinates;
            const accessEndPoint = roadCoords[roadCoords.length - 1];
            
            const closestEdge = GeometryUtils.findClosestEdgePoint(siteBoundary, accessEndPoint);
            if (!closestEdge) {
                throw new Error('Could not find closest boundary edge');
            }
            
            const edgeDirection = GeometryUtils.getPolygonEdgeDirection(siteBoundary, closestEdge.edgeIndex);
            const spineDirection = GeometryUtils.perpendicular(edgeDirection);
            
            const spineLength = this.calculateOptimalSpineLength(siteBoundary, accessEndPoint, spineDirection);
            
            const leftEndPoint = GeometryUtils.movePoint(accessEndPoint, spineDirection, -spineLength / 2);
            const rightEndPoint = GeometryUtils.movePoint(accessEndPoint, spineDirection, spineLength / 2);
            
            const spineLine = {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [leftEndPoint, rightEndPoint] },
                properties: { type: 'spine', spineIndex: 0, direction: spineDirection }
            };
            
            const spinePolygon = GeometryUtils.bufferLine(spineLine, this.config.spineWidth);
            spinePolygon.properties = {
                ...spineLine.properties,
                width: this.config.spineWidth,
                centerLine: spineLine
            };
            
            return spinePolygon;
        } catch (error) {
            console.error('❌ Error generating first spine:', error);
            return null;
        }
    }
    
    generateSecondSpine(siteBoundary, firstSpine) {
        try {
            const firstSpineDirection = firstSpine.properties.direction;
            const oppositeEdgeIndex = GeometryUtils.findOppositeEdge(siteBoundary, firstSpineDirection);
            
            if (oppositeEdgeIndex === -1) {
                throw new Error('Could not find opposite edge');
            }
            
            const oppositeEdgeDirection = GeometryUtils.getPolygonEdgeDirection(siteBoundary, oppositeEdgeIndex);
            const boundaryCoords = siteBoundary.geometry.coordinates[0];
            const edgeStart = boundaryCoords[oppositeEdgeIndex];
            const edgeEnd = boundaryCoords[(oppositeEdgeIndex + 1) % (boundaryCoords.length - 1)];
            
            const edgeCenter = [(edgeStart[0] + edgeEnd[0]) / 2, (edgeStart[1] + edgeEnd[1]) / 2];
            
            let inwardDirection = GeometryUtils.perpendicular(oppositeEdgeDirection);
            const testPoint = GeometryUtils.movePoint(edgeCenter, inwardDirection, this.config.insetDistance);
            if (!GeometryUtils.pointInPolygon(testPoint, siteBoundary)) {
                inwardDirection[0] = -inwardDirection[0];
                inwardDirection[1] = -inwardDirection[1];
            }
            
            const spineCenter = GeometryUtils.movePoint(edgeCenter, inwardDirection, this.config.insetDistance);
            
            const edgeLength = GeometryUtils.distance(edgeStart, edgeEnd);
            const spineLength = Math.min(edgeLength * 0.8, 100);
            
            const leftEndPoint = GeometryUtils.movePoint(spineCenter, oppositeEdgeDirection, -spineLength / 2);
            const rightEndPoint = GeometryUtils.movePoint(spineCenter, oppositeEdgeDirection, spineLength / 2);
            
            const finalLeftPoint = GeometryUtils.pointInPolygon(leftEndPoint, siteBoundary) ? leftEndPoint : spineCenter;
            const finalRightPoint = GeometryUtils.pointInPolygon(rightEndPoint, siteBoundary) ? rightEndPoint : spineCenter;
            
            const spineLine = {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [finalLeftPoint, finalRightPoint] },
                properties: { type: 'spine', spineIndex: 1, direction: oppositeEdgeDirection }
            };
            
            const spinePolygon = GeometryUtils.bufferLine(spineLine, this.config.spineWidth);
            spinePolygon.properties = {
                ...spineLine.properties,
                width: this.config.spineWidth,
                centerLine: spineLine
            };
            
            return spinePolygon;
        } catch (error) {
            console.error('❌ Error generating second spine:', error);
            return null;
        }
    }
    
    calculateOptimalSpineLength(siteBoundary, startPoint, direction) {
        try {
            const maxLength = 200;
            const step = 5;
            let leftLength = 0;
            let rightLength = 0;
            
            for (let distance = step; distance <= maxLength; distance += step) {
                const testPoint = GeometryUtils.movePoint(startPoint, direction, -distance);
                if (!GeometryUtils.pointInPolygon(testPoint, siteBoundary)) {
                    leftLength = distance - step;
                    break;
                }
                leftLength = distance;
            }
            
            for (let distance = step; distance <= maxLength; distance += step) {
                const testPoint = GeometryUtils.movePoint(startPoint, direction, distance);
                if (!GeometryUtils.pointInPolygon(testPoint, siteBoundary)) {
                    rightLength = distance - step;
                    break;
                }
                rightLength = distance;
            }
            
            return leftLength + rightLength;
        } catch (error) {
            console.error('❌ Error calculating spine length:', error);
            return 50;
        }
    }
    
    generateHousesAlongSpine(spine, siteBoundary, allRoads) {
        try {
            const houses = [];
            const centerLine = spine.properties.centerLine;
            const spineDirection = spine.properties.direction;
            
            const leftHouses = this.generateHousesOnSide(centerLine, spineDirection, 'left', siteBoundary, allRoads);
            const rightHouses = this.generateHousesOnSide(centerLine, spineDirection, 'right', siteBoundary, allRoads);
            
            houses.push(...leftHouses, ...rightHouses);
            return houses;
        } catch (error) {
            console.error('❌ Error generating houses along spine:', error);
            return [];
        }
    }
    
    generateHousesOnSide(centerLine, spineDirection, side, siteBoundary, allRoads) {
        try {
            const houses = [];
            const coords = centerLine.geometry.coordinates;
            const startPoint = coords[0];
            const endPoint = coords[1];
            
            const perpendicularDirection = GeometryUtils.perpendicular(spineDirection);
            const setbackDirection = side === 'left' ? 
                [perpendicularDirection[0], perpendicularDirection[1]] :
                [-perpendicularDirection[0], -perpendicularDirection[1]];
            
            const spineLength = GeometryUtils.distance(startPoint, endPoint);
            const houseType = this.config.houseTypes[this.config.currentHouseType];
            const totalHouseWidth = houseType.width + this.config.houseSpacing;
            const maxHouses = Math.floor(spineLength / totalHouseWidth);
            
            const rotationAngle = Math.atan2(spineDirection[1], spineDirection[0]) * 180 / Math.PI;
            
            for (let i = 0; i < maxHouses; i++) {
                try {
                    const progress = (i + 0.5) / maxHouses;
                    const spinePosition = [
                        startPoint[0] + (endPoint[0] - startPoint[0]) * progress,
                        startPoint[1] + (endPoint[1] - startPoint[1]) * progress
                    ];
                    
                    const setbackDistance = this.config.setback + (houseType.depth / 2);
                    const houseCenter = GeometryUtils.movePoint(spinePosition, setbackDirection, setbackDistance);
                    
                    const house = GeometryUtils.createRectangle(
                        houseCenter,
                        houseType.width,
                        houseType.depth,
                        rotationAngle
                    );
                    
                    house.properties = {
                        type: this.config.currentHouseType,
                        side: side,
                        index: i,
                        width: houseType.width,
                        depth: houseType.depth,
                        area: houseType.width * houseType.depth
                    };
                    
                    if (this.validateHousePlacement(house, siteBoundary, allRoads)) {
                        houses.push(house);
                    }
                } catch (error) {
                    console.error(`❌ Error creating house ${i}:`, error);
                }
            }
            
            return houses;
        } catch (error) {
            console.error('❌ Error generating houses on side:', error);
            return [];
        }
    }
    
    validateHousePlacement(house, siteBoundary, allRoads) {
        try {
            if (!GeometryUtils.polygonInPolygon(house, siteBoundary)) {
                return false;
            }
            
            for (const road of allRoads) {
                if (this.checkOverlap(house, road)) {
                    return false;
                }
            }
            
            return true;
        } catch (error) {
            console.error('❌ Error validating house placement:', error);
            return false;
        }
    }
    
    checkOverlap(house, road) {
        try {
            const houseBounds = this.getBounds(house);
            const roadBounds = this.getBounds(road);
            
            return !(houseBounds.maxX < roadBounds.minX || 
                    roadBounds.maxX < houseBounds.minX || 
                    houseBounds.maxY < roadBounds.minY || 
                    roadBounds.maxY < houseBounds.minY);
        } catch (error) {
            return true;
        }
    }
    
    getBounds(feature) {
        const coords = feature.geometry.coordinates[0];
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        coords.forEach(coord => {
            minX = Math.min(minX, coord[0]);
            maxX = Math.max(maxX, coord[0]);
            minY = Math.min(minY, coord[1]);
            maxY = Math.max(maxY, coord[1]);
        });
        
        return { minX, maxX, minY, maxY };
    }
    
    addLayer(layerConfig) {
        try {
            if (this.map.getLayer(layerConfig.id)) {
                this.removeLayer(layerConfig.id);
            }
            
            const sourceId = `${layerConfig.id}-source`;
            if (!this.map.getSource(sourceId)) {
                this.map.addSource(sourceId, layerConfig.source);
                layerConfig.source = sourceId;
            }
            
            this.map.addLayer(layerConfig);
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
        } catch (error) {
            console.error(`❌ Failed to remove layer '${layerId}':`, error);
        }
    }
    
    clearGeneratedFeatures() {
        const layersToRemove = [];
        this.state.spines.forEach((_, index) => {
            layersToRemove.push(`spine-${index}`);
        });
        layersToRemove.push('houses');
        
        layersToRemove.forEach(layerId => {
            this.removeLayer(layerId);
        });
        
        this.state.spines = [];
        this.state.houses = [];
    }
    
    clearAll() {
        this.clearGeneratedFeatures();
        
        if (this.state.siteBoundary) {
            this.removeLayer('site-boundary');
            this.removeLayer('site-boundary-outline');
            this.state.siteBoundary = null;
        }
        
        if (this.state.accessRoad) {
            this.removeLayer('access-road');
            this.state.accessRoad = null;
        }
        
        this.draw.deleteAll();
        this.deactivateTools();
        this.updateStats();
        
        this.showNotification('All features cleared', 'info');
    }
    
    deactivateTools() {
        document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
        this.draw.changeMode('simple_select');
        this.state.currentTool = null;
    }
    
    updateStats() {
        try {
            const totalArea = this.state.siteBoundary ? 
                GeometryUtils.polygonArea(this.state.siteBoundary) : 0;
            const homeCount = this.state.houses ? this.state.houses.length : 0;
            const density = totalArea > 0 ? 
                Math.round((homeCount / (totalArea / 10000)) * 100) / 100 : 0;
            
            const areaElement = document.getElementById('total-area');
            if (areaElement) {
                const areaInHectares = totalArea / 10000;
                areaElement.textContent = `${Math.round(areaInHectares * 100) / 100} ha`;
            }
            
            const homeCountElement = document.getElementById('home-count');
            if (homeCountElement) {
                homeCountElement.textContent = homeCount.toString();
            }
            
            const densityElement = document.getElementById('density');
            if (densityElement) {
                densityElement.textContent = `${density} homes/ha`;
            }
        } catch (error) {
            console.error('❌ Error updating stats:', error);
        }
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
