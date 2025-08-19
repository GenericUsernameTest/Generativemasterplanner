// js/housing.js - House generation and placement
import { GeometryUtils } from './geometry.js';

export class HousingManager {
    constructor(map) {
        this.map = map;
        this.houseTypes = {
            small: { width: 8, depth: 12, name: 'Small House' },
            medium: { width: 10, depth: 15, name: 'Medium House' },
            large: { width: 12, depth: 18, name: 'Large House' }
        };
        this.setback = 3; // meters from spine road
        this.houseSpacing = 4; // meters between houses
        this.currentHouseType = 'medium';
    }
    
    generateHousesAlongSpine(spine, siteBoundary, allRoads) {
        try {
            const houses = [];
            const centerLine = spine.properties.centerLine;
            const spineDirection = spine.properties.direction;
            
            // Generate houses on both sides of the spine
            const leftHouses = this.generateHousesOnSide(centerLine, spineDirection, 'left', siteBoundary, allRoads);
            const rightHouses = this.generateHousesOnSide(centerLine, spineDirection, 'right', siteBoundary, allRoads);
            
            houses.push(...leftHouses, ...rightHouses);
            
            console.log(`🏠 Generated ${houses.length} houses along spine ${spine.properties.spineIndex}`);
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
            
            // Calculate perpendicular direction for setback
            const perpendicularDirection = GeometryUtils.perpendicular(spineDirection);
            
            // Determine setback direction (left or right side)
            const setbackDirection = side === 'left' ? 
                [perpendicularDirection[0], perpendicularDirection[1]] :
                [-perpendicularDirection[0], -perpendicularDirection[1]];
            
            // Calculate house placement positions along the spine
            const spineLength = GeometryUtils.distance(startPoint, endPoint);
            const houseType = this.houseTypes[this.currentHouseType];
            const totalHouseWidth = houseType.width + this.houseSpacing;
            const maxHouses = Math.floor(spineLength / totalHouseWidth);
            
            // Calculate rotation angle for houses (align with spine)
            const rotationAngle = Math.atan2(spineDirection[1], spineDirection[0]) * 180 / Math.PI;
            
            for (let i = 0; i < maxHouses; i++) {
                try {
                    // Calculate position along spine
                    const progress = (i + 0.5) / maxHouses; // Center houses in their slots
                    const spinePosition = [
                        startPoint[0] + (endPoint[0] - startPoint[0]) * progress,
                        startPoint[1] + (endPoint[1] - startPoint[1]) * progress
                    ];
                    
                    // Apply setback from spine
                    const setbackDistance = this.setback + (houseType.depth / 2);
                    const houseCenter = GeometryUtils.movePoint(spinePosition, setbackDirection, setbackDistance);
                    
                    // Create house geometry
                    const house = GeometryUtils.createRectangle(
                        houseCenter,
                        houseType.width,
                        houseType.depth,
                        rotationAngle
                    );
                    
                    // Add house properties
                    house.properties = {
                        type: this.currentHouseType,
                        side: side,
                        index: i,
                        width: houseType.width,
                        depth: houseType.depth,
                        area: houseType.width * houseType.depth
                    };
                    
                    // Validate house placement
                    if (this.validateHousePlacement(house, siteBoundary, allRoads)) {
                        houses.push(house);
                    } else {
                        console.log(`🚫 House ${i} on ${side} side rejected (outside boundary or overlaps road)`);
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
            // Check if house is entirely within site boundary
            if (!GeometryUtils.polygonInPolygon(house, siteBoundary)) {
                return false;
            }
            
            // Check if house overlaps with any road
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
            // Simple bounding box check for overlap
            const houseBounds = this.getBounds(house);
            const roadBounds = this.getBounds(road);
            
            return !(houseBounds.maxX < roadBounds.minX || 
                    roadBounds.maxX < houseBounds.minX || 
                    houseBounds.maxY < roadBounds.minY || 
                    roadBounds.maxY < houseBounds.minY);
        } catch (error) {
            console.error('❌ Error checking overlap:', error);
            return true; // Assume overlap on error to be safe
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
    
    setHouseType(type) {
        if (this.houseTypes[type]) {
            this.currentHouseType = type;
            console.log(`🏠 House type set to: ${this.houseTypes[type].name}`);
        } else {
            console.error(`❌ Invalid house type: ${type}`);
        }
    }
    
    getHouseType() {
        return this.currentHouseType;
    }
    
    getHouseTypes() {
        return this.houseTypes;
    }
    
    setSetback(distance) {
        this.setback = distance;
        console.log(`📏 Setback distance set to: ${distance}m`);
    }
    
    getSetback() {
        return this.setback;
    }
    
    setHouseSpacing(spacing) {
        this.houseSpacing = spacing;
        console.log(`📏 House spacing set to: ${spacing}m`);
    }
    
    getHouseSpacing() {
        return this.houseSpacing;
    }
    
    calculateHouseCount(spineLength, houseType = this.currentHouseType) {
        const house = this.houseTypes[houseType];
        const totalHouseWidth = house.width + this.houseSpacing;
        return Math.floor(spineLength / totalHouseWidth);
    }
    
    calculateDensity(houses, siteArea) {
        if (siteArea <= 0) return 0;
        const areaInHectares = siteArea / 10000; // Convert m² to hectares
        return houses.length / areaInHectares;
    }
    
    getHousesByType() {
        // This would be used if we had existing houses to categorize
        const housesByType = {
            small: 0,
            medium: 0,
            large: 0
        };
        
        return housesByType;
    }
    
    // Method to create mixed housing (future enhancement)
    generateMixedHousesOnSide(centerLine, spineDirection, side, siteBoundary, allRoads, typeDistribution = null) {
        // typeDistribution could be like: { small: 0.3, medium: 0.5, large: 0.2 }
        // This method could cycle through different house types
        // Implementation would be similar to generateHousesOnSide but with varying house types
        
        // For now, we'll just use the current house type
        return this.generateHousesOnSide(centerLine, spineDirection, side, siteBoundary, allRoads);
    }
}
