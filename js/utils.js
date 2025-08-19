// js/utils.js - Utility functions and helpers

export class Utils {
    
    // Format numbers for display
    static formatNumber(number, decimals = 2) {
        if (isNaN(number)) return '0';
        return Number(number).toFixed(decimals);
    }
    
    // Format area for display
    static formatArea(areaInSquareMeters, unit = 'ha') {
        switch (unit) {
            case 'ha':
                return `${this.formatNumber(areaInSquareMeters / 10000)} ha`;
            case 'm²':
                return `${this.formatNumber(areaInSquareMeters)} m²`;
            case 'acres':
                return `${this.formatNumber(areaInSquareMeters / 4047)} acres`;
            default:
                return `${this.formatNumber(areaInSquareMeters)} m²`;
        }
    }
    
    // Format distance for display
    static formatDistance(distanceInMeters, unit = 'm') {
        switch (unit) {
            case 'km':
                return `${this.formatNumber(distanceInMeters / 1000)} km`;
            case 'ft':
                return `${this.formatNumber(distanceInMeters * 3.28084)} ft`;
            default:
                return `${this.formatNumber(distanceInMeters)} m`;
        }
    }
    
    // Generate unique ID
    static generateId(prefix = 'id') {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // Debounce function
    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    // Throttle function
    static throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
    
    // Download data as file
    static downloadFile(data, filename, type = 'text/plain') {
        try {
            const blob = new Blob([data], { type });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            
            console.log(`✅ File downloaded: ${filename}`);
        } catch (error) {
            console.error('❌ Error downloading file:', error);
        }
    }
    
    // Copy text to clipboard
    static async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            console.log('✅ Text copied to clipboard');
            return true;
        } catch (error) {
            console.error('❌ Error copying to clipboard:', error);
            return false;
        }
    }
    
    // Validate coordinates
    static isValidCoordinate(coord) {
        return Array.isArray(coord) && 
               coord.length === 2 && 
               typeof coord[0] === 'number' && 
               typeof coord[1] === 'number' &&
               !isNaN(coord[0]) && 
               !isNaN(coord[1]);
    }
    
    // Validate GeoJSON feature
    static isValidGeoJSONFeature(feature) {
        return feature &&
               typeof feature === 'object' &&
               feature.type === 'Feature' &&
               feature.geometry &&
               feature.geometry.type &&
               feature.geometry.coordinates &&
               Array.isArray(feature.geometry.coordinates);
    }
    
    // Get feature bounds
    static getFeatureBounds(feature) {
        try {
            let coords = [];
            
            if (feature.geometry.type === 'Polygon') {
                coords = feature.geometry.coordinates[0];
            } else if (feature.geometry.type === 'LineString') {
                coords = feature.geometry.coordinates;
            } else if (feature.geometry.type === 'Point') {
                coords = [feature.geometry.coordinates];
            }
            
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            
            coords.forEach(coord => {
                minX = Math.min(minX, coord[0]);
                maxX = Math.max(maxX, coord[0]);
                minY = Math.min(minY, coord[1]);
                maxY = Math.max(maxY, coord[1]);
            });
            
            return [minX, minY, maxX, maxY];
        } catch (error) {
            console.error('❌ Error getting feature bounds:', error);
            return null;
        }
    }
    
    // Convert color formats
    static hexToRgba(hex, alpha = 1) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16),
            a: alpha
        } : null;
    }
    
    // Get contrasting text color
    static getContrastColor(hexColor) {
        const rgb = this.hexToRgba(hexColor);
        if (!rgb) return '#000000';
        
        const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
        return brightness > 128 ? '#000000' : '#ffffff';
    }
    
    // Deep clone object
    static deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (obj instanceof Array) return obj.map(item => this.deepClone(item));
        if (typeof obj === 'object') {
            const cloned = {};
            Object.keys(obj).forEach(key => {
                cloned[key] = this.deepClone(obj[key]);
            });
            return cloned;
        }
    }
    
    // Check if browser supports required features
    static checkBrowserSupport() {
        const support = {
            webgl: !!window.WebGLRenderingContext,
            geolocation: !!navigator.geolocation,
            clipboard: !!navigator.clipboard,
            localStorage: !!window.localStorage,
            es6Modules: 'noModule' in HTMLScriptElement.prototype
        };
        
        const hasMinimumSupport = support.webgl && support.es6Modules;
        
        if (!hasMinimumSupport) {
            console.warn('⚠️ Browser may not fully support all features');
        }
        
        return support;
    }
    
    // Performance measurement
    static measurePerformance(name, func) {
        const start = performance.now();
        const result = func();
        const end = performance.now();
        
        console.log(`⏱️ ${name} took ${(end - start).toFixed(2)} milliseconds`);
        return result;
    }
    
    // Async performance measurement
    static async measureAsyncPerformance(name, asyncFunc) {
        const start = performance.now();
        const result = await asyncFunc();
        const end = performance.now();
        
        console.log(`⏱️ ${name} took ${(end - start).toFixed(2)} milliseconds`);
        return result;
    }
    
    // Local storage with error handling
    static setLocalStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('❌ Error setting localStorage:', error);
            return false;
        }
    }
    
    static getLocalStorage(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (error) {
            console.error('❌ Error getting localStorage:', error);
            return defaultValue;
        }
    }
    
    // URL parameter helpers
    static getUrlParameter(name) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(name);
    }
    
    static setUrlParameter(name, value) {
        const url = new URL(window.location);
        url.searchParams.set(name, value);
        window.history.pushState({}, '', url);
    }
    
    // Loading state management
    static showLoading(element, message = 'Loading...') {
        if (typeof element === 'string') {
            element = document.getElementById(element);
        }
        
        if (element) {
            element.innerHTML = `
                <div class="loading-indicator">
                    <div class="spinner"></div>
                    <div class="loading-message">${message}</div>
                </div>
            `;
            element.style.display = 'flex';
        }
    }
    
    static hideLoading(element) {
        if (typeof element === 'string') {
            element = document.getElementById(element);
        }
        
        if (element) {
            element.style.display = 'none';
            element.innerHTML = '';
        }
    }
}
