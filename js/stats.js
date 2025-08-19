// js/stats.js - Statistics calculation and display
import { GeometryUtils } from './geometry.js';

export class StatsManager {
    constructor() {
        this.currentStats = {
            totalArea: 0,
            homeCount: 0,
            density: 0
        };
    }
    
    updateStats(siteBoundary, houses) {
        try {
            // Calculate total area
            this.currentStats.totalArea = siteBoundary ? 
                GeometryUtils.polygonArea(siteBoundary) : 0;
            
            // Count houses
            this.currentStats.homeCount = houses ? houses.length : 0;
            
            // Calculate density (homes per hectare)
            this.currentStats.density = this.calculateDensity(
                this.currentStats.homeCount, 
                this.currentStats.totalArea
            );
            
            // Update UI
            this.updateUI();
            
            console.log('📊 Stats updated:', this.currentStats);
        } catch (error) {
            console.error('❌ Error updating stats:', error);
        }
    }
    
    calculateDensity(homeCount, areaInSquareMeters) {
        if (areaInSquareMeters <= 0) return 0;
        
        // Convert square meters to hectares
        const areaInHectares = areaInSquareMeters / 10000;
        
        // Calculate homes per hectare
        return Math.round((homeCount / areaInHectares) * 100) / 100;
    }
    
    updateUI() {
        try {
            // Update total area
            const areaElement = document.getElementById('total-area');
            if (areaElement) {
                const areaInHectares = this.currentStats.totalArea / 10000;
                areaElement.textContent = `${Math.round(areaInHectares * 100) / 100} ha`;
            }
            
            // Update home count
            const homeCountElement = document.getElementById('home-count');
            if (homeCountElement) {
                homeCountElement.textContent = this.currentStats.homeCount.toString();
            }
            
            // Update density
            const densityElement = document.getElementById('density');
            if (densityElement) {
                densityElement.textContent = `${this.currentStats.density} homes/ha`;
            }
            
        } catch (error) {
            console.error('❌ Error updating stats UI:', error);
        }
    }
    
    getStats() {
        return { ...this.currentStats };
    }
    
    getTotalAreaHectares() {
        return this.currentStats.totalArea / 10000;
    }
    
    getTotalAreaSquareMeters() {
        return this.currentStats.totalArea;
    }
    
    getHomeCount() {
        return this.currentStats.homeCount;
    }
    
    getDensity() {
        return this.currentStats.density;
    }
    
    // Generate detailed statistics report
    generateDetailedStats(siteBoundary, houses, spines) {
        try {
            const stats = {
                site: {
                    area: {
                        squareMeters: this.currentStats.totalArea,
                        hectares: this.getTotalAreaHectares(),
                        acres: this.getTotalAreaHectares() * 2.471 // Convert to acres
                    },
                    perimeter: siteBoundary ? this.calculatePerimeter(siteBoundary) : 0
                },
                housing: {
                    total: this.currentStats.homeCount,
                    density: {
                        homesPerHectare: this.currentStats.density,
                        homesPerAcre: this.currentStats.density / 2.471
                    },
                    byType: this.categorizeHousesByType(houses),
                    averageSize: this.calculateAverageHouseSize(houses)
                },
                infrastructure: {
                    spineRoads: spines ? spines.length : 0,
                    totalRoadLength: this.calculateTotalRoadLength(spines),
                    roadCoverage: this.calculateRoadCoveragePercentage(spines, this.currentStats.totalArea)
                },
                efficiency: {
                    developableArea: this.calculateDevelopableArea(siteBoundary, spines),
                    developmentEfficiency: this.calculateDevelopmentEfficiency(houses, siteBoundary)
                }
            };
            
            return stats;
        } catch (error) {
            console.error('❌ Error generating detailed stats:', error);
            return null;
        }
    }
    
    calculatePerimeter(polygon) {
        try {
            const coords = polygon.geometry.coordinates[0];
            let perimeter = 0;
            
            for (let i = 0; i < coords.length - 1; i++) {
                const current = coords[i];
                const next = coords[(i + 1) % (coords.length - 1)];
                perimeter += GeometryUtils.distance(current, next);
            }
            
            return perimeter;
        } catch (error) {
            console.error('❌ Error calculating perimeter:', error);
            return 0;
        }
    }
    
    categorizeHousesByType(houses) {
        const categories = {
            small: 0,
            medium: 0,
            large: 0
        };
        
        if (houses) {
            houses.forEach(house => {
                const type = house.properties?.type || 'medium';
                if (categories.hasOwnProperty(type)) {
                    categories[type]++;
                }
            });
        }
        
        return categories;
    }
    
    calculateAverageHouseSize(houses) {
        if (!houses || houses.length === 0) return 0;
        
        const totalArea = houses.reduce((sum, house) => {
            return sum + (house.properties?.area || 0);
        }, 0);
        
        return Math.round((totalArea / houses.length) * 100) / 100;
    }
    
    calculateTotalRoadLength(spines) {
        if (!spines || spines.length === 0) return 0;
        
        let totalLength = 0;
        spines.forEach(spine => {
            if (spine.properties?.centerLine) {
                const coords = spine.properties.centerLine.geometry.coordinates;
                totalLength += GeometryUtils.distance(coords[0], coords[1]);
            }
        });
        
        return totalLength;
    }
    
    calculateRoadCoveragePercentage(spines, totalSiteArea) {
        if (!spines || spines.length === 0 || totalSiteArea <= 0) return 0;
        
        let totalRoadArea = 0;
        spines.forEach(spine => {
            if (spine.properties?.width) {
                const length = spine.properties.centerLine ? 
                    GeometryUtils.distance(
                        spine.properties.centerLine.geometry.coordinates[0],
                        spine.properties.centerLine.geometry.coordinates[1]
                    ) : 0;
                totalRoadArea += length * spine.properties.width;
            }
        });
        
        return Math.round((totalRoadArea / totalSiteArea) * 10000) / 100; // Percentage
    }
    
    calculateDevelopableArea(siteBoundary, spines) {
        if (!siteBoundary) return 0;
        
        // Start with total site area
        let developableArea = GeometryUtils.polygonArea(siteBoundary);
        
        // Subtract road areas
        if (spines) {
            spines.forEach(spine => {
                if (spine.properties?.width) {
                    const length = spine.properties.centerLine ? 
                        GeometryUtils.distance(
                            spine.properties.centerLine.geometry.coordinates[0],
                            spine.properties.centerLine.geometry.coordinates[1]
                        ) : 0;
                    developableArea -= length * spine.properties.width;
                }
            });
        }
        
        return Math.max(0, developableArea);
    }
    
    calculateDevelopmentEfficiency(houses, siteBoundary) {
        if (!houses || houses.length === 0 || !siteBoundary) return 0;
        
        const totalSiteArea = GeometryUtils.polygonArea(siteBoundary);
        const totalHouseArea = houses.reduce((sum, house) => {
            return sum + (house.properties?.area || 0);
        }, 0);
        
        return Math.round((totalHouseArea / totalSiteArea) * 10000) / 100; // Percentage
    }
    
    // Export stats to various formats
    exportStatsToCSV(detailedStats) {
        try {
            const csvData = [
                ['Metric', 'Value', 'Unit'],
                ['Site Area (Hectares)', detailedStats.site.area.hectares, 'ha'],
                ['Site Area (Square Meters)', detailedStats.site.area.squareMeters, 'm²'],
                ['Site Perimeter', detailedStats.site.perimeter, 'm'],
                ['Total Homes', detailedStats.housing.total, 'units'],
                ['Density', detailedStats.housing.density.homesPerHectare, 'homes/ha'],
                ['Small Houses', detailedStats.housing.byType.small, 'units'],
                ['Medium Houses', detailedStats.housing.byType.medium, 'units'],
                ['Large Houses', detailedStats.housing.byType.large, 'units'],
                ['Average House Size', detailedStats.housing.averageSize, 'm²'],
                ['Number of Spine Roads', detailedStats.infrastructure.spineRoads, 'units'],
                ['Total Road Length', detailedStats.infrastructure.totalRoadLength, 'm'],
                ['Road Coverage', detailedStats.infrastructure.roadCoverage, '%'],
                ['Developable Area', detailedStats.efficiency.developableArea, 'm²'],
                ['Development Efficiency', detailedStats.efficiency.developmentEfficiency, '%']
            ];
            
            return csvData.map(row => row.join(',')).join('\n');
        } catch (error) {
            console.error('❌ Error exporting stats to CSV:', error);
            return null;
        }
    }
    
    exportStatsToJSON(detailedStats) {
        try {
            return JSON.stringify(detailedStats, null, 2);
        } catch (error) {
            console.error('❌ Error exporting stats to JSON:', error);
            return null;
        }
    }
    
    // Generate summary report text
    generateSummaryReport(detailedStats) {
        try {
            const report = `
MASTERPLAN STATISTICS REPORT
============================

SITE INFORMATION
- Total Area: ${detailedStats.site.area.hectares} hectares (${detailedStats.site.area.squareMeters} m²)
- Perimeter: ${Math.round(detailedStats.site.perimeter)} meters

HOUSING DEVELOPMENT
- Total Homes: ${detailedStats.housing.total} units
- Density: ${detailedStats.housing.density.homesPerHectare} homes per hectare
- House Distribution:
  * Small Houses: ${detailedStats.housing.byType.small} units
  * Medium Houses: ${detailedStats.housing.byType.medium} units
  * Large Houses: ${detailedStats.housing.byType.large} units
- Average House Size: ${detailedStats.housing.averageSize} m²

INFRASTRUCTURE
- Spine Roads: ${detailedStats.infrastructure.spineRoads} roads
- Total Road Length: ${Math.round(detailedStats.infrastructure.totalRoadLength)} meters
- Road Coverage: ${detailedStats.infrastructure.roadCoverage}% of site area

EFFICIENCY METRICS
- Developable Area: ${Math.round(detailedStats.efficiency.developableArea)} m²
- Development Efficiency: ${detailedStats.efficiency.developmentEfficiency}% of site used for housing

Generated on: ${new Date().toLocaleString()}
            `.trim();
            
            return report;
        } catch (error) {
            console.error('❌ Error generating summary report:', error);
            return 'Error generating report';
        }
    }
    
    // Reset all stats
    reset() {
        this.currentStats = {
            totalArea: 0,
            homeCount: 0,
            density: 0
        };
        this.updateUI();
    }
}
