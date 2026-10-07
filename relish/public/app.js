(function(){
'use strict';

const ICON = {
  public:'<path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L11 15.8 8.2 13z"/><path d="M7 14c-2 0-3 1.5-3 3 0 1.2-.8 2.3-2 3 3 1 7 0 7.5-3.5z"/>',
  hidden:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  nature:'<path d="M11 20A7 7 0 0 1 4 13c0-6 5-9 16-9 0 11-3 16-9 16z"/><path d="M4 21c4-6 8-9 12-11"/>',
  back:'<path d="M15 5l-7 7 7 7"/>',
  close:'<path d="M6 6l12 12M18 6L6 18"/>',
  nav:'<path d="M3 11l18-8-8 18-2-8z"/>',
  check:'<path d="M5 12l5 5 9-10"/>',
  pin:'<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  camera:'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  share:'<path d="M12 3v13"/><path d="M7 8l5-5 5 5"/><path d="M5 14v6h14v-6"/>'
};
const CATS = {
  public:{label:'Public', long:'Public art'},
  hidden:{label:'Hidden', long:'Hidden art'},
  nature:{label:'Nature', long:"Nature's art"}
};
const APPROX_R = 200;
const ID_RE = /^[a-f0-9-]{36}$/i;

/* ---------- local identity (no accounts) ---------- */
function lsGet(k, fb){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch(e){ return fb; } }
function lsSet(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
const DEVICE = lsGet('glint:device', null) || (crypto.randomUUID ? crypto.randomUUID() : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2,12));
lsSet('glint:device', DEVICE);
const tokens = lsGet('glint:tokens', {});        // spotId -> delete token (spots I posted)
const found = new Set(lsGet('glint:found', []));  // spotIds I checked in at
const reported = new Set(lsGet('glint:reported', []));
(function adminFromHash(){
  const m = location.hash.match(/admin=([^&]+)/);
  if (m){ lsSet('glint:admin', decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname); }
})();
const ADMIN = lsGet('glint:admin', '');

const S = {
  spots:[], loaded:false, loadError:false,
  pos:null, geo:'pending', placed:false,
  filter:'all', q:'', sheetOpen:false,
  view:'map', detailId:null, findsTab:'found', draft:null,
  deleteArmed:false, reportArmed:false, busy:false
};

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
function svgIcon(name){ return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">'+ICON[name]+'</svg>'; }
function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs){
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;   // constant icon markup only
    else if (k.slice(0,2) === 'on') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()){ if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
function str(v, max){ return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
let toastT;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3400); }
function dist(a, b){
  const R = 6371000, r = Math.PI/180, dLat = (b.lat-a.lat)*r, dLng = (b.lng-a.lng)*r;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function fmtDist(m){
  if (m < 160) return Math.max(10, Math.round(m*3.281/10)*10) + ' ft';
  const mi = m/1609.34; return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + ' mi';
}
function fmtWalk(m){ const min = Math.max(1, Math.round(m/80)); return min < 90 ? 'about ' + min + ' min walk' : ''; }
function fmtWhen(ts){
  if (!ts) return '';
  const d = (Date.now()-ts)/1000;
  if (d < 90) return 'just now';
  if (d < 3600) return Math.round(d/60) + ' min ago';
  if (d < 86400) return Math.round(d/3600) + ' hr ago';
  return new Date(ts).toLocaleDateString(undefined, {month:'short', day:'numeric', year: d > 300*86400 ? 'numeric' : undefined});
}
function distText(s){
  if (!S.pos) return 'Added ' + fmtWhen(s.createdAt);
  return (s.precision === 'approx' ? 'Area ~' : '') + fmtDist(dist(S.pos, s)) + ' away';
}
function catDot(cat){ return h('span', {class:'dot c-'+cat, html:svgIcon(cat)}); }
function thumbEl(s){
  const box = h('div', {class:'thumb ph-'+s.category});
  if (s.thumb) box.append(h('img', {src:s.thumb, alt:'', loading:'lazy'}));
  return box;
}
function cleanSpot(d){
  if (!d || !ID_RE.test(d.id) || !CATS[d.category]) return null;
  const lat = Number(d.lat), lng = Number(d.lng);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return { id:d.id, category:d.category, lat, lng,
    title: str(d.title, 80) || 'Untitled', artist: str(d.artist, 80), note: str(d.note, 500),
    precision: d.precision === 'approx' ? 'approx' : 'exact',
    thumb: typeof d.thumb === 'string' && d.thumb.startsWith('data:image/jpeg;base64,') ? d.thumb : '',
    createdAt: Number(d.createdAt) || 0, finds: Number(d.finds) || 0 };
}
function visibleSpots(){
  const q = S.q.toLowerCase();
  let list = S.spots.filter(s => (S.filter === 'all' || s.category === S.filter) &&
    (!q || (s.title + ' ' + s.artist + ' ' + s.note).toLowerCase().includes(q)));
  if (S.pos) list = list.map(s => [dist(S.pos, s), s]).sort((a,b) => a[0]-b[0]).map(x => x[1]);
  return list;
}

/* ---------- API ---------- */
async function api(path, opts){
  opts = opts || {};
  const headers = Object.assign({'content-type':'application/json'}, opts.headers || {});
  const r = await fetch(path, Object.assign({}, opts, {headers}));
  let data = null; try { data = await r.json(); } catch(e){}
  if (!r.ok) throw new Error((data && data.error) || 'Something went wrong. Try again.');
  return data;
}
async function loadSpots(){
  try {
    const data = await api('/api/spots');
    S.spots = (Array.isArray(data) ? data : []).map(cleanSpot).filter(Boolean);
    S.loaded = true; S.loadError = false;
  } catch(e){ S.loaded = true; S.loadError = true; }
  if (!S.placed && !S.pos && S.spots.length) fitSpots();
  renderAll();
  openFromHash();
}
function upsert(spot){
  const s = cleanSpot(spot); if (!s) return null;
  const i = S.spots.findIndex(x => x.id === s.id);
  if (i >= 0) S.spots[i] = s; else S.spots.unshift(s);
  return s;
}

/* ---------- map ---------- */
let map, spotLayer, meLayer;
function initMap(){
  map = L.map('map', {zoomControl:false, attributionControl:false, worldCopyJump:true}).setView([39.5, -98.35], 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19}).addTo(map);
  spotLayer = L.layerGroup().addTo(map);
  meLayer = L.layerGroup().addTo(map);
  map.on('dragstart', () => { S.placed = true; });
  $('#zin').onclick = () => map.zoomIn();
  $('#zout').onclick = () => map.zoomOut();
  $('#recenter').onclick = () => {
    if (S.pos) map.setView([S.pos.lat, S.pos.lng], Math.max(map.getZoom(), 16));
    else { toast('Location is not available yet.'); startGeo(); }
  };
  window.addEventListener('resize', syncMapInset);
}
function fitSpots(){
  const pts = S.spots.map(s => [s.lat, s.lng]);
  if (pts.length === 1) map.setView(pts[0], 16);
  else map.fitBounds(pts, {padding:[40, 40], maxZoom:16});
}
function renderMarkers(){
  if (!map) return;
  spotLayer.clearLayers();
  for (const s of visibleSpots()){
    if (s.precision === 'approx'){
      L.circle([s.lat, s.lng], {radius:APPROX_R, interactive:false, color:getComputedStyle(document.documentElement).getPropertyValue('--'+s.category).trim(),
        weight:2, dashArray:'6 5', fillOpacity:.12}).addTo(spotLayer);
    }
    const label = CATS[s.category].long + ': ' + s.title;
    L.marker([s.lat, s.lng], {
      icon: L.divIcon({className:'glint-marker', html:'<span class="pin c-'+s.category+'">'+svgIcon(s.category)+'</span>', iconSize:[44,44], iconAnchor:[22,22]}),
      title: label, alt: label, keyboard:true, riseOnHover:true
    }).on('click', () => openDetail(s.id)).addTo(spotLayer);
  }
}
function renderMe(){
  if (!map) return;
  meLayer.clearLayers();
  if (!S.pos) return;
  if (S.pos.acc && S.pos.acc < 2000) L.circle([S.pos.lat, S.pos.lng], {radius:S.pos.acc, interactive:false, stroke:false, fillColor:'#2563EB', fillOpacity:.1}).addTo(meLayer);
  L.marker([S.pos.lat, S.pos.lng], {icon:L.divIcon({className:'glint-marker', html:'<span class="me"></span>', iconSize:[34,34], iconAnchor:[17,17]}), interactive:false, keyboard:false}).addTo(meLayer);
}
function syncMapInset(){
  if (!map) return;
  const sh = $('#sheet').offsetHeight, tabs = $('.tabs').offsetHeight;
  $('#map').style.bottom = Math.max(0, sh + tabs - 22) + 'px';
  map.invalidateSize({pan:false});
}

/* ---------- location ---------- */
let watchId = null;
function startGeo(){
  if (!('geolocation' in navigator)){ S.geo = 'unsupported'; renderChips(); return; }
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  S.geo = 'pending'; renderChips();
  watchId = navigator.geolocation.watchPosition(p => {
    const first = !S.pos;
    S.pos = {lat:p.coords.latitude, lng:p.coords.longitude, acc:p.coords.accuracy, t:Date.now()};
    S.geo = 'ok';
    if (first && !S.placed && !S.detailId) map.setView([S.pos.lat, S.pos.lng], 16);
    renderMe();
    if (first) renderAll();
    if (S.view === 'post') renderLocBox();
  }, err => { S.geo = err.code === 1 ? 'denied' : 'error'; renderChips(); if (S.view === 'post') renderLocBox(); },
  {enableHighAccuracy:true, maximumAge:15000, timeout:20000});
}
function locateOnce(){
  return new Promise((res, rej) => {
    if (!('geolocation' in navigator)) return rej();
    navigator.geolocation.getCurrentPosition(p => res({lat:p.coords.latitude, lng:p.coords.longitude, acc:p.coords.accuracy}), rej,
      {enableHighAccuracy:true, maximumAge:10000, timeout:12000});
  });
}
function parseCoords(text){
  const m = String(text).match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) ? {lat, lng, acc:null} : null;
}

/* ---------- photo processing ---------- */
function exifGps(buf){
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o + 4 < v.byteLength){
      const m = v.getUint16(o);
      if (m === 0xFFE1 && v.getUint32(o+4) === 0x45786966) return tiffGps(v, o + 10);
      if ((m & 0xFF00) !== 0xFF00) return null;
      o += 2 + v.getUint16(o+2);
    }
  } catch(e){}
  return null;
}
function tiffGps(v, t){
  const le = v.getUint16(t) === 0x4949;
  const u16 = p => v.getUint16(p, le), u32 = p => v.getUint32(p, le);
  const ifd = t + u32(t+4); let gps = 0;
  for (let i = 0; i < u16(ifd); i++){ const e = ifd + 2 + i*12; if (u16(e) === 0x8825) gps = t + u32(e+8); }
  if (!gps) return null;
  const rat = p => { const d = u32(p+4); return d ? u32(p)/d : 0; };
  const dms = p => rat(p) + rat(p+8)/60 + rat(p+16)/3600;
  let lat = null, lng = null, latR = 'N', lngR = 'E';
  for (let i = 0; i < u16(gps); i++){
    const e = gps + 2 + i*12, tag = u16(e);
    if (tag === 1) latR = String.fromCharCode(v.getUint8(e+8));
    if (tag === 2) lat = dms(t + u32(e+8));
    if (tag === 3) lngR = String.fromCharCode(v.getUint8(e+8));
    if (tag === 4) lng = dms(t + u32(e+8));
  }
  if (lat == null || lng == null || (lat === 0 && lng === 0)) return null;
  return {lat: latR === 'S' ? -lat : lat, lng: lngR === 'W' ? -lng : lng, acc:null};
}
function loadImage(file){
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(); };
    img.src = url;
  });
}
function shrink(img, maxDim, q){
  const sc = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth*sc); c.height = Math.round(img.naturalHeight*sc);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
function bestPhoto(img){
  for (const dim of [1600, 1280, 1024, 820]) for (const q of [0.8, 0.68, 0.56]){
    const d = shrink(img, dim, q); if (d.length < 560000) return d;
  }
  return shrink(img, 640, 0.5);
}
function bestThumb(img){
  for (const q of [0.66, 0.5, 0.4]){ const d = shrink(img, 360, q); if (d.length < 55000) return d; }
  return shrink(img, 240, 0.4);
}

/* ---------- chips, sheet, tabs ---------- */
function renderChips(){
  const box = $('#chips'); box.textContent = '';
  box.append(h('button', {class:'chip all', 'aria-pressed':String(S.filter === 'all'), onclick:() => setFilter('all')}, 'All'));
  for (const k in CATS) box.append(h('button', {class:'chip', 'aria-pressed':String(S.filter === k), onclick:() => setFilter(k)}, catDot(k), CATS[k].label));
  const g = $('#geonote');
  const msg = S.geo === 'denied' ? 'Location is off. Tap to retry' : S.geo === 'error' ? 'Could not find you. Tap to retry' : S.geo === 'unsupported' ? 'Location not supported here' : '';
  g.hidden = !msg; g.textContent = msg;
  g.onclick = () => { if (S.geo !== 'unsupported') startGeo(); };
}
function setFilter(f){ S.filter = f; renderAll(); }
function renderSheet(){
  const sh = $('#sheet'); sh.textContent = '';
  const list = visibleSpots();
  sh.append(h('div', {class:'sheet-head'},
    h('div', null,
      h('h2', {id:'sheet-title'}, S.pos ? 'Near you' : 'Latest spots'),
      h('div', {class:'sub'}, !S.loaded ? 'Loading…' : S.loadError ? 'Could not load spots.' :
        list.length + (list.length === 1 ? ' spot' : ' spots') + (S.filter !== 'all' ? ' · ' + CATS[S.filter].label : ''))),
    S.loadError ? h('button', {class:'textbtn', onclick:loadSpots}, 'Retry') :
    list.length ? h('button', {class:'textbtn', 'aria-expanded':String(S.sheetOpen), onclick:() => { S.sheetOpen = !S.sheetOpen; renderSheet(); }}, S.sheetOpen ? 'Show map' : 'Show list') : null));
  if (S.loaded && !S.loadError){
    if (!list.length){
      sh.append(h('div', {class:'empty'},
        h('span', null, S.spots.length ? 'Nothing matches that filter.' : 'No art spotted yet. Painted trash cans, hidden pieces, a tree with character: be the first to post one.'),
        !S.spots.length ? h('button', {class:'btn btn-orange', onclick:startCapture, html:svgIcon('camera')}, 'Spot something') : null));
    } else if (S.sheetOpen){
      const l = h('div', {class:'list'});
      for (const s of list) l.append(h('button', {class:'row', onclick:() => openDetail(s.id)}, thumbEl(s),
        h('div', {style:'min-width:0;display:flex;flex-direction:column;gap:3px'},
          h('span', {class:'card-t'}, s.title), h('span', {class:'sub'}, CATS[s.category].label + ' · ' + distText(s)))));
      sh.append(l);
    } else {
      const row = h('div', {class:'cards'});
      for (const s of list.slice(0, 30)){
        const t = thumbEl(s); t.append(h('span', {class:'tag c-'+s.category}, CATS[s.category].label));
        row.append(h('button', {class:'card', onclick:() => openDetail(s.id)}, t,
          h('div', {style:'display:flex;flex-direction:column;gap:2px'}, h('span', {class:'card-t'}, s.title), h('span', {class:'sub'}, distText(s)))));
      }
      sh.append(row);
    }
  }
  sh.append(h('div', {class:'attrib'}, 'Map data © ', h('a', {href:'https://www.openstreetmap.org/copyright', target:'_blank', rel:'noopener'}, 'OpenStreetMap contributors')));
  syncMapInset();
}
function renderTabs(){
  for (const [id, v] of [['#tab-map','map'], ['#tab-finds','finds']]){
    const el = $(id); if (S.view === v) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  }
}
function renderAll(){
  renderChips(); renderSheet(); renderTabs(); renderMarkers(); renderMe();
  if (S.view === 'detail') renderDetail();
  if (S.view === 'finds') renderFinds();
}
function setView(v){
  S.view = v; S.deleteArmed = false; S.reportArmed = false;
  if (v === 'map'){ $('#overlay').textContent = ''; if (location.hash) history.replaceState(null, '', location.pathname); }
  renderAll();
}

/* ---------- capture & post ---------- */
function startCapture(){ const f = $('#file'); f.value = ''; f.click(); }
async function onFile(file){
  if (!file) return;
  if (!/^image\//.test(file.type)){ toast('That file is not a photo.'); return; }
  toast('Preparing photo…');
  try {
    const [buf, img] = await Promise.all([file.arrayBuffer(), loadImage(file)]);
    const exif = exifGps(buf);
    const fresh = S.pos && Date.now() - S.pos.t < 120000 ? {lat:S.pos.lat, lng:S.pos.lng, acc:S.pos.acc} : null;
    const prev = S.draft;
    S.draft = {photo:bestPhoto(img), thumb:bestThumb(img), exif,
      category: prev ? prev.category : 'public', precision: prev ? prev.precision : 'exact', precTouched: prev ? prev.precTouched : false,
      loc: exif ? Object.assign({source:'photo'}, exif) : fresh ? Object.assign({source:'device'}, fresh) : null,
      locating:false, title: prev ? prev.title : '', artist: prev ? prev.artist : '', note: prev ? prev.note : ''};
    $('#toast').classList.remove('show');
    openPost();
    if (!S.draft.loc) refreshLoc();
  } catch(e){ toast('Could not read that photo. Try another one.'); }
}
async function refreshLoc(){
  const d = S.draft; if (!d) return;
  d.locating = true; renderLocBox();
  try { const p = await locateOnce(); if (S.draft === d) d.loc = Object.assign({source:'device'}, p); }
  catch(e){ if (S.draft === d && !d.loc) toast('Could not get your location. Use the photo or paste coordinates.'); }
  if (S.draft === d){ d.locating = false; renderLocBox(); }
}
function openPost(){
  S.view = 'post'; renderTabs();
  const d = S.draft, ov = $('#overlay'); ov.textContent = '';
  const seg = h('div', {class:'seg', role:'group', 'aria-label':'Category'});
  const drawSeg = () => { seg.textContent = ''; for (const k in CATS) seg.append(h('button', {type:'button', class:'k-'+k, 'aria-pressed':String(d.category === k), html:svgIcon(k),
    onclick:() => { d.category = k; if (!d.precTouched) d.precision = k === 'hidden' ? 'approx' : 'exact'; drawSeg(); renderLocBox(); }}, CATS[k].label)); };
  drawSeg();
  const form = h('form', {id:'postform', class:'vbody', novalidate:true, onsubmit:submitPost},
    h('div', {class:'preview'}, h('img', {src:d.photo, alt:'Your photo'}),
      h('button', {type:'button', class:'retake', onclick:startCapture}, 'Retake')),
    h('div', {class:'field'}, h('span', null, 'What did you find?'), seg),
    h('label', {class:'field'}, 'Name it',
      h('input', {id:'f-title', maxlength:'80', required:true, placeholder:'Octopus trash can', autocomplete:'off', value:d.title, oninput:e => d.title = e.target.value})),
    h('label', {class:'field'}, 'Artist, if known',
      h('input', {maxlength:'80', placeholder:'Unknown is fine', autocomplete:'off', value:d.artist, oninput:e => d.artist = e.target.value})),
    h('label', {class:'field'}, 'Note',
      h('textarea', {maxlength:'500', placeholder:'How to find it, best time of day, what to look for', oninput:e => d.note = e.target.value}, d.note)),
    h('div', {class:'field'}, h('span', null, 'Location'), h('div', {id:'locbox', class:'box'})),
    h('p', {class:'hint'}, 'Only post art you can see from public places, and never share a spot on private property. Posts are public.'));
  ov.append(h('section', {class:'view', 'aria-labelledby':'post-h'},
    h('header', {class:'vhead'},
      h('button', {class:'iconbtn', 'aria-label':'Cancel', html:svgIcon('close'), onclick:() => { S.draft = null; setView('map'); }}),
      h('h1', {id:'post-h', tabindex:'-1'}, 'New spot'),
      h('button', {class:'pill c-public', id:'postbtn', type:'submit', form:'postform'}, 'Post')),
    form));
  renderLocBox();
  $('#post-h').focus();
}
function renderLocBox(){
  const box = $('#locbox'), d = S.draft; if (!box || !d) return;
  box.textContent = '';
  let cls = 'status', text;
  if (d.loc){
    cls += ' ok';
    text = (d.loc.source === 'photo' ? "From the photo's location data" : d.loc.source === 'manual' ? 'Entered by you' :
      'Your current location' + (d.loc.acc ? ' (±' + fmtDist(d.loc.acc) + ')' : '')) + ': ' + d.loc.lat.toFixed(5) + ', ' + d.loc.lng.toFixed(5);
  } else if (d.locating){ cls += ' wait'; text = 'Finding your location…'; }
  else text = 'No location yet';
  box.append(h('div', {class:'box-row'}, h('div', {class:cls}, h('span', {class:'led'}), h('span', null, text))));
  const acts = h('div', {class:'box-row manual'});
  if (d.loc && d.loc.source !== 'device') acts.append(h('button', {type:'button', class:'smallbtn', onclick:refreshLoc}, 'Use where I am now'));
  if (!d.loc || d.loc.source === 'device'){
    if (S.geo !== 'unsupported') acts.append(h('button', {type:'button', class:'smallbtn', onclick:refreshLoc, disabled:d.locating}, d.loc ? 'Refresh' : 'Try again'));
    if (d.exif) acts.append(h('button', {type:'button', class:'smallbtn', onclick:() => { d.loc = Object.assign({source:'photo'}, d.exif); renderLocBox(); }}, "Use photo's location"));
  }
  const man = h('input', {type:'text', 'aria-label':'Coordinates', placeholder:'Or paste coordinates, e.g. 33.2, -117.2'});
  acts.append(man, h('button', {type:'button', class:'smallbtn', onclick:() => {
    const p = parseCoords(man.value);
    if (!p){ toast('Could not read that. Use latitude, longitude.'); return; }
    d.loc = Object.assign({source:'manual'}, p); renderLocBox();
  }}, 'Set'));
  box.append(acts);
  const radio = (val, label) => h('label', {class:'box-row'},
    h('input', {type:'radio', name:'prec', value:val, checked:d.precision === val, onchange:() => { d.precision = val; d.precTouched = true; }}), label);
  box.append(radio('exact', 'Show the exact spot'), radio('approx', 'Show only an area of about 200 m'));
}
async function submitPost(e){
  e.preventDefault();
  const d = S.draft; if (!d || S.busy) return;
  const title = d.title.trim();
  if (!title){ toast('Give it a name first.'); $('#f-title').focus(); return; }
  if (!d.loc){ toast('Add a location so others can find it.'); return; }
  const btn = $('#postbtn'); S.busy = true; btn.disabled = true; btn.textContent = 'Posting…';
  try {
    const res = await api('/api/spots', {method:'POST', body:JSON.stringify({
      title, category:d.category, artist:d.artist, note:d.note, lat:d.loc.lat, lng:d.loc.lng,
      precision:d.precision, photo:d.photo, thumb:d.thumb})});
    tokens[res.spot.id] = res.deleteToken; lsSet('glint:tokens', tokens);
    const s = upsert(res.spot);
    S.draft = null; S.busy = false; S.placed = true;
    map.setView([s.lat, s.lng], Math.max(map.getZoom(), 16));
    openDetail(s.id);
    toast('Posted. Thanks for spotting it.');
  } catch(err){
    S.busy = false; btn.disabled = false; btn.textContent = 'Post';
    toast(err.message);
  }
}

/* ---------- detail ---------- */
function openDetail(id){
  S.detailId = id; S.deleteArmed = false; S.reportArmed = false; S.view = 'detail';
  history.replaceState(null, '', '#spot=' + id);
  renderTabs(); renderDetail(true);
}
function openFromHash(){
  const m = location.hash.match(/spot=([a-f0-9-]{36})/i);
  if (m && S.view === 'map' && S.spots.some(s => s.id === m[1])){
    const s = S.spots.find(x => x.id === m[1]); S.placed = true; map.setView([s.lat, s.lng], 17); openDetail(s.id);
  }
}
function renderDetail(first){
  const s = S.spots.find(x => x.id === S.detailId), ov = $('#overlay');
  if (!s){ if (S.loaded) setView('map'); return; }
  const scrollTop = ov.firstChild ? ov.firstChild.scrollTop : 0;
  ov.textContent = '';
  const photo = h('img', {src:'/api/photo?id=' + encodeURIComponent(s.id), alt:'Photo of ' + s.title});
  if (s.thumb) photo.style.background = 'center/cover url("' + s.thumb + '")';
  const hero = h('div', {class:'hero ph-' + s.category}, photo,
    h('div', {class:'hero-ctl'},
      h('button', {class:'round', 'aria-label':'Back to map', html:svgIcon('back'), onclick:() => setView('map')}),
      h('button', {class:'round', 'aria-label':'Share this spot', html:svgIcon('share'), onclick:() => share(s)})));
  const isFound = found.has(s.id), n = s.finds;
  const distLine = S.pos ? (() => { const m = dist(S.pos, s); return (s.precision === 'approx' ? 'Area is ~' : '') + fmtDist(m) + ' away' + (fmtWalk(m) ? ', ' + fmtWalk(m) : ''); })() : 'Turn on location to see how far it is';
  const canDelete = !!tokens[s.id] || !!ADMIN;
  const panel = h('div', {class:'dpanel'},
    h('span', {class:'dtag c-' + s.category, html:svgIcon(s.category)}, CATS[s.category].long),
    h('div', {style:'display:flex;flex-direction:column;gap:6px'},
      h('h1', {id:'detail-h', tabindex:'-1'}, s.title),
      h('span', {class:'sub', style:'font-size:15px'}, s.artist ? 'By ' + s.artist : 'Artist unknown'),
      h('span', {class:'meta', html:svgIcon('pin')}, distLine)),
    h('div', {class:'actions'},
      h('a', {class:'btn btn-ink', target:'_blank', rel:'noopener', href:'https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=' + s.lat + ',' + s.lng, html:svgIcon('nav')}, 'Directions'),
      h('button', {class:'btn btn-line', 'aria-pressed':String(isFound), html:svgIcon('check'), onclick:e => toggleFind(s, e.currentTarget)}, isFound ? 'Found it' : 'I found it')),
    h('span', {class:'sub'}, n ? (n === 1 ? (isFound ? 'You found this one' : '1 person found this') : n + ' people found this') : 'Nobody has checked in yet'),
    s.precision === 'approx' ? h('div', {class:'approx'}, 'The location is approximate on purpose. Look around the circled area on the map.') : null,
    s.note ? h('div', {style:'display:flex;flex-direction:column;gap:6px'}, h('h2', {style:'margin:0;font-family:var(--display);font-size:18px'}, "Spotter's note"), h('p', {class:'note'}, s.note)) : null,
    h('span', {class:'sub'}, (tokens[s.id] ? 'Spotted by you, ' : 'Spotted ') + fmtWhen(s.createdAt)),
    h('div', {style:'display:flex;gap:10px;flex-wrap:wrap'},
      canDelete ? h('button', {class:'btn btn-line danger', onclick:e => removeSpot(s, e.currentTarget)}, 'Delete this spot') : null,
      !tokens[s.id] ? h('button', {class:'textbtn', disabled:reported.has(s.id), onclick:e => report(s, e.currentTarget)},
        reported.has(s.id) ? 'Reported. Thanks' : 'Report: spam, private property or offensive') : null));
  const view = h('section', {class:'view', 'aria-labelledby':'detail-h'}, hero, panel);
  ov.append(view); view.scrollTop = scrollTop;
  if (first) $('#detail-h').focus({preventScroll:true});
}
async function toggleFind(s, btn){
  btn.disabled = true;
  const want = !found.has(s.id);
  try {
    const r = await api('/api/finds', {method:'POST', body:JSON.stringify({spotId:s.id, device:DEVICE, found:want})});
    if (want) found.add(s.id); else found.delete(s.id);
    lsSet('glint:found', [...found]);
    s.finds = Number(r.count) || 0;
  } catch(e){ toast(e.message); }
  renderAll();
}
async function removeSpot(s, btn){
  if (!S.deleteArmed){ S.deleteArmed = true; btn.textContent = 'Tap again to delete'; return; }
  btn.disabled = true;
  try {
    const headers = tokens[s.id] ? {'x-delete-token':tokens[s.id]} : {'x-admin-token':ADMIN};
    await api('/api/spots?id=' + encodeURIComponent(s.id), {method:'DELETE', headers});
    delete tokens[s.id]; lsSet('glint:tokens', tokens);
    found.delete(s.id); lsSet('glint:found', [...found]);
    S.spots = S.spots.filter(x => x.id !== s.id);
    toast('Spot deleted.'); setView('map');
  } catch(e){ btn.disabled = false; toast(e.message); }
}
async function report(s, btn){
  if (!S.reportArmed){ S.reportArmed = true; btn.textContent = 'Tap again to send report'; return; }
  btn.disabled = true;
  try {
    await api('/api/report', {method:'POST', body:JSON.stringify({spotId:s.id, device:DEVICE, reason:'flag'})});
    reported.add(s.id); lsSet('glint:reported', [...reported]);
    toast('Thanks. Spots with several reports are hidden for review.');
  } catch(e){ toast(e.message); }
  renderDetail();
}
async function share(s){
  const url = location.origin + location.pathname + '#spot=' + s.id;
  try {
    if (navigator.share){ await navigator.share({title:s.title + ' on Glint', url}); return; }
    await navigator.clipboard.writeText(url); toast('Link copied.');
  } catch(e){ if (e && e.name !== 'AbortError') toast(url); }
}

/* ---------- finds ---------- */
function renderFinds(){
  const ov = $('#overlay'); ov.textContent = '';
  const mineFound = S.spots.filter(s => found.has(s.id));
  const posted = S.spots.filter(s => tokens[s.id]);
  const list = S.findsTab === 'found' ? mineFound : posted;
  const count = k => mineFound.filter(s => s.category === k).length;
  const grid = h('div', {class:'grid'});
  for (const s of list){
    const cell = h('button', {class:'gcell ph-' + s.category, 'aria-label':s.title, onclick:() => openDetail(s.id)});
    if (s.thumb) cell.append(h('img', {src:s.thumb, alt:''}));
    cell.append(catDot(s.category)); grid.append(cell);
  }
  ov.append(h('section', {class:'view above-tabs', 'aria-labelledby':'finds-h'},
    h('header', {class:'vhead', style:'padding-left:16px'}, h('h1', {id:'finds-h'}, 'Your finds')),
    h('div', {class:'vbody'},
      h('div', {class:'tiles'}, ...Object.keys(CATS).map(k => h('div', {class:'tile c-' + k}, h('b', null, String(count(k))), h('span', null, CATS[k].label)))),
      h('div', {class:'toggle', role:'group', 'aria-label':'Show'},
        h('button', {'aria-pressed':String(S.findsTab === 'found'), onclick:() => { S.findsTab = 'found'; renderFinds(); }}, 'Found (' + mineFound.length + ')'),
        h('button', {'aria-pressed':String(S.findsTab === 'posted'), onclick:() => { S.findsTab = 'posted'; renderFinds(); }}, 'Posted (' + posted.length + ')')),
      list.length ? grid : h('p', {class:'hint', style:'font-size:15px'}, S.findsTab === 'found'
        ? 'Open a spot and tap "I found it" when you see it in person. Your finds collect here.'
        : 'Spots you post from this device show up here.'),
      h('p', {class:'hint'}, 'Your finds and posts are remembered on this device. Clearing browser data forgets them.'))));
}

/* ---------- boot ---------- */
function boot(){
  $('#q').addEventListener('input', e => { S.q = e.target.value.trim(); renderSheet(); renderMarkers(); });
  $('#tab-map').onclick = () => setView('map');
  $('#tab-finds').onclick = () => setView('finds');
  $('#tab-cap').onclick = startCapture;
  $('#file').addEventListener('change', e => onFile(e.target.files && e.target.files[0]));
  initMap();
  renderAll();
  startGeo();
  loadSpots();
  setInterval(() => { if (document.visibilityState === 'visible' && S.view !== 'post') loadSpots(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadSpots(); });
}
boot();
})();
