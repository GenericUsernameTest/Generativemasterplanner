// main.js — map wiring, drawing modes, and UI
import { $, emptyFC, fc, setStats } from './utils.js';
import { generatePlan } from './generateplan.js';

// ───────────────────────────────────────────────────────────────────────────────
// 1) Map init  (← put YOUR real token here)
mapboxgl.accessToken = 'pk.eyJ1IjoiYXNlbWJsIiwiYSI6ImNtZTMxcG90ZzAybWgyanNjdmdpbGZkZHEifQ.3XPuSVFR0s8kvnRnY1_2mw';
const STYLE_URL = 'mapbox://styles/asembl/cme31yog7018101s81twu6g8n'; // or your custom style

document.addEventListener('DOMContentLoaded', () => {
  const map = new mapboxgl.Map({
    container: 'map',
    style: STYLE_URL,
    center: [-0.12, 51.505],
    zoom: 13,
    pitch: 0,
    bearing: 0
  });

  map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

  // ───────────────────────────────────────────────────────────────────────────
  // 2) State
  let draw;
  let siteBoundary = null;         // Feature<Polygon|MultiPolygon>
  let accessRoad   = null;         // Feature<LineString>
  const parks      = [];           // array of Feature<Polygon>
  let mode = 'idle';               // 'idle' | 'site' | 'access' | 'park'

  // ───────────────────────────────────────────────────────────────────────────
  // 3) Map sources/layers
  map.on('load', () => {
    map.addSource('site-view',   { type: 'geojson', data: emptyFC() });
    map.addSource('access-line', { type: 'geojson', data: emptyFC() });
    map.addSource('parks',       { type: 'geojson', data: emptyFC() });
    map.addSource('roads-view',  { type: 'geojson', data: emptyFC() });
    map.addSource('homes',       { type: 'geojson', data: emptyFC() });

    map.addLayer({ id:'site-fill', type:'fill', source:'site-view',
      paint:{ 'fill-color':'#16a34a', 'fill-opacity':0.12 }});
    map.addLayer({ id:'site-edge', type:'line', source:'site-view',
      paint:{ 'line-color':'#16a34a', 'line-width':4 }});

    map.addLayer({ id:'parks-fill', type:'fill', source:'parks',
      paint:{ 'fill-color':'#84cc16', 'fill-opacity':0.25 }});
    map.addLayer({ id:'parks-edge', type:'line', source:'parks',
      paint:{ 'line-color':'#65a30d', 'line-width':2 }});

    map.addLayer({ id:'access-line-view', type:'line', source:'access-line',
      paint:{ 'line-color':'#111827', 'line-width':3, 'line-dasharray':[2,1], 'line-opacity':0.9 }});

    map.addLayer({ id:'roads-fill', type:'fill', source:'roads-view',
      paint:{ 'fill-color':'#9ca3af', 'fill-opacity':0.55 }});

    map.addLayer({ id:'homes-3d', type:'fill-extrusion', source:'homes',
      paint:{
        'fill-extrusion-color':['coalesce', ['get','color'], '#9fb7ff'],
        'fill-extrusion-height':['coalesce', ['get','height'], 4],
        'fill-extrusion-opacity':0.8
      }});

    // Draw control
    draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: false, line_string: false, trash: false }
    });
    map.addControl(draw);

    // hook draw events
    map.on('draw.create', onDrawEvent);
    map.on('draw.update', onDrawEvent);

    // wire UI
    wireToolbar();
    setStats('<p>Draw the <b>Site Boundary</b> to begin.</p>');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4) Draw handlers
  function onDrawEvent(e){
    const f = e.features?.[0];
    if (!f) return;

    if (mode === 'site' && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) {
      siteBoundary = f;
      // store & show
      map.getSource('site-view')?.setData(fc([siteBoundary]));

      // leave draw mode so next click doesn’t keep adding rings
      draw.deleteAll();
      mode = 'idle';
      setStats('<p>Site saved. Now draw the <b>Access Road</b> (a single line) or add a <b>Park</b>.</p>');
      return;
    }

    if (mode === 'access' && f.geometry.type === 'LineString') {
      accessRoad = f;
      map.getSource('access-line')?.setData(fc([accessRoad]));
      // keep the line visible; leave draw mode
      draw.deleteAll();
      mode = 'idle';
      return;
    }

    if (mode === 'park' && f.geometry.type === 'Polygon') {
      parks.push(f);
      map.getSource('parks')?.setData(fc(parks));
      // allow drawing multiple parks; keep polygon mode OFF after each park
      draw.deleteAll();
      mode = 'idle';
      return;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 5) UI
  function wireToolbar(){
    const btnSite     = $('drawSite');
    const btnAccess   = $('drawAccess');
    const btnPark     = $('drawPark');
    const btnClearP   = $('clearParks');
    const btnGen      = $('generate');
    const btnClearAll = $('clearAll');

    if (btnSite)   btnSite.onclick   = () => { mode='site';   draw.deleteAll(); draw.changeMode('draw_polygon'); setStats('<p>Draw the site boundary then double‑click to finish.</p>'); };
    if (btnAccess) btnAccess.onclick = () => {
      if (!siteBoundary){ alert('Draw the site boundary first.'); return; }
      mode='access'; draw.deleteAll(); draw.changeMode('draw_line_string'); setStats('<p>Draw the main access road (double‑click to finish).</p>');
    };
    if (btnPark)   btnPark.onclick   = () => {
      if (!siteBoundary){ alert('Draw the site boundary first.'); return; }
      mode='park'; draw.deleteAll(); draw.changeMode('draw_polygon'); setStats('<p>Draw a park polygon. Repeat as needed.</p>');
    };
    if (btnClearP) btnClearP.onclick = () => {
      parks.length = 0;
      map.getSource('parks')?.setData(emptyFC());
    };
    if (btnClearAll) btnClearAll.onclick = () => {
      siteBoundary = null; accessRoad = null; parks.length = 0;
      map.getSource('site-view')?.setData(emptyFC());
      map.getSource('access-line')?.setData(emptyFC());
      map.getSource('parks')?.setData(emptyFC());
      map.getSource('roads-view')?.setData(emptyFC());
      map.getSource('homes')?.setData(emptyFC());
      draw.deleteAll(); mode='idle';
      setStats('<p>Cleared. Draw the <b>Site Boundary</b> to begin.</p>');
    };
    if (btnGen) btnGen.onclick = () => generate();
  }

  function generate(){
    try {
      const parksFC = fc(parks);
      generatePlan(map, siteBoundary, accessRoad, parksFC);
    } catch (err){
      console.error(err);
      alert('Generate failed. See console for details.');
    }
  }
});
