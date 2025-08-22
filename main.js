// main.js — Site boundary + 80m editable grid with 8m roads (centerline + polygons)

class MasterplanningTool {
  constructor() {
    this.map = null;
    this.draw = null;
    this.siteBoundary = null;

    // Grid state (centerlines) and road polygons
    this.gridData = { type: 'FeatureCollection', features: [] };

    // Grid parameters (Phase 1)
    this.gridPitchX = 80;   // meters between vertical columns
    this.gridPitchY = 80;   // meters between horizontal rows
    this.gridAngleRowDeg = 0; // rotation for ROW segments (east–west)
    this.gridAngleColDeg = 0; // rotation for COLUMN segments (north–south)
    this.roadWidth = 6;     // meters (full road width)

    // Grid nudging (meters)
    this.gridOffset = { x: 0, y: 0 }; // +x east/west, +y south/north
    this.nudgeStep = 1; // meters per click

    // Undo stack for deleted grid segments
    this.undoStack = [];
    this.mode = 'delete'; // 'delete' | 'select'
    this.clipboard = null;
    this.siteName = localStorage.getItem('siteName') || 'Create Site';

    this.mapboxToken = window.MAPBOX_TOKEN ||
      'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
    this.mapboxStyle = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n';

    this.phase = 1; // 1 = Plot Site, 2 = Grid
  this._activationMarker = null; // DOM marker for "Save Boundary"
    this.init();
  }

  async init() {
    await this.initializeMap();
    this.initializeDraw();
    this.setupEventListeners();
    this.startDrawing();
  }

  async initializeMap() {
    mapboxgl.accessToken = this.mapboxToken;

    const saved = this.getSavedMapLocation() || {
      center: [-0.1278, 51.5074],
      zoom: 15,
      pitch: 0,
      bearing: 0
    };

    this.map = new mapboxgl.Map({
      container: 'map',
      style: this.mapboxStyle,
      center: saved.center,
      zoom: saved.zoom,
      pitch: saved.pitch,
      bearing: saved.bearing,
    });

    return new Promise((resolve) => {
      this.map.on('load', () => {
        this.setupMapControls();
        this.setupPerimeterLayers();
        this.setupGridLayers();
        this.setupRoadSurfaceLayers(); // 8m polygons
        this.setupHousingLayers();

        // Build phase panels (left Plot, right Grid)
        this.injectPhasePanels();
        const rightPanelWrap = document.querySelector('.draw-panel');
        if (rightPanelWrap) rightPanelWrap.style.display = 'none';

        // Geocoder (expects #geocoder in index.html)
        const geocoder = new MapboxGeocoder({
          accessToken: this.mapboxToken,
          mapboxgl: mapboxgl,
          marker: false,
          placeholder: "Search locations"
        });
        const geoMount = document.getElementById('geocoder');
        if (geoMount) geoMount.appendChild(geocoder.onAdd(this.map));
        geocoder.on('result', (e) => this.map.flyTo({ center: e.result.center, zoom: 15 }));

        resolve();
      });

      this.map.on('moveend', () => this.saveMapLocation());
    });
  }

  setupMapControls() {
    this.map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
    this.map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');
  }

  // -------- Layers
  setupPerimeterLayers() {
    if (!this.map.getSource('site-perimeter')) {
      this.map.addSource('site-perimeter', { type: 'geojson', data: this.emptyFC() });
    }
    if (!this.map.getLayer('site-perimeter-fill')) {
      this.map.addLayer({
        id: 'site-perimeter-fill',
        type: 'fill',
        source: 'site-perimeter',
        paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.12 }
      });
    }
    if (!this.map.getLayer('site-perimeter-line')) {
      this.map.addLayer({
        id: 'site-perimeter-line',
        type: 'line',
        source: 'site-perimeter',
        paint: { 'line-color': '#16a34a', 'line-width': 4, 'line-opacity': 0.9 }
      });
    }
  }

  setupGridLayers() {
    if (!this.map.getSource('grid-roads')) {
      this.map.addSource('grid-roads', { type: 'geojson', data: this.gridData });
    }
    if (!this.map.getLayer('grid-roads')) {
      this.map.addLayer({
        id: 'grid-roads',
        type: 'line',
        source: 'grid-roads',
        paint: { 'line-color': '#1d4ed8', 'line-width': 2.5, 'line-opacity': 1.0 } // visible while editing
      });
    }

    // UX + delete centerline on click
    this.map.on('mouseenter', 'grid-roads', () => this.map.getCanvas().style.cursor = 'pointer');
    this.map.on('mouseleave', 'grid-roads', () => this.map.getCanvas().style.cursor = '');
    this.map.on('click', 'grid-roads', (e) => {
      if (!e.features?.length) return;
      const hit = e.features[0];
      if (this.mode === 'select') {
        this._lastHitFeature = hit;        // store selection (for Copy button)
        this.clipboard = JSON.parse(JSON.stringify(hit)); // also set clipboard immediately
        if (typeof this._refreshEditToolbar === 'function') this._refreshEditToolbar();
      } else {
        this.removeGridSegment(e);
        if (typeof this._refreshEditToolbar === 'function') this._refreshEditToolbar();
      }
    });
  }

  setupRoadSurfaceLayers() {
    if (!this.map.getSource('road-surfaces')) {
      this.map.addSource('road-surfaces', { type: 'geojson', data: this.emptyFC() });
    }
    if (!this.map.getLayer('road-surfaces')) {
      this.map.addLayer({
        id: 'road-surfaces',
        type: 'fill',
        source: 'road-surfaces',
        paint: { 'fill-color': '#8a8f99', 'fill-opacity': 0.6 }
      });
    }

    // Optional: delete via polygon click (maps back to its centerline by _srcId)
    this.map.on('mouseenter', 'road-surfaces', () => this.map.getCanvas().style.cursor = 'pointer');
    this.map.on('mouseleave', 'road-surfaces', () => this.map.getCanvas().style.cursor = '');
    this.map.on('click', 'road-surfaces', (e) => {
      if (!e.features?.length) return;
      const f = e.features[0];
      const srcId = f.properties?._srcId;
      if (this.mode === 'select') {
        // convert surface back to its centerline by looking up srcId in gridData
        const line = this.gridData.features.find(g => g.properties?._id === srcId);
        if (line) {
          this._lastHitFeature = line;
          this.clipboard = JSON.parse(JSON.stringify(line));
        }
        if (typeof this._refreshEditToolbar === 'function') this._refreshEditToolbar();
        return;
      }

      // delete mode (original behavior)
      if (!srcId) return;
      const idx = this.gridData.features.findIndex(g => g.properties?._id === srcId);
      if (idx >= 0) {
        this.undoStack.push(this.gridData.features[idx]);
        this.gridData.features.splice(idx, 1);
        this.map.getSource('grid-roads')?.setData(this.gridData);
        this.updateRoadSurfacesFromGrid(this.roadWidth);
        this.updateRoadEndNodes();
        if (typeof this._refreshEditToolbar === 'function') this._refreshEditToolbar();
      }
    });
  }

    // -------- Draw site
  initializeDraw() {
    this.draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: false, trash: false } });
    this.map.addControl(this.draw);

    this.map.on('draw.create', (e) => {
      const feat = e.features?.[0];
      if (!feat || feat.geometry.type !== 'Polygon') return;

      this.siteBoundary = feat;
      this.refreshPerimeter();
      this.calculateAndDisplayArea(this.siteBoundary);
      // Show activation circle instead of advancing phase and grid immediately
      this.showGridActivationCircle();

      // Finish draw mode & tidy UI
      this.draw.deleteAll();
      this.draw.changeMode('simple_select');
      this.map.getCanvas().style.cursor = '';
      document.getElementById('draw-polygon')?.classList.remove('active');
    });

    this.map.on('draw.modechange', (e) => {
      if (e.mode === 'draw_polygon') {
        this.map.getCanvas().style.cursor = 'crosshair';
      } else {
        this.map.getCanvas().style.cursor = '';
      }
    });
  }

  setupEventListeners() {

    // Optional: nudge buttons in UI if present
    const nLeft  = document.getElementById('nudge-left');
    const nRight = document.getElementById('nudge-right');
    const nUp    = document.getElementById('nudge-up');
    const nDown  = document.getElementById('nudge-down');

    nLeft?.addEventListener('click',  () => this.nudgeGrid(-this.nudgeStep, 0));
    nRight?.addEventListener('click', () => this.nudgeGrid( this.nudgeStep, 0));
    nUp?.addEventListener('click',    () => this.nudgeGrid(0, -this.nudgeStep));
    nDown?.addEventListener('click',  () => this.nudgeGrid(0,  this.nudgeStep));

    // Keyboard: Alt + Arrow keys to nudge
    document.addEventListener('keydown', (e) => {
      if (!this.siteBoundary) return;
      if (!e.altKey) return; // use Alt as a modifier to avoid conflicts
      if (e.key === 'ArrowLeft')  { e.preventDefault(); this.nudgeGrid(-this.nudgeStep, 0); }
      if (e.key === 'ArrowRight') { e.preventDefault(); this.nudgeGrid( this.nudgeStep, 0); }
      if (e.key === 'ArrowUp')    { e.preventDefault(); this.nudgeGrid(0, -this.nudgeStep); }
      if (e.key === 'ArrowDown')  { e.preventDefault(); this.nudgeGrid(0,  this.nudgeStep); }
    });

    // Ctrl+Z undo last deletion
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.undoDelete();
      }
      // Paste (Ctrl/Cmd + V)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        this.pasteFromClipboard();
        return;
      }
    });

    // Only keep navbar site name and tweakPanelLabels
    this.ensureNavbarSiteName();
    // Apply requested label changes
    this.tweakPanelLabels();
  }

  startDrawing() {
    this.setPhase(1);
    this.removeGridActivationCircle();
    this.draw.deleteAll();
    this.updateAreaDisplay(0);

    this.siteBoundary = null;
    this.refreshPerimeter();

    // clear all grid + surfaces
    this.gridData = this.emptyFC();
    this.map.getSource('grid-roads')?.setData(this.gridData);
    this.map.getSource('road-surfaces')?.setData(this.emptyFC());

    document.getElementById('draw-polygon')?.classList.add('active');
    this.draw.changeMode('draw_polygon');
    this.map.getCanvas().style.cursor = 'crosshair';
  }

  clearAll() {
    this.draw.deleteAll();
    this.siteBoundary = null;
    this.refreshPerimeter();
    this.updateAreaDisplay(0);
    this.draw.changeMode('simple_select');

    this.removeGridActivationCircle();
    // clear grid + surfaces
    this.gridData = this.emptyFC();
    this.map.getSource('grid-roads')?.setData(this.gridData);
    this.map.getSource('road-surfaces')?.setData(this.emptyFC());

    document.getElementById('draw-polygon')?.classList.remove('active');
    this.map.getCanvas().style.cursor = '';
    this.setPhase(1);
  }

  // -------- Perimeter & area
  refreshPerimeter() {
    this.map.getSource('site-perimeter')?.setData(this.siteBoundary ? this.fc([this.siteBoundary]) : this.emptyFC());
  }

  calculateAndDisplayArea(feature) {
    try {
      const areaHa = turf.area(feature) / 10000;
      this.updateAreaDisplay(areaHa);
    } catch { this.updateAreaDisplay(0); }
  }

  updateAreaDisplay(area) {
    const el = document.getElementById('site-area');
    if (el) el.textContent = `${area.toFixed(2)} ha`;
  }

  // Clip a line to the polygon, returning the inside portion (or null)
  clipLineInside(line, polygon) {
    const boundary = turf.polygonToLine(polygon);
    try { if (turf.booleanWithin(line, polygon)) return line; } catch {}
    try { if (!turf.booleanIntersects(line, polygon)) return null; } catch {}
    let parts;
    try { parts = turf.lineSplit(line, boundary); } catch { parts = { type: 'FeatureCollection', features: [line] }; }
    for (const f of (parts.features || [])) {
      const cs = f.geometry.coordinates; if (!cs || cs.length < 2) continue;
      const mid = turf.midpoint(turf.point(cs[0]), turf.point(cs[cs.length - 1]));
      if (turf.booleanPointInPolygon(mid, polygon)) return f;
    }
    return null;
  }

  // Build an orthogonal grid, then rotate ROWS and COLUMNS independently, clip, and split only at true intersections
  generateAxisRotatedGrid(pitchX = 80, pitchY = 80, rowAngleDeg = 0, colAngleDeg = 0) {
    if (!this.siteBoundary) return;
    const polygon = this.siteBoundary;
    const pivot = turf.centroid(polygon).geometry.coordinates;

    // Anchor grid at NE of bbox, then apply offset (in current map frame)
    const bbox = turf.bbox(polygon);
    const NE = [bbox[2], bbox[3]];
    let anchor = turf.point(NE);
    if (this.gridOffset?.x) anchor = turf.destination(anchor, this.gridOffset.x, 90,  { units: 'meters' });
    if (this.gridOffset?.y) anchor = turf.destination(anchor, this.gridOffset.y, 180, { units: 'meters' });

    // Build lattice nodes with independent X/Y pitches
    const nodes = this.buildGridNodesXY(anchor.geometry.coordinates, bbox, pitchX, pitchY);

    // Build one long line per row and per column (axis-aligned in current frame)
    const { rowLines, colLines } = this._buildLongAxisLines(nodes);

    // Rotate rows and columns independently around the site centroid
    const rotRows = rowLines.map(ls => turf.transformRotate(ls, rowAngleDeg, { pivot }));
    const rotCols = colLines.map(ls => turf.transformRotate(ls, colAngleDeg, { pivot }));

    // Clip rotated lines to polygon, keeping only interior pieces
    const insideRows = rotRows.flatMap(ls => this._keepInteriorPieces(ls, polygon));
    const insideCols = rotCols.flatMap(ls => this._keepInteriorPieces(ls, polygon));

    // Split only at crossings so all endpoints coincide at junctions
    const splitPieces = this._splitAtRowColIntersections(insideRows, insideCols);

    this.gridData = { type: 'FeatureCollection', features: splitPieces };
    this.map.getSource('grid-roads')?.setData(this.gridData);
    this.updateRoadSurfacesFromGrid(this.roadWidth);
  }
  // Build lattice padded beyond bbox with separate pitches and safety cap
  buildGridNodesXY(neCorner, bbox, pitchX, pitchY) {
    const MAX_NODES = 1600;

    const NEpt = turf.point(neCorner);
    const southEdge = turf.point([neCorner[0], bbox[1]]);
    const westEdge  = turf.point([bbox[0], neCorner[1]]);
    const southDistM = turf.distance(NEpt, southEdge, { units: 'kilometers' }) * 1000;
    const westDistM  = turf.distance(NEpt, westEdge,  { units: 'kilometers' }) * 1000;

    let pX = Math.max(1, pitchX);
    let pY = Math.max(1, pitchY);
    const padX = pX, padY = pY;

    const estimate = () => {
      const rows = Math.floor((southDistM + padY) / pY) + 1; // southward count
      const cols = Math.floor((westDistM  + padX) / pX) + 1; // westward count
      return { rows: Math.max(1, rows), cols: Math.max(1, cols) };
    };

    let { rows, cols } = estimate();
    if (rows * cols > MAX_NODES) {
      const scale = Math.sqrt((rows * cols) / MAX_NODES);
      pX *= scale; pY *= scale;
      ({ rows, cols } = estimate());
      console.warn(`⚠️ Grid too dense. Auto-increased pitches to ~${pX.toFixed(1)}m / ${pY.toFixed(1)}m (rows=${rows}, cols=${cols})`);
    }

    const nodes = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      const rowStart = turf.destination(NEpt, r * pY, 180, { units: 'meters' }); // move south per row
      for (let c = 0; c < cols; c++) {
        const pt = turf.destination(rowStart, c * pX, -90, { units: 'meters' }); // move west per column
        row.push(pt.geometry.coordinates);
      }
      nodes.push(row);
    }
    return nodes;
  }

  // ---- UI label tweaks
  tweakPanelLabels() {
    // Phase 1 lives solely in the left panel; right panel is reserved for Grid.
    // Intentionally no DOM mutations here.
  }

  // Undo last deleted segment
  undoDelete() {
    const last = this.undoStack.pop();
    if (!last) return;
    this.gridData.features.push(last);
    this.map.getSource('grid-roads')?.setData(this.gridData);
    this.updateRoadSurfacesFromGrid(this.roadWidth);
  }

  // Build node-to-node segments (each row & column) clipped to polygon; no distance slicing.
  buildNodeSegments(nodes, polygon) {
    const feats = [];
    if (!nodes?.length) return feats;
    const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const boundary = turf.polygonToLine(polygon);

    // helper: clip [a,b] to inside of polygon; returns a single inside piece or null
    const clipAB = (a, b) => {
      const line = turf.lineString([a, b]);
      // if the whole segment is inside, keep as-is
      if (turf.booleanWithin(line, polygon)) return line;
      // if it doesn't even touch, drop
      if (!turf.booleanIntersects(line, polygon)) return null;
      // otherwise split by the boundary and pick the inside portion(s)
      let pieces;
      try { pieces = turf.lineSplit(line, boundary); }
      catch { pieces = { type: 'FeatureCollection', features: [line] }; }
      // choose the piece whose midpoint lies inside the polygon
      for (const f of pieces.features || []) {
        const cs = f.geometry.coordinates;
        if (!cs || cs.length < 2) continue;
        const mid = turf.midpoint(turf.point(cs[0]), turf.point(cs[cs.length - 1]));
        if (turf.booleanPointInPolygon(mid, polygon)) return f;
      }
      return null;
    };

    // rows (east↔west)
    nodes.forEach(row => {
      for (let i = 0; i < row.length - 1; i++) {
        const a = row[i];
        const b = row[i + 1];
        const clipped = clipAB(a, b);
        if (!clipped) continue;
        clipped.properties = { _id: uid(), axis: 'row' };
        feats.push(clipped);
      }
    });

    // columns (north↔south)
    const maxCols = Math.max(...nodes.map(r => r.length));
    for (let c = 0; c < maxCols; c++) {
      // collect column nodes (north→south)
      const col = [];
      for (let r = 0; r < nodes.length; r++) if (nodes[r][c]) col.push(nodes[r][c]);
      for (let j = 0; j < col.length - 1; j++) {
        const a = col[j];
        const b = col[j + 1];
        const clipped = clipAB(a, b);
        if (!clipped) continue;
        clipped.properties = { _id: uid(), axis: 'col' };
        feats.push(clipped);
      }
    }

    // de-duplicate identical geometries
    const map = new Map();
    feats.forEach(f => {
      const k = JSON.stringify(f.geometry.coordinates);
      if (!map.has(k)) map.set(k, f);
    });
    return Array.from(map.values());
  }

  // Build a lattice padded one pitch beyond bbox, but with bounded node count.
  buildGridNodes(neCorner, bbox, pitchMeters) {
    // Build a lattice padded one pitch beyond bbox, but with bounded node count.
    const MAX_NODES = 1600; // safety cap for rows*cols (tune if needed)

    // Compute distances south and west from the NE corner to bbox edges (in meters)
    const NEpt = turf.point(neCorner);
    const southEdge = turf.point([neCorner[0], bbox[1]]);
    const westEdge  = turf.point([bbox[0], neCorner[1]]);
    const southDistM = turf.distance(NEpt, southEdge, { units: 'kilometers' }) * 1000;
    const westDistM  = turf.distance(NEpt, westEdge,  { units: 'kilometers' }) * 1000;

    // Start with requested pitch, but adapt if too many nodes
    let pitch = pitchMeters;
    const pad = pitch; // one extra cell beyond bbox on S/W

    const estimateCounts = (p) => {
      const rows = Math.floor((southDistM + pad) / p) + 1;
      const cols = Math.floor((westDistM  + pad) / p) + 1;
      return { rows: Math.max(1, rows), cols: Math.max(1, cols) };
    };

    let { rows, cols } = estimateCounts(pitch);
    // If too dense, scale pitch up proportionally to bring rows*cols under cap
    if (rows * cols > MAX_NODES) {
      const scale = Math.sqrt((rows * cols) / MAX_NODES);
      pitch = pitch * scale;
      ({ rows, cols } = estimateCounts(pitch));
      console.warn(`⚠️ Grid too dense. Auto-increased pitch to ~${pitch.toFixed(1)}m (rows=${rows}, cols=${cols})`);
    }

    // Build rows (march south), then within each row march west
    const nodes = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      // row start = NE moved south by r*pitch
      const rowStart = turf.destination(NEpt, r * pitch, 180, { units: 'meters' });
      for (let c = 0; c < cols; c++) {
        // each node = rowStart moved west by c*pitch
        const pt = turf.destination(rowStart, c * pitch, -90, { units: 'meters' });
        row.push(pt.geometry.coordinates);
      }
      nodes.push(row);
    }

    return nodes;
  }

  // Convert the lattice of nodes into line strings for rows (E–W) and columns (N–S)
  buildLinesFromNodes(nodes) {
    const rowLines = [];
    const colLines = [];

    // Rows: each row is already ordered east→west
    nodes.forEach(row => { if (row.length >= 2) rowLines.push(turf.lineString(row)); });

    // Columns: traverse rows to collect each column's nodes (north→south)
    const maxCols = Math.max(...nodes.map(r => r.length));
    for (let c = 0; c < maxCols; c++) {
      const col = [];
      for (let r = 0; r < nodes.length; r++) {
        if (nodes[r][c]) col.push(nodes[r][c]);
      }
      if (col.length >= 2) colLines.push(turf.lineString(col));
    }

    return { rowLines, colLines };
  }

  // Split a long line by polygon boundary, keep only inside pieces, then chop to ~pitch-length segments
  clipLineToPolygonIntoSegments(line, polygon, targetSegMeters = 80) {
    const boundary = turf.polygonToLine(polygon);
    let split;
    try { split = turf.lineSplit(line, boundary); }
    catch { split = { type:'FeatureCollection', features:[line] }; }

    const parts = (split.features?.length ? split.features : [line]);
    const keep = [];

    parts.forEach(ls => {
      const lenKm = turf.length(ls, { units: 'kilometers' });
      if (lenKm <= 0) return;
      const mid = turf.along(ls, lenKm/2, { units: 'kilometers' });
      if (turf.booleanPointInPolygon(mid, polygon)) {
        keep.push(...this.segmentize(ls, targetSegMeters));
      }
    });
    return keep;
  }

  // Chop a LineString into ~L-meter chunks using lineSliceAlong
  segmentize(line, targetMeters = 80) {
    const totalM = turf.length(line, { units:'kilometers' }) * 1000;
    if (totalM <= targetMeters) return [line];

    const n = Math.max(1, Math.round(totalM / targetMeters));
    const segs = [];
    const stepKm = (totalM / n) / 1000;

    let start = 0;
    for (let i = 0; i < n; i++) {
      const end = (i === n-1) ? totalM/1000 : start + stepKm;
      const seg = turf.lineSliceAlong(line, start, end, { units:'kilometers' });
      segs.push(seg);
      start = end;
    }
    return segs;
  }

  // --- Snap a segment’s endpoints to the nearest lattice nodes
  snapLineToGridNodes(line, nodes, tolMeters = 5) {
    if (!nodes?.length) return line;
    const snapPt = (pt) => this.findNearestNode(pt, nodes, tolMeters) || pt;
    const cs = line.geometry.coordinates;
    const snapped = [snapPt(cs[0]), snapPt(cs[cs.length - 1])];
    return turf.lineString(snapped, line.properties || {});
  }

  findNearestNode(pt, nodes, tolMeters) {
    let best = null, bestDist = Infinity;
    const p = turf.point(pt);
    for (let r = 0; r < nodes.length; r++) {
      const row = nodes[r];
      for (let c = 0; c < row.length; c++) {
        const n = row[c];
        const d = turf.distance(p, turf.point(n), { units: 'meters' });
        if (d < bestDist && d <= tolMeters) {
          bestDist = d;
          best = n;
        }
      }
    }
    return best; // [lng, lat] or null
  }

  // -------- 8m road surfaces from centerlines (chunked non-blocking builder)
  updateRoadSurfacesFromGrid(roadWidthMeters = 8) {
    // Abort any previous build
    this._surfaceBuildAbort = true;
    // Start a new incremental build
    const features = (this.gridData && this.gridData.features) ? [...this.gridData.features] : [];
    const src = this.map.getSource('road-surfaces');
    if (!src) return;

    // Quick exit for empty
    if (!features.length) { src.setData({ type:'FeatureCollection', features: [] }); return; }

    this._surfaceBuildAbort = false;
    this._surfaceAccumulator = [];

    const half = roadWidthMeters / 2;
    const batchSize = 150; // tune based on perf
    let i = 0;

    const step = () => {
      if (this._surfaceBuildAbort) return; // a new build started; stop this one
      const end = Math.min(i + batchSize, features.length);
      for (; i < end; i++) {
        const ls = features[i];
        try {
          const buf = turf.buffer(ls, half, { units: 'meters' });
          if (!buf) continue;
          buf.properties = { ...(buf.properties||{}), _srcId: ls.properties?._id || '' };
          this._surfaceAccumulator.push(buf);
        } catch (e) {
          // skip problematic segment
        }
      }
      // push partial result to the map to keep UI responsive
      src.setData({ type:'FeatureCollection', features: this._surfaceAccumulator });

      if (i < features.length) {
        // keep chunking on next frame
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(step);
        else setTimeout(step, 0);
      }
    };

    // kick off
    step();
  }

  // -------- Click-to-delete
  removeGridSegment(e) {
    if (!this.gridData || !e.features?.length) return;
    const hit = e.features[0];
    const id = hit.properties?._id;
    if (!id) return;

    const idx = this.gridData.features.findIndex(f => f.properties?._id === id);
    if (idx >= 0) this.undoStack.push(this.gridData.features[idx]);

    this.gridData.features = this.gridData.features.filter(f => f.properties?._id !== id);
    this.map.getSource('grid-roads')?.setData(this.gridData);
    this.updateRoadSurfacesFromGrid(this.roadWidth);
  }

  // Shift grid origin by (dx, dy) meters: +x east, -x west, +y south, -y north
  nudgeGrid(dxMeters, dyMeters) {
    this.gridOffset.x += dxMeters;
    this.gridOffset.y += dyMeters;
    if (this.siteBoundary) this.generateAxisRotatedGrid(this.gridPitchX, this.gridPitchY, this.gridAngleRowDeg, this.gridAngleColDeg);
  }

  // --- Housing layers (blocks / lots / houses)
  setupHousingLayers() {
    if (!this.map.getSource('blocks')) {
      this.map.addSource('blocks', { type: 'geojson', data: this.emptyFC() });
    }
    if (!this.map.getLayer('blocks-fill')) {
      this.map.addLayer({
        id: 'blocks-fill', type: 'fill', source: 'blocks',
        paint: { 'fill-color': '#22c1a2', 'fill-opacity': 0.35 }
      });
    }
    if (!this.map.getLayer('blocks-line')) {
      this.map.addLayer({
        id: 'blocks-line', type: 'line', source: 'blocks',
        paint: { 'line-color': '#0e8f78', 'line-width': 2 }
      });
    }

    if (!this.map.getSource('lots')) {
      this.map.addSource('lots', { type: 'geojson', data: this.emptyFC() });
    }
    if (!this.map.getLayer('lots-line')) {
      this.map.addLayer({
        id: 'lots-line', type: 'line', source: 'lots',
        paint: { 'line-color': '#6b7280', 'line-width': 1 }
      });
    }

    if (!this.map.getSource('houses')) {
      this.map.addSource('houses', { type: 'geojson', data: this.emptyFC() });
    }
    // Remove 2D fill layer if it exists (for migration)
    if (this.map.getLayer('houses-fill')) {
      this.map.removeLayer('houses-fill');
    }
    // Add 3D extrusion layer for houses
    if (!this.map.getLayer('houses-3d')) {
      this.map.addLayer({
        id: 'houses-3d',
        type: 'fill-extrusion',
        source: 'houses',
        paint: {
          'fill-extrusion-color': '#3b82f6',
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 6],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.9
        }
      });
    }
    // Add a thin outline for houses for readability
    if (!this.map.getLayer('houses-outline')) {
      this.map.addLayer({
        id: 'houses-outline',
        type: 'line',
        source: 'houses',
        paint: {
          'line-color': '#1e3a8a',
          'line-width': 0.5,
          'line-opacity': 0.6
        }
      });
    }
  }

  // --- Generate site: blocks from roads (buffered grid centerlines), simple house placement
  generateHomes() {
    if (!this.siteBoundary) return;

    // 1) Build road polygons directly from current grid centerlines
    const centerlines = (this.gridData && this.gridData.features) ? this.gridData.features : [];
    const roadPolys = [];
    const half = (this.roadWidth || 6) / 2; // meters
    for (const ls of centerlines) {
      try {
        const buf = turf.buffer(ls, half, { units: 'meters' });
        if (buf) roadPolys.push(buf);
      } catch { /* skip bad line */ }
    }

    let blocks;
    // 2) If there are no roads, treat whole site as one block
    if (!roadPolys.length) {
      blocks = this.fc([this.siteBoundary]);
    } else {
      // 3) Union road polygons
      let union = null;
      for (const r of roadPolys) {
        try {
          union = union ? turf.union(union, r) : r;
        } catch { /* union might fail for slivers; skip */ }
      }
      if (!union) {
        // fallback to whole-site single block
        blocks = this.fc([this.siteBoundary]);
      } else {
        // 4) Blocks = siteBoundary minus roads union
        let diff;
        try {
          diff = turf.difference(this.siteBoundary, union);
        } catch {
          diff = null;
        }
        if (!diff) {
          // If subtraction failed, fallback gracefully
          blocks = this.fc([this.siteBoundary]);
        } else {
          // 5) Normalize to FeatureCollection of Polygons
          const blocksArr = (diff.geometry.type === 'MultiPolygon')
            ? diff.geometry.coordinates.map(c => turf.polygon(c))
            : [diff];
          blocks = this.fc(blocksArr.map((b, i) => ({ ...b, properties: { _blockId: `b${i}`, axis: this._inferBlockAxis(b) } })));
        }
      }
    }
    // Set blocks source
    this.map.getSource('blocks')?.setData(blocks);

    // 6) Demo lots/houses – seed simple rectangles inside blocks
    let houses = this._seedHousesInBlocks(blocks, { width: 7, depth: 7, spacing: 12, inset: 6 });
    // Fallback: if houses is missing or empty, use dummy fallback
    if (!houses || !houses.features || houses.features.length === 0) {
      houses = this._fallbackDummyHomes(this.siteBoundary);
    }
    // Set default height property for each house feature
    if (houses && houses.features) {
      houses.features.forEach(f => { f.properties = { ...(f.properties||{}), height: 6 }; });
    }
    this.map.getSource('houses')?.setData(houses);
    this.map.getSource('lots')?.setData(this.emptyFC());
  }

  // Create small house rectangles within each block using a simple grid, respecting an inner inset and axis-based orientation
  _seedHousesInBlocks(blocksFC, opts = {}) {
    const width = opts.width || 7;   // m
    const depth = opts.depth || 7;   // m
    const spacing = opts.spacing || 12; // grid step m
    const inset = opts.inset || 6;   // keep back from block edge
    const feats = [];

    for (const b of (blocksFC.features || [])) {
      // inner area to avoid touching block boundary
      let inner;
      try {
        inner = turf.buffer(b, -inset, { units: 'meters' });
        // Guard: some buffers return empty/GeometryCollection; skip those
        if (!inner || !inner.geometry || !['Polygon','MultiPolygon'].includes(inner.geometry.type)) {
          inner = null;
        }
      } catch { inner = null; }
      if (!inner) continue;

      const bb = turf.bbox(inner);
      // step over bbox by spacing
      const dx = spacing, dy = spacing;
      for (let x = bb[0]; x <= bb[2]; x += this.metersToLng(dx, (bb[1]+bb[3])/2)) {
        for (let y = bb[1]; y <= bb[3]; y += this.metersToLat(dy)) {
          const pt = turf.point([x, y]);
          if (!turf.booleanPointInPolygon(pt, inner)) continue;

          const axis = b.properties?.axis || 'row';
          const bearing = (axis === 'col') ? 90 : 0; // face along nearest road axis
          const rect = this._rectFromCenter(pt.geometry.coordinates, width, depth, bearing);
          let clipped = null;
          try {
            if (inner && turf.booleanIntersects(rect, inner)) {
              clipped = turf.intersect(rect, inner);
            }
          } catch (e) {
            // swallow and skip bad geometry
            clipped = null;
          }
          if (clipped) {
            clipped.properties = { ...(clipped.properties||{}), height: 6 };
            feats.push(clipped);
          }
        }
      }
    }
    return this.fc(feats);
  }

  // Build an oriented rectangle (Polygon) from a center, width (x), depth (y), and bearing in degrees
  _rectFromCenter(centerLngLat, wMeters, dMeters, bearingDeg = 0) {
    // create axis-aligned rectangle around origin in meters, then map to lng/lat near the center
    const cx = centerLngLat[0], cy = centerLngLat[1];
    const halfW = wMeters/2, halfD = dMeters/2;
    // rectangle corners around center in local meter space
    const corners = [
      [-halfW, -halfD], [ halfW, -halfD], [ halfW, halfD], [ -halfW, halfD], [-halfW, -halfD]
    ];
    // rotate in meter space
    const rad = bearingDeg * Math.PI/180;
    const rot = corners.map(([mx,my]) => [mx*Math.cos(rad)-my*Math.sin(rad), mx*Math.sin(rad)+my*Math.cos(rad)]);
    // convert meter offsets to lng/lat
    const toLL = ([mx,my]) => [
      cx + this.metersToLng(mx, cy),
      cy + this.metersToLat(my)
    ];
    const ring = rot.map(toLL);
    return turf.polygon([ring]);
  }

  // Fallback: generate dummy homes as 8x8m squares in a grid inside the site polygon
  _fallbackDummyHomes(sitePolygon) {
    if (!sitePolygon) return this.emptyFC();
    // Get bbox of site polygon
    const bbox = turf.bbox(sitePolygon);
    // Create a point grid with 35m spacing
    const grid = turf.pointGrid(bbox, 35, { units: 'meters' });
    // Filter points to those inside the polygon
    const insidePts = (grid.features || []).filter(pt => turf.booleanPointInPolygon(pt, sitePolygon));
    // For each point, create a square house footprint (8x8m)
    const houses = insidePts.map(pt => {
      const poly = this._rectFromCenter(pt.geometry.coordinates, 8, 8, 0);
      poly.properties = { height: 6 };
      return poly;
    });
    return this.fc(houses);
  }

  // Decide a block axis by sampling nearest road centerlines along its boundary
  _inferBlockAxis(block) {
    const roads = this.gridData.features || [];
    if (!roads.length) return 'row';
    const boundary = turf.polygonToLine(block);
    const coords = boundary.geometry.coordinates || [];
    let row = 0, col = 0;
    for (let i = 1; i < coords.length; i++) {
      const mid = turf.midpoint(turf.point(coords[i-1]), turf.point(coords[i]));
      let bestAxis = 'row', bestD = Infinity;
      for (const r of roads) {
        try {
          const d = turf.pointToLineDistance(mid, r, { units: 'meters' });
          if (d < bestD) { bestD = d; bestAxis = r.properties?.axis || 'row'; }
        } catch {}
      }
      if (bestAxis === 'row') row++; else col++;
    }
    return row >= col ? 'row' : 'col';
  }

  // -------- Helpers
  metersToLat(m) { return m / 111320; }
  metersToLng(m, lat) { return m / (111320 * Math.cos(lat * Math.PI / 180)); }

  emptyFC() { return { type: 'FeatureCollection', features: [] }; }
  fc(features) { return { type: 'FeatureCollection', features }; }

  getSavedMapLocation() {
    try { return JSON.parse(localStorage.getItem('mapLocation')); } catch { return null; }
  }
  saveMapLocation() {
    try {
      const c = this.map.getCenter();
      localStorage.setItem('mapLocation', JSON.stringify({
        center: [c.lng, c.lat],
        zoom: this.map.getZoom(),
        pitch: this.map.getPitch(),
        bearing: this.map.getBearing()
      }));
    } catch {}
  }

  getPerimeterFeature() { return this.siteBoundary; }
}

document.addEventListener('DOMContentLoaded', () => {
  window.masterplanningTool = new MasterplanningTool();

  // Ensure House Types box can be toggled even before first use
  window.masterplanningTool.injectHouseTypesBox();

  // Nav menu (three-dots) toggle wiring
  const ellipsisBtn = document.getElementById('nav-ellipsis');
  const navMenu = document.getElementById('nav-menu');
  if (ellipsisBtn && navMenu) {
    const openMenu = () => {
      navMenu.classList.add('open');
      ellipsisBtn.setAttribute('aria-expanded', 'true');
      navMenu.setAttribute('aria-hidden', 'false');
    };
    const closeMenu = () => {
      navMenu.classList.remove('open');
      ellipsisBtn.setAttribute('aria-expanded', 'false');
      navMenu.setAttribute('aria-hidden', 'true');
    };
    const toggleMenu = (e) => {
      e.stopPropagation();
      if (navMenu.classList.contains('open')) closeMenu(); else openMenu();
    };

    ellipsisBtn.addEventListener('click', toggleMenu);

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!navMenu.classList.contains('open')) return;
      if (!navMenu.contains(e.target) && e.target !== ellipsisBtn) closeMenu();
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

    // Close when clicking any menu item
    navMenu.querySelectorAll('.menu-header').forEach(item => {
      item.addEventListener('click', () => closeMenu());
    });

    // Wire up Reset Boundary action if present
    let resetItem = navMenu.querySelector('#reset-boundary');
    if (!resetItem) {
      resetItem = Array.from(navMenu.querySelectorAll('.menu-header')).find(el =>
        (el.textContent || '').trim().toLowerCase() === 'reset boundary'
      );
    }
    if (resetItem) {
      resetItem.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
        const tool = window.masterplanningTool;
        if (tool && typeof tool.startDrawing === 'function') {
          tool.startDrawing();
        }
      });
    }

    // Wire up House Types toggle (drawer-style box)
    let htItem = navMenu.querySelector('#menu-house-types');
    if (!htItem) {
      htItem = Array.from(navMenu.querySelectorAll('.menu-header')).find(el =>
        (el.textContent || '').trim().toLowerCase() === 'house types'
      );
    }
    if (htItem) {
      htItem.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
        const tool = window.masterplanningTool;
        if (tool && typeof tool.toggleHouseTypesBox === 'function') {
          tool.toggleHouseTypesBox();
        }
      });
    }
  }
});
// ---- Toolbar for Select/Copy/Paste
MasterplanningTool.prototype.injectCopyToolbar = function () {
  const panel = document.querySelector('.draw-panel');
  if (!panel || document.getElementById('edit-toolbar')) return;

  const box = document.createElement('div');
  box.id = 'edit-toolbar';
  box.style.marginTop = '12px';
  box.innerHTML = `
    <div style="font-size:12px;color:#374151;margin-bottom:6px;font-weight:600;">Edit</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button id="mode-delete" class="btn-small" style="flex:1;">✂️ Delete</button>
      <button id="mode-select" class="btn-small" style="flex:1;">🎯 Select</button>
      <button id="copy-road"  class="btn-small" style="flex:1;" disabled>📋 Copy</button>
      <button id="paste-road" class="btn-small" style="flex:1;" disabled>📥 Paste</button>
    </div>
    <div id="edit-hint" style="font-size:12px;color:#6b7280;margin-top:6px;">Click a road to delete. Switch to Select to copy roads.</div>
  `;
  panel.appendChild(box);

  // Button refs
  const btnDelete = document.getElementById('mode-delete');
  const btnSelect = document.getElementById('mode-select');
  const btnCopy   = document.getElementById('copy-road');
  const btnPaste  = document.getElementById('paste-road');
  const hint      = document.getElementById('edit-hint');

  const refreshButtons = () => {
    btnDelete.classList.toggle('active', this.mode === 'delete');
    btnSelect.classList.toggle('active', this.mode === 'select');
    btnCopy.disabled  = !this._lastHitFeature; // something selected
    btnPaste.disabled = !this.clipboard;
    hint.textContent  = (this.mode === 'select') ? 'Select mode: click a road to set it into the clipboard. Then Paste.' : 'Delete mode: click a road to remove it.';
  };

  btnDelete.addEventListener('click', () => { this.mode = 'delete'; refreshButtons(); });
  btnSelect.addEventListener('click', () => { this.mode = 'select'; this._lastHitFeature = null; refreshButtons(); });

  btnCopy.addEventListener('click', () => {
    if (!this._lastHitFeature) return;
    this.clipboard = JSON.parse(JSON.stringify(this._lastHitFeature));
    refreshButtons();
  });

  btnPaste.addEventListener('click', () => this.pasteFromClipboard());

  // expose refresh so click handlers can update state
  this._refreshEditToolbar = refreshButtons;
  refreshButtons();
};

MasterplanningTool.prototype.pasteFromClipboard = function (offsetM = 10, bearingDeg = 90) {
  if (!this.clipboard) return;
  const src = this.map.getSource('grid-roads');
  if (!src) return;

  // Clone and ensure it is a line feature
  const base = JSON.parse(JSON.stringify(this.clipboard));
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  if (base.geometry?.type !== 'LineString') {
    try {
      // Unsupported geometry for paste in this minimal impl
      return;
    } catch {
      return;
    }
  }

  const line = turf.lineString(base.geometry.coordinates);
  const moved = turf.transformTranslate(line, offsetM, bearingDeg, { units: 'meters' });
  const clone = turf.lineString(moved.geometry.coordinates, { _id: id, axis: base.properties?.axis || 'row' });

  this.gridData.features.push(clone);
  src.setData(this.gridData);
  this.updateRoadSurfacesFromGrid(this.roadWidth);
  if (typeof this.updateRoadEndNodes === 'function') this.updateRoadEndNodes();

  if (typeof this._refreshEditToolbar === 'function') this._refreshEditToolbar();
};

// Ensure updateRoadEndNodes exists to avoid runtime errors if referenced elsewhere
if (typeof MasterplanningTool.prototype.updateRoadEndNodes !== 'function') {
  MasterplanningTool.prototype.updateRoadEndNodes = function () { /* no-op placeholder */ };
}
MasterplanningTool.prototype.setPhase = function (n) {
  this.phase = n;
  // Toggle panel visibility (right panel only)
  const p2 = document.getElementById('panel-phase2');
  if (p2) p2.style.display = (n === 2) ? 'block' : 'none';

  // Enable/disable next button if it ever exists (noop otherwise)
  const nextBtn = document.getElementById('go-phase2');
  if (nextBtn) nextBtn.disabled = !this.siteBoundary;

  // Show/hide right panel depending on phase
  const rightPanelWrap = document.querySelector('.draw-panel');
  if (rightPanelWrap) rightPanelWrap.style.display = (n === 2) ? 'block' : 'none';
};



MasterplanningTool.prototype.injectPhasePanels = function () {
  const panel = document.querySelector('.draw-panel');
  if (!panel) return;

  // Right-hand panel only
  panel.innerHTML = '';

  // --- Phase 2 panel container (Grid)
  if (!document.getElementById('panel-phase2')) {
    const p2 = document.createElement('div');
    p2.id = 'panel-phase2';
    p2.style.marginTop = '0';
    p2.style.display = 'none';
    p2.innerHTML = `
      <h3 style="margin:0 0 15px 0;">Road Infrastructure</h3>
      <div id="phase2-controls"></div>
      <button class="btn-small" id="back-phase1" style="margin-top:8px; width:100%;">← Back to Plot</button>
      <button class="btn-small" id="generate-homes" style="margin-top:8px; width:100%; background:#2563eb; color:#fff; border:none;">Generate homes</button>
    `;
    panel.appendChild(p2);

    // Controls content
    const controls = document.createElement('div');
    controls.id = 'grid-phase';
    controls.style.marginTop = '0';
    controls.innerHTML = `
      <div style="display:flex;gap:8px;margin-top:0;">
        <div style="flex:1;">
          <label style="display:block;font-size:12px;margin-bottom:2px;">Rotate rows (°)</label>
          <input id="rot-row" type="number" min="-90" max="90" step="1" value="${this.gridAngleRowDeg}" style="width:100%">
        </div>
        <div style="flex:1;">
          <label style="display:block;font-size:12px;margin-bottom:2px;">Rotate columns (°)</label>
          <input id="rot-col" type="number" min="-90" max="90" step="1" value="${this.gridAngleColDeg}" style="width:100%">
        </div>
        <div style="flex:1;">
          <label style="display:block;font-size:12px;margin-bottom:2px;">Spacing Y (m)</label>
          <input id="pitch-y" type="number" min="1" step="1" value="${this.gridPitchY}" style="width:100%">
        </div>
        <div style="flex:1;">
          <label style="display:block;font-size:12px;margin-bottom:2px;">Spacing X (m)</label>
          <input id="pitch-x" type="number" min="1" step="1" value="${this.gridPitchX}" style="width:100%">
        </div>
      </div>
      <div id="nudge-controls" style="margin-top:10px;">
        <div style="font-size:12px;color:#374151;margin-bottom:6px;font-weight:600;">Nudge grid (1 m)</div>
        <div style="display:grid;grid-template-columns:40px 40px 40px;gap:6px;justify-content:start;align-items:center;">
          <div></div>
          <button id="nudge-up" class="btn-small" title="Nudge up" style="height:32px;">▲</button>
          <div></div>
          <button id="nudge-left" class="btn-small" title="Nudge left" style="height:32px;">◀</button>
          <div></div>
          <button id="nudge-right" class="btn-small" title="Nudge right" style="height:32px;">▶</button>
          <div></div>
          <button id="nudge-down" class="btn-small" title="Nudge down" style="height:32px;">▼</button>
          <div></div>
        </div>
        <div style="font-size:12px;color:#6b7280;margin-top:6px;">Tip: hold <kbd>Alt</kbd> and use arrow keys.</div>
      </div>
      <div id="edit-toolbar" style="margin-top:12px;">
        <div style="font-size:12px;color:#374151;margin-bottom:6px;font-weight:600;">Edit</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button id="mode-delete" class="btn-small" style="flex:1;">✂️ Delete</button>
          <button id="mode-select" class="btn-small" style="flex:1;">🎯 Select</button>
          <button id="copy-road"  class="btn-small" style="flex:1;" disabled>📋 Copy</button>
          <button id="paste-road" class="btn-small" style="flex:1;" disabled>📥 Paste</button>
        </div>
        <div id="edit-hint" style="font-size:12px;color:#6b7280;margin-top:6px;">Click a road to delete. Switch to Select to copy roads.</div>
      </div>
    `;
    p2.querySelector('#phase2-controls').appendChild(controls);

    // Wire Grid controls
    const rotRow = document.getElementById('rot-row');
    const rotCol = document.getElementById('rot-col');
    const pY  = document.getElementById('pitch-y');
    const pX  = document.getElementById('pitch-x');
    const regen = () => {
      if (!this.siteBoundary) return;
      this.gridAngleRowDeg = Number(rotRow.value);
      this.gridAngleColDeg = Number(rotCol.value);
      this.gridPitchY   = Math.max(1, Number(pY.value));
      this.gridPitchX   = Math.max(1, Number(pX.value));
      this.generateAxisRotatedGrid(this.gridPitchX, this.gridPitchY, this.gridAngleRowDeg, this.gridAngleColDeg);
    };
    rotRow.addEventListener('input', regen); rotRow.addEventListener('change', regen);
    rotCol.addEventListener('input', regen); rotCol.addEventListener('change', regen);
    pY.addEventListener('input', regen);  pY.addEventListener('change', regen);
    pX.addEventListener('input', regen);  pX.addEventListener('change', regen);

    // Nudge controls
    const nLeft  = document.getElementById('nudge-left');
    const nRight = document.getElementById('nudge-right');
    const nUp    = document.getElementById('nudge-up');
    const nDown  = document.getElementById('nudge-down');
    const step = this.nudgeStep || 1;
    nLeft?.addEventListener('click',  () => this.nudgeGrid(-step, 0));
    nRight?.addEventListener('click', () => this.nudgeGrid( step, 0));
    nUp?.addEventListener('click',    () => this.nudgeGrid(0, -step));
    nDown?.addEventListener('click',  () => this.nudgeGrid(0,  step));

    // Edit toolbar wiring
    const btnDelete = document.getElementById('mode-delete');
    const btnSelect = document.getElementById('mode-select');
    const btnCopy   = document.getElementById('copy-road');
    const btnPaste  = document.getElementById('paste-road');
    const hint      = document.getElementById('edit-hint');
    const refreshButtons = () => {
      btnDelete.classList.toggle('active', this.mode === 'delete');
      btnSelect.classList.toggle('active', this.mode === 'select');
      btnCopy.disabled  = !this._lastHitFeature;
      btnPaste.disabled = !this.clipboard;
      hint.textContent  = (this.mode === 'select')
        ? 'Select mode: click a road to set it into the clipboard. Then Paste.'
        : 'Delete mode: click a road to remove it.';
    };
    btnDelete.addEventListener('click', () => { this.mode = 'delete'; refreshButtons(); });
    btnSelect.addEventListener('click', () => { this.mode = 'select'; this._lastHitFeature = null; refreshButtons(); });
    btnCopy.addEventListener('click', () => { if (!this._lastHitFeature) return; this.clipboard = JSON.parse(JSON.stringify(this._lastHitFeature)); refreshButtons(); });
    btnPaste.addEventListener('click', () => this.pasteFromClipboard());
    this._refreshEditToolbar = refreshButtons;
    refreshButtons();

    document.getElementById('back-phase1').addEventListener('click', () => this.setPhase(1));
    // Add Generate homes button event and hover effect
    const genBtn = document.getElementById('generate-homes');
    if (genBtn) {
      genBtn.addEventListener('mouseenter', () => { genBtn.style.opacity = '0.85'; });
      genBtn.addEventListener('mouseleave', () => { genBtn.style.opacity = '1'; });
      genBtn.addEventListener('click', () => {
        console.log('▶️ Generate homes clicked');
        this.generateHomes();
      });
    }
  }

  // Init which panel is visible
  this.ensureNavbarSiteName();
  this.setPhase(this.siteBoundary ? 2 : 1);
};

MasterplanningTool.prototype.ensureNavbarSiteName = function () {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  // If we already mounted, just ensure the contenteditable span exists and update text/handlers
  let mount = document.getElementById('site-name-nav');
  if (mount) {
    const nameEl = mount.querySelector('span');
    if (nameEl) {
      nameEl.textContent = this.siteName;
      nameEl.setAttribute('contenteditable', 'true');
      // Ensure handlers are attached only once
      if (!nameEl.__inited) {
        nameEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            nameEl.blur();
          }
        });
        nameEl.addEventListener('blur', () => {
          const newName = (nameEl.textContent || '').trim();
          this.siteName = newName || 'Create Site';
          localStorage.setItem('siteName', this.siteName);
          nameEl.textContent = this.siteName;
        });
        nameEl.__inited = true;
      }
    }
    return;
  }

  // Find a logo anchor point (prefer .logo-text, else .logo-img, else first child)
  const logoText = navbar.querySelector('.logo-text');
  const logoImg  = navbar.querySelector('.logo-img');
  const anchor   = logoText || logoImg || navbar.firstElementChild;
  if (!anchor || !anchor.parentNode) return;

  // Wrapper directly after the logo
  mount = document.createElement('div');
  mount.id = 'site-name-nav';
  mount.style.display = 'flex';
  mount.style.alignItems = 'center';
  mount.style.gap = '10px';
  mount.style.marginLeft = '10px';

  // 0.5px separator (rendered as 1px with 0.5 opacity for crispness)
  const sep = document.createElement('div');
  sep.style.width = '1px';
  sep.style.height = '24px';
  sep.style.background = 'currentColor';
  sep.style.opacity = '0.5';

  // Editable site name pill
  const nameEl = document.createElement('span');
  nameEl.textContent = this.siteName;
  nameEl.setAttribute('contenteditable', 'true');
  nameEl.style.padding = '6px 10px';
  nameEl.style.borderRadius = '8px';
  nameEl.style.cursor = 'text';
  nameEl.style.userSelect = 'text';
  nameEl.style.outline = 'none';

  // Hover effect
  nameEl.addEventListener('mouseenter', () => { nameEl.style.background = '#F3F4F6'; });
  nameEl.addEventListener('mouseleave', () => { nameEl.style.background = 'transparent'; });

  // Save on Enter and blur
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nameEl.blur();
    }
  });
  nameEl.addEventListener('blur', () => {
    const newName = (nameEl.textContent || '').trim();
    this.siteName = newName || 'Create Site';
    localStorage.setItem('siteName', this.siteName);
    nameEl.textContent = this.siteName;
  });

  mount.appendChild(sep);
  mount.appendChild(nameEl);

  // Insert after anchor
  anchor.insertAdjacentElement('afterend', mount);
};

// --- House Types popup box (read-only, 2-column grid)
MasterplanningTool.prototype.injectHouseTypesBox = function () {
  if (document.getElementById('house-types-box')) return; // already present

  // Backdrop overlay (click to close)
  let overlay = document.getElementById('house-types-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'house-types-overlay';
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0,0,0,0.4)';
    overlay.style.zIndex = '1400'; // above panels/dropdowns, below navbar
    overlay.style.display = 'none';
    overlay.addEventListener('click', () => {
      // clicking backdrop hides both overlay and box
      const bx = document.getElementById('house-types-box');
      if (bx) bx.style.left = '-380px';
      overlay.style.display = 'none';
    });
  }

  // Container
  const box = document.createElement('div');
  box.id = 'house-types-box';
  // Slide-in left panel style, initially hidden offscreen
  box.style.position = 'fixed';
  // initial placeholder; real position computed after mount
  box.style.top = '70px';
  box.style.left = '-380px'; // hidden offscreen initially
  box.style.width = '360px';
  box.style.maxHeight = '70vh'; // shorter panel
  box.style.height = 'auto';
  // box.style.marginLeft = '10px'; // align 10px from left when visible
  box.style.overflowY = 'auto';
  box.style.transition = 'left 0.3s ease';
  box.style.background = '#ffffff';
  box.style.border = '1px solid #e5e7eb';
  box.style.borderRadius = '10px';
  box.style.boxShadow = '0 6px 24px rgba(0,0,0,0.12)';
  box.style.padding = '12px';
  box.style.zIndex = '1410'; // keep above overlay

  // Header (match Road Infrastructure header style)
  const header = document.createElement('h3');
  header.textContent = 'House Types';
  header.style.margin = '0 0 15px 0';
  box.appendChild(header);

  // Grid container (2 columns)
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = '1fr 1fr';
  grid.style.gap = '10px';
  box.appendChild(grid);

  // Updated house types with actual images
  const types = [
    { id: 'type-one', name: 'Type One', img: 'images/Type1.webp' },
    { id: 'type-two', name: 'Type Two', img: 'images/Type2.webp' },
    { id: 'type-three', name: 'Type Three', img: 'images/Type3.webp' }
  ];

  const mkCard = (t) => {
    const card = document.createElement('div');
    card.className = 'house-type-card';
    card.style.border = '1px solid #e5e7eb';
    card.style.borderRadius = '8px';
    card.style.overflow = 'hidden';
    card.style.background = '#fff';
    card.style.cursor = 'default';

    // Image (square-ish)
    const imgWrap = document.createElement('div');
    imgWrap.style.width = '100%';
    imgWrap.style.aspectRatio = '1 / 1';
    imgWrap.style.background = `center / cover no-repeat url(${t.img})`;
    card.appendChild(imgWrap);

    // Label
    const label = document.createElement('div');
    label.textContent = t.name;
    label.style.fontWeight = '600';
    label.style.fontSize = '13px';
    label.style.padding = '8px';
    label.style.textAlign = 'left';
    card.appendChild(label);

    return card;
  };

  types.forEach(t => grid.appendChild(mkCard(t)));

  // Insert overlay and box at the top level so they sit above all panels
  const mountRoot = document.body;
  if (!document.getElementById('house-types-overlay')) {
    mountRoot.appendChild(overlay);
  }
  mountRoot.appendChild(box);
  // compute accurate top (10px below navbar) now and on resize
  this._positionHouseTypesBox();
  window.addEventListener('resize', () => this._positionHouseTypesBox());

  // Close on Escape
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key !== 'Escape') return;
    const bx = document.getElementById('house-types-box');
    const ov = document.getElementById('house-types-overlay');
    if (bx && ov && bx.style.left === '10px') {
      bx.style.left = '-380px';
      ov.style.display = 'none';
    }
  });
};

MasterplanningTool.prototype._positionHouseTypesBox = function () {
  const box = document.getElementById('house-types-box');
  if (!box) return;
  const nav = document.querySelector('.navbar');
  let topPx = 60; // fallback
  if (nav) {
    const rect = nav.getBoundingClientRect();
    topPx = (rect.bottom || nav.offsetHeight || 50) + 10 + window.scrollY;
  }
  box.style.top = `${topPx}px`;
};

MasterplanningTool.prototype.showHouseTypes = function () {
  const el = document.getElementById('house-types-box');
  if (!el) return;
  this._positionHouseTypesBox();
  el.style.left = '10px';
  const ov = document.getElementById('house-types-overlay');
  if (ov) ov.style.display = 'block';
};

MasterplanningTool.prototype.toggleHouseTypesBox = function () {
  if (!document.getElementById('house-types-box')) this.injectHouseTypesBox();
  const el = document.getElementById('house-types-box');
  const ov = document.getElementById('house-types-overlay');
  if (!el) return;
  const open = el.style.left === '10px';
  if (open) {
    el.style.left = '-380px';
    if (ov) ov.style.display = 'none';
  } else {
    this._positionHouseTypesBox();
    el.style.left = '10px';
    if (ov) ov.style.display = 'block';
  }
};

// --- Grid activation circle step (between Plot and Grid)
MasterplanningTool.prototype.showGridActivationCircle = function () {
  if (!this.siteBoundary) return;
  const centroid = turf.centroid(this.siteBoundary);

  // Remove any existing activation UI first
  this.removeGridActivationCircle();
  // Create a DOM marker styled as a blue pill with white text
  const el = document.createElement('div');
  el.textContent = 'Save Boundary';
  el.style.background = '#2563eb';
  el.style.color = '#ffffff';
  el.style.padding = '8px 12px';
  el.style.borderRadius = '9999px';
  el.style.fontSize = '14px';
  el.style.fontWeight = '600';
  el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  el.style.cursor = 'pointer';
  el.style.userSelect = 'none';
  el.style.whiteSpace = 'nowrap';

  el.addEventListener('mouseenter', () => { el.style.opacity = '0.9'; });
  el.addEventListener('mouseleave', () => { el.style.opacity = '1'; });
  el.addEventListener('click', () => {
    this.removeGridActivationCircle();
    this.setPhase(2);
    this.generateAxisRotatedGrid(this.gridPitchX, this.gridPitchY, this.gridAngleRowDeg, this.gridAngleColDeg);
  });

  this._activationMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
    .setLngLat(centroid.geometry.coordinates)
    .addTo(this.map);
};

MasterplanningTool.prototype.removeGridActivationCircle = function () {
  // Remove DOM marker if present
  if (this._activationMarker) {
    try { this._activationMarker.remove(); } catch {}
    this._activationMarker = null;
  }
  if (this.map.getLayer('grid-activation-label')) {
    this.map.removeLayer('grid-activation-label');
  }
  if (this.map.getSource('grid-activation')) {
    this.map.removeSource('grid-activation');
  }
};
// Create a single long LineString for each row and each column using the lattice nodes
MasterplanningTool.prototype._buildLongAxisLines = function (nodes) {
  const rowLines = [];
  const colLines = [];

  // rows: use first and last nodes of each row (east↔west span)
  nodes.forEach(row => {
    if (row.length >= 2) {
      rowLines.push(turf.lineString([row[0], row[row.length - 1]], { axis: 'row' }));
    }
  });

  // columns: collect nodes north→south, then span first to last
  const maxCols = Math.max(...nodes.map(r => r.length));
  for (let c = 0; c < maxCols; c++) {
    const col = [];
    for (let r = 0; r < nodes.length; r++) if (nodes[r][c]) col.push(nodes[r][c]);
    if (col.length >= 2) colLines.push(turf.lineString([col[0], col[col.length - 1]], { axis: 'col' }));
  }

  return { rowLines, colLines };
};

// Split a line by the polygon boundary and return only the parts that lie inside
MasterplanningTool.prototype._keepInteriorPieces = function (line, polygon) {
  let pieces;
  try {
    const boundary = turf.polygonToLine(polygon);
    const split = turf.lineSplit(line, boundary);
    pieces = (split && split.features) ? split.features : [];
  } catch {
    pieces = [line];
  }
  if (!pieces.length) pieces = [line];

  return pieces.filter(seg => {
    const cs = seg.geometry && seg.geometry.coordinates;
    if (!cs || cs.length < 2) return false;
    const mid = turf.midpoint(turf.point(cs[0]), turf.point(cs[cs.length - 1]));
    return turf.booleanPointInPolygon(mid, polygon);
  }).map(seg => {
    seg.properties = { ...(seg.properties || {}) };
    return seg;
  });
};

// Collect true crossing points between row and column interior segments and split so endpoints meet at junctions
MasterplanningTool.prototype._splitAtRowColIntersections = function (rowSegs, colSegs) {
  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Ensure temp ids
  const tag = (seg) => {
    if (!seg.properties) seg.properties = {};
    if (!seg.properties.__tmpid) seg.properties.__tmpid = uid();
    return seg.properties.__tmpid;
  };
  rowSegs.forEach(tag);
  colSegs.forEach(tag);

  // Collect intersection points per segment id
  const buckets = new Map();
  const addPt = (id, p) => { if (!buckets.has(id)) buckets.set(id, []); buckets.get(id).push(p); };

  for (let i = 0; i < rowSegs.length; i++) {
    const r = rowSegs[i];
    for (let j = 0; j < colSegs.length; j++) {
      const c = colSegs[j];
      let ix;
      try { ix = turf.lineIntersect(r, c).features || []; }
      catch { ix = []; }
      if (!ix.length) continue;
      const rid = r.properties.__tmpid;
      const cid = c.properties.__tmpid;
      ix.forEach(pt => {
        const p = pt.geometry.coordinates;
        addPt(rid, p); addPt(cid, p);
      });
    }
  }

  // Unique helper (avoid duplicate split points)
  const uniq = (arr) => {
    const seen = new Set();
    const out = [];
    for (const p of arr) {
      const k = p[0].toFixed(8)+","+p[1].toFixed(8);
      if (!seen.has(k)) { seen.add(k); out.push(p); }
    }
    return out;
  };

  // Split one segment by its collected points (plus endpoints)
  const splitSeg = (seg) => {
    const id = seg.properties.__tmpid;
    const pts = buckets.get(id) || [];
    const cs = seg.geometry.coordinates;
    const withEnds = uniq([cs[0], ...pts, cs[cs.length - 1]]);
    if (withEnds.length <= 2) {
      return [turf.lineString(cs, { axis: seg.properties.axis, _id: uid() })];
    }
    let parts = [];
    try {
      const mp = turf.multiPoint(withEnds);
      parts = (turf.lineSplit(seg, mp).features || []);
    } catch {
      parts = [seg];
    }
    return parts.map(f => turf.lineString(f.geometry.coordinates, { axis: seg.properties.axis, _id: uid() }));
  };

  const pieces = [
    ...rowSegs.flatMap(splitSeg),
    ...colSegs.flatMap(splitSeg)
  ];

  // Dedup identical coordinate arrays
  const keep = new Map();
  pieces.forEach(f => {
    const k = JSON.stringify(f.geometry.coordinates);
    if (!keep.has(k)) keep.set(k, f);
  });
  return Array.from(keep.values());
};
