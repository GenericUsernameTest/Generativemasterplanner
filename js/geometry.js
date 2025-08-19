// js/geometry.js - Geometry calculations and utilities
export class GeometryUtils {
    
    // Calculate distance between two points in meters
    static distance(point1, point2) {
        const dx = point2[0] - point1[0];
        const dy = point2[1] - point1[1];
        // Convert degrees to meters (approximate)
        const metersPerDegree = 111000;
        return Math.sqrt(dx * dx + dy * dy) * metersPerDegree;
    }
    
    // Calculate bearing from point1 to point2 in degrees
    static bearing(point1, point2) {
        const dx = point2[0] - point1[0];
        const dy = point2[1] - point1[1];
        const angle = Math.atan2(dx, dy) * 180 / Math.PI;
        return (angle + 360) % 360;
    }
    
    // Create a unit vector from an angle in degrees
    static vectorFromAngle(degrees) {
        const radians = degrees * Math.PI / 180;
        return [Math.sin(radians), Math.cos(radians)];
    }
    
    // Calculate angle between two vectors in degrees
    static angleBetweenVectors(v1, v2) {
        const dot = this.dotProduct(v1, v2);
        const mag1 = this.magnitude(v1);
        const mag2 = this.magnitude(v2);
        const cosAngle = dot / (mag1 * mag2);
        return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180 / Math.PI;
    }
    
    // Dot product of two vectors
    static dotProduct(v1, v2) {
        return v1[0] * v2[0] + v1[1] * v2[1];
    }
    
    // Magnitude of a vector
    static magnitude(vector) {
        return Math.sqrt(vector[0] * vector[0] + vector[1] * vector[1]);
    }
    
    // Normalize a vector to unit length
    static normalize(vector) {
        const mag = this.magnitude(vector);
        if (mag === 0) return [0, 0];
        return [vector[0] / mag, vector[1] / mag];
    }
    
    // Get perpendicular vector (90 degrees counter-clockwise)
    static perpendicular(vector) {
        return [-vector[1], vector[0]];
    }
    
    // Move a point by distance in direction of vector
    static movePoint(point, vector, distance) {
        const normalizedVector = this.normalize(vector);
        // Convert distance from meters to degrees (approximate)
        const degreesPerMeter = 1 / 111000;
        const distanceInDegrees = distance * degreesPerMeter;
        
        return [
            point[0] + normalizedVector[0] * distanceInDegrees,
            point[1] + normalizedVector[1] * distanceInDegrees
        ];
    }
    
    // Get the center point of a line
    static getLineCenter(line) {
        const coords = line.geometry ? line.geometry.coordinates : line.coordinates;
        const start = coords[0];
        const end = coords[coords.length - 1];
        return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    }
    
    // Get direction vector from line
    static getLineDirection(line) {
        const coords = line.geometry ? line.geometry.coordinates : line.coordinates;
        const start = coords[0];
        const end = coords[coords.length - 1];
        return this.normalize([end[0] - start[0], end[1] - start[1]]);
    }
    
    // Find the closest point on polygon edge to given point
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
        
        return {
            point: closestPoint,
            distance: closestDistance,
            edgeIndex: closestEdgeIndex
        };
    }
    
    // Find closest point on line segment to given point
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
        
        return [
            lineStart[0] + param * C,
            lineStart[1] + param * D
        ];
    }
    
    // Get edge direction vector from polygon
    static getPolygonEdgeDirection(polygon, edgeIndex) {
        const coords = polygon.geometry.coordinates[0];
        const start = coords[edgeIndex];
        const end = coords[(edgeIndex + 1) % (coords.length - 1)];
        return this.normalize([end[0] - start[0], end[1] - start[1]]);
    }
    
    // Find the edge most opposite to given direction
    static findOppositeEdge(polygon, direction) {
        const coords = polygon.geometry.coordinates[0];
        let mostOpposite = -1;
        let minDot = 1; // Looking for most negative dot product
        
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
    
    // Create rectangle from center point, width, height, and rotation
    static createRectangle(center, width, height, rotationDegrees = 0) {
        // Convert meters to degrees (approximate)
        const degreesPerMeter = 1 / 111000;
        const w = width * degreesPerMeter / 2;
        const h = height * degreesPerMeter / 2;
        
        // Create corners relative to center
        let corners = [
            [-w, -h],
            [w, -h],
            [w, h],
            [-w, h],
            [-w, -h] // Close the polygon
        ];
        
        // Apply rotation if specified
        if (rotationDegrees !== 0) {
            const radians = rotationDegrees * Math.PI / 180;
            const cos = Math.cos(radians);
            const sin = Math.sin(radians);
            
            corners = corners.map(corner => [
                corner[0] * cos - corner[1] * sin,
                corner[0] * sin + corner[1] * cos
            ]);
        }
        
        // Translate to center position
        const coordinates = corners.map(corner => [
            center[0] + corner[0],
            center[1] + corner[1]
        ]);
        
        return {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [coordinates]
            },
            properties: {}
        };
    }
    
    // Check if point is inside polygon
    static pointInPolygon(point, polygon) {
        const coords = polygon.geometry ? polygon.geometry.coordinates[0] : polygon.coordinates[0];
        const x = point[0];
        const y = point[1];
        
        let inside = false;
        for (let i = 0, j = coords.length - 2; i < coords.length - 1; j = i++) {
            const xi = coords[i][0];
            const yi = coords[i][1];
            const xj = coords[j][0];
            const yj = coords[j][1];
            
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        
        return inside;
    }
    
    // Check if polygon is entirely inside another polygon
    static polygonInPolygon(innerPolygon, outerPolygon) {
        const innerCoords = innerPolygon.geometry ? innerPolygon.geometry.coordinates[0] : innerPolygon.coordinates[0];
        
        // Check if all vertices of inner polygon are inside outer polygon
        for (let i = 0; i < innerCoords.length - 1; i++) {
            if (!this.pointInPolygon(innerCoords[i], outerPolygon)) {
                return false;
            }
        }
        
        return true;
    }
    
    // Calculate polygon area in square meters
    static polygonArea(polygon) {
        const coords = polygon.geometry ? polygon.geometry.coordinates[0] : polygon.coordinates[0];
        let area = 0;
        
        for (let i = 0; i < coords.length - 1; i++) {
            const j = (i + 1) % (coords.length - 1);
            area += coords[i][0] * coords[j][1];
            area -= coords[j][0] * coords[i][1];
        }
        
        area = Math.abs(area) / 2;
        
        // Convert from square degrees to square meters (approximate)
        const metersPerDegree = 111000;
        return area * metersPerDegree * metersPerDegree;
    }
    
    // Create a buffer around a line (polygon corridor)
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
            
            // Get direction vector
            const direction = this.normalize([end[0] - start[0], end[1] - start[1]]);
            
            // Get perpendicular vector
            const perpendicular = this.perpendicular(direction);
            
            // Calculate offset points
            const leftOffset = [
                start[0] + perpendicular[0] * halfWidthDegrees,
                start[1] + perpendicular[1] * halfWidthDegrees
            ];
            const rightOffset = [
                start[0] - perpendicular[0] * halfWidthDegrees,
                start[1] - perpendicular[1] * halfWidthDegrees
            ];
            
            leftSide.push(leftOffset);
            rightSide.push(rightOffset);
        }
        
        // Add final points
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
        
        // Create polygon coordinates (left side + reversed right side)
        const polygonCoords = [...leftSide, ...rightSide.reverse(), leftSide[0]];
        
        return {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [polygonCoords]
            },
            properties: {
                width: width
            }
        };
    }
}
