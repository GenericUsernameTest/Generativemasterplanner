// Replace your generateHousesAlongSpine function with this debug version:

function generateHousesAlongSpine(spineLine, spineWidth, boundaryCoords) {
  console.log('=== generateHousesAlongSpine CALLED ===');
  console.log('spineLine:', spineLine);
  console.log('spineWidth:', spineWidth);
  console.log('boundaryCoords length:', boundaryCoords.length);
  
  const lat = map.getCenter().lat;
  console.log('Current latitude:', lat);

  const houseType = {
    width: 11,
    length: 7,
    setbackFront: 3,
    setbackBack: 3
  };

  const dimensions = {
    widthDeg: metersToDegrees(houseType.width, lat).lng,
    lengthDeg: metersToDegrees(houseType.length, lat).lat,
    setbackFrontDeg: metersToDegrees(houseType.setbackFront, lat).lat,
    setbackBackDeg: metersToDegrees(houseType.setbackBack, lat).lat
  };

  console.log('House dimensions in degrees:', dimensions);

  const houseGapMeters = 4;
  const houseSpacing = dimensions.lengthDeg + metersToDegrees(houseGapMeters, lat).lat;
  const houseHeight = 4;

  console.log('House spacing:', houseSpacing);

  // Vector along the spine
  const spineDx = spineLine[1][0] - spineLine[0][0];
  const spineDy = spineLine[1][1] - spineLine[0][1];
  const spineLength = Math.sqrt(spineDx ** 2 + spineDy ** 2);
  
  console.log('Spine vector:', {spineDx, spineDy, spineLength});
  
  if (spineLength === 0) {
    console.log('❌ Spine length is 0!');
    return;
  }

  const unitDirection = [spineDx / spineLength, spineDy / spineLength];
  const perpDirection = [-unitDirection[1], unitDirection[0]];
  const spineAngle = Math.atan2(spineDy, spineDx);

  console.log('Directions:', {unitDirection, perpDirection, spineAngle});

  const numHouses = Math.floor(spineLength / houseSpacing);
  console.log('Number of houses to generate:', numHouses);

  if (numHouses === 0) {
    console.log('❌ No houses to generate - spine too short or spacing too large');
    console.log('Spine length:', spineLength, 'House spacing:', houseSpacing);
    return;
  }

  let housesGenerated = 0;

  for (let i = 0; i < numHouses; i++) {
    console.log(`\n--- Processing house ${i + 1} ---`);
    
    const offsetAlong = i * houseSpacing;
    const spineX = spineLine[0][0] + unitDirection[0] * offsetAlong;
    const spineY = spineLine[0][1] + unitDirection[1] * offsetAlong;

    console.log('Spine position:', {spineX, spineY, offsetAlong});

    [-1, 1].forEach((side, sideIndex) => {
      console.log(`  Testing side ${side} (${sideIndex === 0 ? 'left' : 'right'})`);
      
      const sideClearanceMeters = 1.5;
      const sideClearanceDeg = metersToDegrees(sideClearanceMeters, lat).lat;

      const offsetDistance = spineWidth / 2 + dimensions.setbackFrontDeg + dimensions.widthDeg / 2 + sideClearanceDeg;

      console.log('  Offset distance:', offsetDistance);

      const houseX = spineX + perpDirection[0] * side * offsetDistance;
      const houseY = spineY + perpDirection[1] * side * offsetDistance;
      const housePoint = [houseX, houseY];

      console.log('  House center point:', housePoint);

      // Check if point is in boundary
      const inBoundary = isPointInPolygon(housePoint, boundaryCoords);
      console.log('  In boundary:', inBoundary);

      if (!inBoundary) {
        console.log('  ❌ House rejected: outside boundary');
        return;
      }

      // Check if point is on access road
      const onAccessRoad = accessRoads.some(road =>
        isPointOnAccessRoad(housePoint, road.geometry?.coordinates || [], 0.00008)
      );
      console.log('  On access road:', onAccessRoad);

      if (onAccessRoad) {
        console.log('  ❌ House rejected: on access road');
        return;
      }

      // Create house geometry
      const house = createRotatedHouse(
        houseX,
        houseY,
        dimensions.widthDeg,    
        dimensions.lengthDeg,   
        spineAngle
      );

      console.log('  House created:', !!house);

      if (!house) {
        console.log('  ❌ House rejected: geometry creation failed');
        return;
      }

      // Check if all corners are in boundary
      const allCornersInBoundary = house.coordinates[0].every(corner => {
        const inBound = isPointInPolygon(corner, boundaryCoords);
        console.log('    Corner', corner, 'in boundary:', inBound);
        return inBound;
      });

      console.log('  All corners in boundary:', allCornersInBoundary);

      if (allCornersInBoundary) {
        houses.push({
          type: 'Feature',
          geometry: house,
          properties: {
            type: 'house',
            id: houses.length + 1,
            height: houseHeight
          }
        });
        housesGenerated++;
        console.log('  ✅ House added successfully!');
      } else {
        console.log('  ❌ House rejected: corners outside boundary');
      }
    });
  }

  console.log(`\n=== SUMMARY: Generated ${housesGenerated} houses ===`);
}

// Also add this debug version of generatePlan:
function generatePlan() {
    console.log('=== GENERATE PLAN CALLED ===');
    
    if (!siteBoundary) {
        console.log('❌ No site boundary');
        showNotification('Please draw a site boundary first!', 'error');
        return;
    }
    
    if (accessRoads.length === 0) {
        console.log('❌ No access roads');
        showNotification('Please draw at least one access road!', 'error');
        return;
    }
    
    console.log('✅ Have boundary and roads, proceeding...');
    console.log('Site boundary:', siteBoundary);
    console.log('Access roads:', accessRoads);
    
    showLoading(true);
    showNotification('Generating masterplan...', 'info');
    
    setTimeout(() => {
        console.log('Starting house generation...');
        generateHousesAlongRoads();
        console.log('House generation complete. Total houses:', houses.length);
        
        showLoading(false);
        showNotification('Masterplan generated with ' + stats.homeCount + ' houses!', 'success');
        updateStats();
    }, 1000);
}
