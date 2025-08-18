function addSecondSpine(boundaryCoords, firstSpineLine, firstSpineDirection) {
    const spineWidth = 0.000045;
    const houseSpacing = 0.000063;
    const rowOffset = 0.00008;
    const houseWidth = 0.000045;
    const houseLength = 0.000045;
    const houseHeight = 4;
    const boundaryBuffer = 0.000050;

    // 1. Find the edge farthest from the first spine midpoint
    const midX = (firstSpineLine[0][0] + firstSpineLine[1][0]) / 2;
    const midY = (firstSpineLine[0][1] + firstSpineLine[1][1]) / 2;
    const midpoint = [midX, midY];

    let farthestEdge = null;
    let maxDistance = 0;

    for (let i = 0; i < boundaryCoords.length - 1; i++) {
        const start = boundaryCoords[i];
        const end = boundaryCoords[i + 1];

        const distance = pointToLineDistance(midpoint, start, end);
        if (distance > maxDistance) {
            maxDistance = distance;
            const dx = end[0] - start[0];
            const dy = end[1] - start[1];
            const length = Math.sqrt(dx * dx + dy * dy);

            farthestEdge = {
                start,
                end,
                direction: [dx / length, dy / length]
            };
        }
    }

    if (!farthestEdge || maxDistance < 0.0001) return; // Add minimum distance check

    // 2. Create second spine road from midpoint toward farthest edge
    const spineDirection = farthestEdge.direction;

    // Use midpoint as center and extend in both directions
    const leftLength = calculateSpineLengthInDirection(
        midpoint,
        [-spineDirection[0], -spineDirection[1]],
        boundaryCoords,
        boundaryBuffer
    );
    const rightLength = calculateSpineLengthInDirection(
        midpoint,
        spineDirection,
        boundaryCoords,
        boundaryBuffer
    );

    const spineStart = [
        midpoint[0] - spineDirection[0] * leftLength,
        midpoint[1] - spineDirection[1] * leftLength
    ];

    const spineEnd = [
        midpoint[0] + spineDirection[0] * rightLength,
        midpoint[1] + spineDirection[1] * rightLength
    ];

    const spineLine = [spineStart, spineEnd];
    const spinePolygon = createSpineRoadPolygon(spineLine, spineWidth);

    if (spinePolygon) {
        // Create the spine road feature
        const spineRoadFeature = {
            type: 'Feature',
            geometry: spinePolygon,
            properties: { type: 'spine-road' }
        };

        // Add to the existing access roads array (this will be updated in the main function)
        accessRoads.push(spineRoadFeature);

        console.log('Second spine road created');
    }

    // 3. Generate houses along the second spine
    const totalSpineLength = Math.sqrt(
        Math.pow(spineEnd[0] - spineStart[0], 2) +
        Math.pow(spineEnd[1] - spineStart[1], 2)
    );

    if (totalSpineLength < 0.00001) return; // Avoid division by zero

    const spineAngle = Math.atan2(
        spineEnd[1] - spineStart[1],
        spineEnd[0] - spineStart[0]
    );

    const perpDirection = [
        -(spineEnd[1] - spineStart[1]) / totalSpineLength,
        (spineEnd[0] - spineStart[0]) / totalSpineLength
    ];

    const numHouses = Math.floor(totalSpineLength / houseSpacing);

    for (let i = 0; i <= numHouses; i++) {
        const t = i / Math.max(numHouses, 1);
        const spineX = spineStart[0] + t * (spineEnd[0] - spineStart[0]);
        const spineY = spineStart[1] + t * (spineEnd[1] - spineStart[1]);

        [-1, 1].forEach(side => {
            const houseX = spineX + perpDirection[0] * side * (spineWidth / 2 + rowOffset);
            const houseY = spineY + perpDirection[1] * side * (spineWidth / 2 + rowOffset);
            const housePoint = [houseX, houseY];

            // Check if house location is valid (inside boundary, not on roads)
            if (
                isPointInPolygon(housePoint, boundaryCoords) &&
                !isPointOnAnyRoad(housePoint, [...accessRoads]) // Check against all roads
            ) {
                const house = createRotatedHouse(houseX, houseY, houseLength, houseWidth, spineAngle);

                if (
                    house &&
                    house.coordinates[0].every(corner => isPointInPolygon(corner, boundaryCoords))
                ) {
                    houses.push({
                        type: 'Feature',
                        geometry: house,
                        properties: {
                            type: 'house',
                            id: houses.length + 1,
                            height: houseHeight
                        }
                    });
                }
            }
        });
    }

    console.log('Added houses along second spine, total houses now:', houses.length);
}

// Helper function to check if a point is on any road
function isPointOnAnyRoad(point, roads, buffer = 0.00008) {
    for (const road of roads) {
        if (road.geometry.type === 'LineString') {
            // For line string roads (access roads drawn by user)
            if (isPointOnAccessRoad(point, road.geometry.coordinates, buffer)) {
                return true;
            }
        } else if (road.geometry.type === 'Polygon') {
            // For polygon roads (spine roads), check if point is inside polygon
            if (isPointInPolygon(point, road.geometry.coordinates[0])) {
                return true;
            }
        }
    }
    return false;
}

// Updated generateHousesAlongRoads function with better integration
function generateHousesAlongRoads() {
    houses = [];
    let spineRoads = [];

    if (!siteBoundary) {
        console.log('No site boundary found');
        return;
    }

    const boundaryCoords = siteBoundary.geometry.coordinates[0];

    // Process each access road and create spine roads
    accessRoads.forEach(road => {
        const coords = road.geometry.coordinates;

        // Convert access road to polygon
        const accessRoadPolygon = createSpineRoadPolygon(coords, 0.000072); // 8m width

        if (accessRoadPolygon) {
            road.geometry = accessRoadPolygon;
            road.properties = { type: 'access-road' };
        }

        const accessEndPoint = coords[coords.length - 1];

        if (!isPointInPolygon(accessEndPoint, boundaryCoords)) return;

        const closestEdge = findClosestBoundaryEdge(accessEndPoint, boundaryCoords);
        if (!closestEdge) return;

        const spineWidth = 0.000045;
        const boundaryBuffer = 0.000050;

        const leftLength = calculateSpineLengthInDirection(
            accessEndPoint,
            [-closestEdge.direction[0], -closestEdge.direction[1]],
            boundaryCoords,
            boundaryBuffer
        );

        const rightLength = calculateSpineLengthInDirection(
            accessEndPoint,
            closestEdge.direction,
            boundaryCoords,
            boundaryBuffer
        );

        const spineStart = [
            accessEndPoint[0] - closestEdge.direction[0] * leftLength,
            accessEndPoint[1] - closestEdge.direction[1] * leftLength
        ];

        const spineEnd = [
            accessEndPoint[0] + closestEdge.direction[0] * rightLength,
            accessEndPoint[1] + closestEdge.direction[1] * rightLength
        ];

        const spineLine = [spineStart, spineEnd];
        const spinePolygon = createSpineRoadPolygon(spineLine, spineWidth);

        if (spinePolygon) {
            spineRoads.push({
                type: 'Feature',
                geometry: spinePolygon,
                properties: { type: 'spine-road' }
            });
        }

        // Generate houses along first spine
        generateHousesAlongSpine(spineLine, spineWidth, boundaryCoords);

        // Generate second spine from this first spine
        addSecondSpine(boundaryCoords, spineLine, closestEdge.direction);
    });

    // Update map with all roads (access roads + spine roads + second spine roads)
    const allRoads = [...accessRoads, ...spineRoads];
    map.getSource('access-roads').setData({
        type: 'FeatureCollection',
        features: allRoads
    });

    // Update map with all houses
    map.getSource('houses').setData({
        type: 'FeatureCollection',
        features: houses
    });

    stats.homeCount = houses.length;
    console.log('Generated', houses.length, 'houses total');
}

// Extract house generation logic into separate function for reuse
function generateHousesAlongSpine(spineLine, spineWidth, boundaryCoords) {
    const houseSpacing = 0.000063;
    const rowOffset = 0.00008;
    const houseWidth = 0.000045;
    const houseLength = 0.000045;
    const houseHeight = 4;

    const spineDirection = [
        spineLine[1][0] - spineLine[0][0],
        spineLine[1][1] - spineLine[0][1]
    ];

    const totalSpineLength = Math.sqrt(spineDirection[0] ** 2 + spineDirection[1] ** 2);
    const spineAngle = Math.atan2(spineDirection[1], spineDirection[0]);

    const perpDirection = [
        -spineDirection[1] / totalSpineLength,
        spineDirection[0] / totalSpineLength
    ];

    const numHouses = Math.floor(totalSpineLength / houseSpacing);

    for (let i = 0; i <= numHouses; i++) {
        const t = i / Math.max(numHouses, 1);
        const spineX = spineLine[0][0] + t * spineDirection[0];
        const spineY = spineLine[0][1] + t * spineDirection[1];

        [-1, 1].forEach(side => {
            const houseX = spineX + perpDirection[0] * side * (spineWidth / 2 + rowOffset);
            const houseY = spineY + perpDirection[1] * side * (spineWidth / 2 + rowOffset);
            const housePoint = [houseX, houseY];

            if (
                isPointInPolygon(housePoint, boundaryCoords) &&
                !isPointOnAnyRoad(housePoint, accessRoads)
            ) {
                const house = createRotatedHouse(houseX, houseY, houseLength, houseWidth, spineAngle);
                
                if (house && house.coordinates[0].every(corner => isPointInPolygon(corner, boundaryCoords))) {
                    houses.push({
                        type: 'Feature',
                        geometry: house,
                        properties: {
                            type: 'house',
                            id: houses.length + 1,
                            height: houseHeight
                        }
                    });
                }
            }
        });
    }
}
