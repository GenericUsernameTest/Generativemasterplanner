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
        if (rotationD
