// js/spines.js - Spine road generation
import { GeometryUtils } from './geometry.js';

export class SpineManager {
    constructor(map) {
        this.map = map;
        this.spineWidth = 8; // meters
        this.insetDistance = 10; // meters from boundary for second spine
    }
    
    validateRoadIntersection(accessRoad, siteBoundary) {
        try {
            const roadCoords = accessRoad.geometry.coordinates;
            const boundaryCoords = siteBoundary.geometry.coordinates[0];
            
            // Check if road end point is inside boundary
            const endPoint = roadCoords[roadCoords.length - 1];
            return GeometryUtils.pointInPolygon(endPoint, siteBoundary);
        } catch (error) {
            console.error('❌ Error validating road intersection:', error);
            return false;
        }
    }
    
    generateSpines(siteBoundary, accessRoad) {
        try {
            const spines = [];
            
            // Generate first spine (perpendicular to nearest boundary edge)
            const firstSpine = this.generateFirstSpine(siteBoundary, accessRoad);
            if (firstSpine) {
                spines.push(firstSpine);
                console.log('✅ First spine generated');
            }
            
            // Generate second spine (along opposite edge)
            const secondSpine = this.generateSecondSpine(siteBoundary, firstSpine);
            if (secondSpine) {
                spines.push(secondSpine);
                console.log('✅ Second spine generated');
            }
            
            return spines;
        } catch (error) {
            console.error('❌ Error generating spines:', error);
            return [];
        }
    }
    
    generateFirstSpine(siteBoundary, accessRoad) {
        try {
            // Get access road end point (inside the site)
            const roadCoords = accessRoad.geometry.coordinates;
            const accessEndPoint = roadCoords[roadCoords.length - 1];
            
            // Find closest boundary edge
            const closestEdge = GeometryUtils.findClosestEdgePoint(siteBoundary, accessEndPoint);
            
            if (!closestEdge) {
                throw new Error('Could not find closest boundary edge');
            }
            
            // Get edge direction
            const edgeDirection = GeometryUtils.getPolygonEdgeDirection(siteBoundary, closestEdge.edgeIndex);
            
            // Create perpendicular direction (for spine)
            const spineDirection = GeometryUtils.perpendicular(edgeDirection);
            
            // Create spine line from access point
            const spineLength = this.calculateOptimalSpineLength(siteBoundary, accessEndPoint, spineDirection);
            
            // Create spine line extending in both directions from access point
            const leftEndPoint = GeometryUtils.movePoint(accessEndPoint, spineDirection, -spineLength / 2);
            const rightEndPoint = GeometryUtils.movePoint(accessEndPoint, spineDirection, spineLength / 2);
            
            // Create spine line feature
            const spineLine = {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [leftEndPoint, rightEndPoint]
                },
                properties: {
                    type: 'spine',
                    spineIndex: 0,
                    direction: spineDirection
                }
            };
            
            // Convert to polygon (road corridor)
            const spinePolygon = GeometryUtils.bufferLine(spineLine, this.spineWidth);
            spinePolygon.properties = {
                ...spineLine.properties,
                width: this.spineWidth,
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
            // Get first spine direction
            const firstSpineDirection = firstSpine.properties.direction;
            
            // Find opposite edge (most opposite direction)
            const oppositeEdgeIndex = GeometryUtils.findOppositeEdge(siteBoundary, firstSpineDirection);
            
            if (oppositeEdgeIndex === -1) {
                throw new Error('Could not find opposite edge');
            }
            
            // Get opposite edge direction and coordinates
            const oppositeEdgeDirection = GeometryUtils.getPolygonEdgeDirection(siteBoundary, oppositeEdgeIndex);
            const boundaryCoords = siteBoundary.geometry.coordinates[0];
            const edgeStart = boundaryCoords[oppositeEdgeIndex];
            const edgeEnd = boundaryCoords[(oppositeEdgeIndex + 1) % (boundaryCoords.length - 1)];
            
            // Create spine line along the opposite edge (inset from boundary)
            const edgeCenter = [(edgeStart[0] + edgeEnd[0]) / 2, (edgeStart[1] + edgeEnd[1]) / 2];
            
            // Move inward from boundary
            const inwardDirection = GeometryUtils.perpendicular(oppositeEdgeDirection);
            
            // Determine which perpendicular direction points inward
            const testPoint = GeometryUtils.movePoint(edgeCenter, inwardDirection, this.insetDistance);
            if (!GeometryUtils.pointInPolygon(testPoint, siteBoundary)) {
                // Try the opposite direction
                inwardDirection[0] = -inwardDirection[0];
                inwardDirection[1] = -inwardDirection[1];
            }
            
            const spineCenter = GeometryUtils.movePoint(edgeCenter, inwardDirection, this.insetDistance);
            
            // Calculate spine length along the edge
            const edgeLength = GeometryUtils.distance(edgeStart, edgeEnd);
            const spineLength = Math.min(edgeLength * 0.8, 100); // Max 100m or 80% of edge length
            
            // Create spine endpoints
            const leftEndPoint = GeometryUtils.movePoint(spineCenter, oppositeEdgeDirection, -spineLength / 2);
            const rightEndPoint = GeometryUtils.movePoint(spineCenter, oppositeEdgeDirection, spineLength / 2);
            
            // Ensure endpoints are inside boundary
            const finalLeftPoint = GeometryUtils.pointInPolygon(leftEndPoint, siteBoundary) ? leftEndPoint : spineCenter;
            const finalRightPoint = GeometryUtils.pointInPolygon(rightEndPoint, siteBoundary) ? rightEndPoint : spineCenter;
            
            // Create spine line feature
            const spineLine = {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [finalLeftPoint, finalRightPoint]
                },
                properties: {
                    type: 'spine',
                    spineIndex: 1,
                    direction: oppositeEdgeDirection
                }
            };
            
            // Convert to polygon (road corridor)
            const spinePolygon = GeometryUtils.bufferLine(spineLine, this.spineWidth);
            spinePolygon.properties = {
                ...spineLine.properties,
                width: this.spineWidth,
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
            // Cast rays in both directions to find site boundaries
            const maxLength = 200; // Maximum spine length in meters
            const step = 5; // Step size in meters
            
            let leftLength = 0;
            let rightLength = 0;
            
            // Check left direction
            for (let distance = step; distance <= maxLength; distance += step) {
                const testPoint = GeometryUtils.movePoint(startPoint, direction, -distance);
                if (!GeometryUtils.pointInPolygon(testPoint, siteBoundary)) {
                    leftLength = distance - step;
                    break;
                }
                leftLength = distance;
            }
            
            // Check right direction
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
            return 50; // Default length
        }
    }
    
    getSpineDirection(spine) {
        return spine.properties.direction;
    }
    
    getSpineCenterLine(spine) {
        return spine.properties.centerLine;
    }
    
    getSpineWidth() {
        return this.spineWidth;
    }
    
    setSpineWidth(width) {
        this.spineWidth = width;
    }
    
    getInsetDistance() {
        return this.insetDistance;
    }
    
    setInsetDistance(distance) {
        this.insetDistance = distance;
    }
}
