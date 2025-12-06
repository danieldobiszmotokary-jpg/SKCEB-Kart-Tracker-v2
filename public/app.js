// app.js - Full system client
// Features: universal Apex detection via /detect-json, live table, pit visualization,
// within-team scoring, adaptive filters, manual overrides, export, polling.

// ---------- Config ----------
let pollTimer = null;
const IGNORE_FIRST_LAPS = 4;
const OUTLIER_FACTOR = 2.6;
const INCONSISTENCY_STD_FACTOR = 2.5;
const SCORE_MIN = 0, SCORE_MAX = 1000;

// ---------- Models ----------
const pitRows = [];         // pitRows[row] = [ kartId, ... ]
const karts = {};           // karts[kid] = { id, label, laps:[], score, manualScore, manualMode, colorClass }
const teams = {};           // teams[teamNumber] = { number, currentKartId, previousKartId, stints:[], excluded:false }
let liveTiming = {};        // teamNumber -> { name, kartNumber, lastLap, bestLap, position }

// ---------- UI refs ----------
const apexUrlInput = document.getElementById('apexUrl');
const pollSecondsInput = document.getElementById('pollSeconds');
const fetchOnceBtn = document.getElementById('fetchOnceBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const numRowsInput = document.getElementById('numRows');
const kartsPerRowInput = document.getElementById('kartsPerRow');
const setupBtn = document.getElementById('setupBtn');
const liveTableEl = document.getElementById('liveTable');
const pitContainerEl = document.getElementById('pitContainer');
const kartScoresListEl = document.getElementById('kartScoresList');
const teamListEl = document.getElementById('teamList');
const exportBtn = document.getElementById('exportBtn');
const resetColorsBtn = document.getElementById('resetColorsBtn');

fetchOnceBtn.onclick = doFetchOnce;
startBtn.onclick = startPolling;
stopBtn.onclick = stopPolling;
setupBtn.onclick = setupPitRowsUI;
exportBtn.onclick = exportJSON;
resetColorsBtn.onclick = resetManualColors;

// ---------- Helpers ----------
function setStatus(s){ statusEl.textContent = s; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function scoreToClass(score){
  if(score == null) return 'kart-default';
  if(score >= 900) return 'kart-purple';
  if(score >= 700) return 'kart-green';
  if(score >= 500) return 'kart-yellow';
  if(score >= 300) return 'kart-orange';
  return 'kart-red';
}
function formatLap(s){
  if(s == null) return '-';
  const m = Math.floor(s/60);
  const sec = (s - m*60).toFixed(3);
  return `${m}:${sec.padStart(6,'0')}`;
}
function parseTimeToSec(t){
  if(t == null) return null;
  if(typeof t === 'number') return t;
  const s = String(t).trim();
  if(s.match(/^\d+:\d{2}(\.\d+)?$/)){ const [m,rest]=s.split(':'); return parseInt(m,10)*60 + parseFloat(rest); }
  const f = parseFloat(s.replace(',', '.')); return isNaN(f)?null:f;
}

// ---------- Server detect ----------
async function detectJsonForUrl(url){
  try{
    const res = await fetch('/detect-json', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url }) });
    return await res.json();
  }catch(e){ console.error('detect error', e); return { success:false, error: e && e.message }; }
}

// ---------- Universal extractor ----------
function extractRowsFromResponse(resp){
  if(!resp || !resp.success) return [];
  if(resp.type === 'json') return extractFromJson(resp.payload);
  return extractFromHtml(resp.payload);
}

function extractFromJson(json){
  const out = [];
  // deep scan for arrays with rows
  function scan(o){
    if(!o) return;
    if(Array.isArray(o)){
      // inspect for candidate objects
      o.forEach(item=>{
        if(item && typeof item === 'object'){
          const teamName = item.team || item.name || item.driver || item.entrant || item.team_name || item.pilot || null;
          const kartNumber = item.kart || item.kart_number || item.number || item.transponder || item.car || item.entry_no || item.position || null;
          const lastLap = parseTimeToSec(item.lastLap || item.last || item.last_lap || item.lap || item.time || item.currentLap || item.current_lap || null);
          const bestLap = parseTimeToSec(item.best || item.bestLap || item.best_lap || item.fastest || null);
          const position = item.position || item.pos || item.rank || null;
          if(teamName || kartNumber){
            out.push({ teamName: String(teamName||'').trim(), kartNumber: kartNumber!=null?String(kartNumber):null, lastLap, bestLap, position });
          }
        }
        scan(item);
      });
    } else if(typeof o === 'object'){
      Object.values(o).forEach(v=>scan(v));
    }
  }
  scan(json);
  // deduplicate by team+kart+lap
  const ded = []; const seen = new Set();
  out.forEach(r=>{
    const k = `${r.teamName}|${r.kartNumber}|${r.lastLap}`;
    if(!seen.has(k)){ seen.add(k); ded.push(r); }
  });
  return ded;
}

function extractFromHtml(html){
  const out = [];
  try{
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const tables = Array.from(doc.querySelectorAll('table'));
    for(const t of tables){
      const trs = Array.from(t.querySelectorAll('tr'));
      for(const tr of trs){
        const tds = Array.from(tr.querySelectorAll('td')).map(td=>td.textContent.trim());
        if(tds.length < 2) continue;
        const timeIdx = tds.findIndex(t => /\d{1,2}:\d{2}\.\d{1,3}|\b\d+\.\d{1,3}\b/.test(t));
        const numIdx = tds.findIndex(t => /\b\d{1,4}\b/.test(t));
        if(timeIdx !== -1 && numIdx !== -1){
          const rawTime = (tds[timeIdx].match(/(\d{1,2}:\d{2}\.\d{1,3}|\b\d+\.\d{1,3}\b)/) || [null])[0];
          const teamNum = (tds[numIdx].match(/\d{1,4}/) || [null])[0];
          out.push({ teamName: tds[0]||'', kartNumber: teamNum?String(teamNum):null, lastLap: rawTime?parseTimeToSec(rawTime):null, bestLap:null, position:null});
        }
      }
      if(out.length) break;
    }
    if(out.length) return out;
    const nodes = Array.from(doc.querySelectorAll('div,span,li'));
    nodes.forEach(n=>{
      const txt = n.textContent.trim();
      const timeMatch = txt.match(/(\d{1,2}:\d{2}\.\d{1,3}|\b\d+\.\d{1,3}\b)/);
      const numMatch = txt.match(/\b\d{1,4}\b/);
      if(timeMatch && numMatch) out.push({ teamName: txt.slice(0,40), kartNumber:String(numMatch[0]), lastLap: parseTimeToSec(timeMatch[0]), bestLap:null, position:null });
    });
    return out;
  }catch(e){ console.error('html parse', e); return []; }
}

// ---------- Integrate rows into models ----------
function integrateRows(rows){
  rows.forEach(r=>{
    // determine team key (prefer kart number if present, else teamName)
    const teamKey = r.kartNumber ? String(r.kartNumber) : ('T_' + (r.teamName || 'x'));
    liveTiming[teamKey] = liveTiming[teamKey] || { name: r.teamName || '', kartNumber: r.kartNumber || teamKey, lastLap: null, bestLap: null, position: r.position || null };
    if(r.lastLap != null) liveTiming[teamKey].lastLap = r.lastLap;
    if(r.bestLap != null) liveTiming[teamKey].bestLap = r.bestLap;
    if(r.position != null) liveTiming[teamKey].position = r.position;

    if(!teams[teamKey]) teams[teamKey] = { number: teamKey, currentKartId: null, previousKartId: null, stints: [], excluded:false };

    // if team has currentKartId, push lap into current stint
    const team = teams[teamKey];
    if(team.currentKartId){
      let cur = team.stints.length ? team.stints[team.stints.length-1] : null;
      if(!cur || cur.kartId !== team.currentKartId){ cur = { kartId: team.currentKartId, laps: [] }; team.stints.push(cur); }
      if(r.lastLap != null) cur.laps.push(r.lastLap);
      if(cur.laps.length > 200) cur.laps.shift();
      if(karts[team.currentKartId]){ if(r.lastLap != null) karts[team.currentKartId].laps.push(r.lastLap); if(karts[team.currentKartId].laps.length > 1000) karts[team.currentKartId].laps.shift(); }
    }
  });

  recomputeScoring();
  renderAll();
}

// ---------- Stint average & adaptive filters ----------
function computeStintAverage(stint){
  if(!stint || !stint.laps || stint.laps.length === 0) return null;
  const use = stint.laps.slice(IGNORE_FIRST_LAPS);
  if(use.length === 0) return null;
  const sorted = use.slice().sort((a,b)=>a-b);
  const median = sorted[Math.floor(sorted.length/2)];
  const mad = Math.max(0.5, Math.abs(median * 0.12));
  const filtered = use.filter(l => Math.abs(l - median) <= OUTLIER_FACTOR * mad);
  if(filtered.length === 0) return null;
  const avg = filtered.reduce((s,x)=>s+x,0)/filtered.length;
  return { avg, median, count: filtered.length };
}

function detectInconsistentTeams(){
  Object.values(teams).forEach(team=>{
    const avgs = [];
    team.stints.forEach(st=>{ const cs = computeStintAverage(st); if(cs && cs.avg) avgs.push(cs.avg); });
    if(avgs.length < 2){ team.excluded = false; return; }
    const mean = avgs.reduce((s,x)=>s+x,0)/avgs.length;
    const variance = avgs.reduce((s,x)=>s+Math.pow(x-mean,2),0)/avgs.length;
    const std = Math.sqrt(variance);
    team.excluded = (std > (INCONSISTENCY_STD_FACTOR * Math.max(0.5, mean*0.01)));
  });
}

// ---------- Scoring (within-team comparisons) ----------
function recomputeScoring(){
  const teamStints = {};
  Object.keys(teams).forEach(tn=>{
    teamStints[tn] = [];
    teams[tn].stints.forEach(st=>{
      const cs = computeStintAverage(st);
      if(cs && cs.avg) teamStints[tn].push({ kartId: st.kartId, avg: cs.avg });
    });
  });

  detectInconsistentTeams();

  const contributions = {}; // kid -> [metrics]
  Object.keys(teamStints).forEach(tn=>{
    if(teams[tn].excluded) return;
    const arr = teamStints[tn];
    for(let i=1;i<arr.length;i++){
      const prev = arr[i-1], cur = arr[i];
      if(prev.kartId === cur.kartId) continue;
      const metric = prev.avg - cur.avg; // positive => cur is faster
      contributions[cur.kartId] = contributions[cur.kartId] || []; contributions[cur.kartId].push(metric);
      contributions[prev.kartId] = contributions[prev.kartId] || []; contributions[prev.kartId].push(-metric);
    }
  });

  // ensure every kart has raw 0 at least
  Object.keys(karts).forEach(k=>{ if(!(k in contributions)) contributions[k] = contributions[k] || []; });

  const raw = {};
  Object.keys(contributions).forEach(kid=>{
    const arr = contributions[kid];
    raw[kid] = (arr.length ? arr.reduce((s,x)=>s+x,0)/arr.length : 0);
  });

  // normalize
  const vals = Object.values(raw);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = (max - min) || 1;
  Object.keys(raw).forEach(kid=>{
    const norm = (raw[kid] - min)/range;
    const score = Math.round(norm * (SCORE_MAX - SCORE_MIN) + SCORE_MIN);
    if(!karts[kid].manualMode){
      karts[kid].score = score;
      karts[kid].colorClass = scoreToClass(score);
    }
  });

  renderSidebar();
}

// ---------- Pit row logic ----------
function setupPitRowsUI(){
  const nr = Math.max(1, parseInt(numRowsInput.value) || 3);
  const kp = Math.max(1, parseInt(kartsPerRowInput.value) || 3);
  pitRows.length = 0;
  let uid = 1;
  for(let r=0;r<nr;r++){
    pitRows[r] = [];
    for(let s=0;s<kp;s++){
      const id = `U${uid++}`;
      karts[id] = { id, label:'', laps:[], score:null, manualScore:null, manualMode:false, colorClass:'kart-default' };
      pitRows[r].push(id);
    }
  }
  renderAll();
  setStatus(`Setup ${nr} rows × ${kp} slots (placeholders created)`);
}

function handleRowAdd(rowIndex){
  const teamNumber = prompt('Enter team number (transponder/team number):');
  if(!teamNumber) return;
  if(!teams[teamNumber]) teams[teamNumber] = { number: teamNumber, currentKartId: null, previousKartId: null, stints: [], excluded:false };
  const row = pitRows[rowIndex];
  if(!row || row.length === 0){ alert('Row empty'); return; }
  const taken = row.shift();
  teams[teamNumber].previousKartId = teams[teamNumber].currentKartId || null;
  teams[teamNumber].currentKartId = taken;
  karts[taken].label = teamNumber;
  const prev = teams[teamNumber].previousKartId;
  if(prev && karts[prev]){
    removeKartFromAllRows(prev);
    row.push(prev);
  }
  recomputeScoring();
  renderAll();
  setStatus(`Team ${teamNumber} took kart ${taken} in Row ${rowIndex+1}`);
}

function removeKartFromAllRows(kid){
  for(let r=0;r<pitRows.length;r++) pitRows[r] = pitRows[r].filter(x=>x !== kid);
}

// manual overrides
function setKartManualNumber(kid){
  const v = prompt('Set kart label/number (leave empty to clear):', karts[kid].label || '');
  if(v === null) return;
  karts[kid].label = v.trim();
  if(karts[kid].label && teams[karts[kid].label]) teams[karts[kid].label].currentKartId = kid;
  renderAll();
}
function setKartManualScore(kid){
  const s = prompt('Set manual score 0..1000 (leave empty to clear):', karts[kid].manualScore != null ? String(karts[kid].manualScore) : '');
  if(s === null) return;
  if(s === ''){ karts[kid].manualScore = null; karts[kid].manualMode = false; recomputeScoring(); }
  else { const v = clamp(parseInt(s,10),0,1000); karts[kid].manualScore = v; karts[kid].score = v; karts[kid].manualMode = true; karts[kid].colorClass = scoreToClass(v); }
  renderAll();
}
function restoreKartAuto(kid){ karts[kid].manualScore = null; karts[kid].manualMode = false; recomputeScoring(); }

// ---------- Renders ----------
function renderLiveTable(){
  const keys = Object.keys(liveTiming).sort((a,b)=>{
    const la = liveTiming[a].lastLap || 9999, lb = liveTiming[b].lastLap || 9999;
    return la - lb || (parseInt(a) - parseInt(b));
  });
  liveTableEl.innerHTML = '';
  if(keys.length === 0){ liveTableEl.innerHTML = '<div>No live timing</div>'; return; }
  keys.forEach(tn=>{
    const r = liveTiming[tn];
    const div = document.createElement('div'); div.className = 'live-row';
    const a = document.createElement('div'); a.style.width='60px'; a.textContent = tn;
    const b = document.createElement('div'); b.style.flex='1'; b.textContent = r.name || '-';
    const c = document.createElement('div'); c.style.width='80px'; c.textContent = r.kartNumber || '-';
    const d = document.createElement('div'); d.style.width='90px'; d.textContent = r.lastLap?formatLap(r.lastLap):'-';
    const e = document.createElement('div'); e.style.width='90px'; e.textContent = r.bestLap?formatLap(r.bestLap):'-';
    div.appendChild(a); div.appendChild(b); div.appendChild(c); div.appendChild(d); div.appendChild(e);
    liveTableEl.appendChild(div);
  });
}

function renderPit(){
  pitContainerEl.innerHTML = '';
  pitRows.forEach((row, rIdx)=>{
    const col = document.createElement('div'); col.className = 'pit-column';
    const h = document.createElement('h4'); h.textContent = `Row ${rIdx+1}`; col.appendChild(h);
    row.forEach(kid=>{
      const kk = karts[kid];
      const box = document.createElement('div'); box.className = 'kart-box ' + (kk.colorClass || 'kart-default');
      const label = document.createElement('div'); label.className = 'kart-label'; label.textContent = kk.label || kk.id;
      const scoreD = document.createElement('div'); scoreD.className = 'kart-score'; scoreD.textContent = kk.score != null ? `Score: ${kk.score}` : 'Score: -';
      box.appendChild(label); box.appendChild(scoreD);
      const ctr = document.createElement('div'); ctr.className = 'kart-controls';
      const btnNum = document.createElement('button'); btnNum.textContent='Set#'; btnNum.onclick = ()=> setKartManualNumber(kid);
      const btnScore = document.createElement('button'); btnScore.textContent='SetScore'; btnScore.onclick = ()=> setKartManualScore(kid);
      const btnAuto = document.createElement('button'); btnAuto.textContent='Auto'; btnAuto.onclick = ()=> restoreKartAuto(kid);
      ctr.appendChild(btnNum); ctr.appendChild(btnScore); ctr.appendChild(btnAuto);
      box.appendChild(ctr);
      col.appendChild(box);
    });
    const add = document.createElement('button'); add.className = 'add-btn'; add.textContent = '+ Add (team enters this row)'; add.onclick = ()=> handleRowAdd(rIdx);
    col.appendChild(add);
    pitContainerEl.appendChild(col);
  });
}

function renderSidebar(){
  kartScoresListEl.innerHTML = '';
  Object.values(karts).sort((a,b)=> (b.score||0) - (a.score||0)).forEach(k=>{
    const d = document.createElement('div'); d.textContent = `Kart ${k.id} | label:${k.label||'-'} | score:${k.score!=null?k.score:'-' } ${k.manualMode?'(M)':''}`;
    kartScoresListEl.appendChild(d);
  });
  teamListEl.innerHTML = '';
  Object.keys(teams).sort((a,b)=> a.localeCompare(b)).forEach(tn=>{
    const t = teams[tn];
    const d = document.createElement('div'); d.textContent = `Team ${tn} → kart:${t.currentKartId||'-'} prev:${t.previousKartId||'-'} ${t.excluded?'[EXCL]':''}`;
    teamListEl.appendChild(d);
  });
}

function renderAll(){ renderLiveTable(); renderPit(); renderSidebar(); }

// ---------- Fetch / Poll ----------
async function doFetchOnce(){
  const url = apexUrlInput.value && apexUrlInput.value.trim();
  if(!url){ setStatus('No Apex URL'); return; }
  setStatus('Detecting Apex JSON / HTML...');
  const detected = await detectJsonForUrl(url);
  if(!detected || !detected.success){ setStatus('Detect failed'); console.warn(detected); return; }
  setStatus(`Fetched from ${detected.source} (${detected.type})`);
  const rows = extractRowsFromResponse(detected);
  if(rows.length === 0){ setStatus('No rows parsed'); console.warn('no rows', detected); return; }
  integrateRows(rows);
}

function startPolling(){
  const s = Math.max(2, parseInt(pollSecondsInput.value) || 6);
  if(pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(doFetchOnce, s*1000);
  startBtn.disabled = true; stopBtn.disabled = false;
  setStatus('Polling started');
  doFetchOnce();
}
function stopPolling(){ if(pollTimer) clearInterval(pollTimer); pollTimer = null; startBtn.disabled = false; stopBtn.disabled = true; setStatus('Polling stopped'); }

// ---------- Export / utility ----------
function exportJSON(){ const data = { pitRows, karts, teams, liveTiming }; const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'kart-tracker-export.json'; a.click(); }
function resetManualColors(){ Object.values(karts).forEach(k=>{ k.manualMode=false; k.manualScore=null; }); recomputeScoring(); renderAll(); }

// ---------- Init ----------
window.addEventListener('load', ()=>{
  numRowsInput.value = 3; kartsPerRowInput.value = 3;
  setupPitRowsUI();
  setStatus('Ready. Paste ApexTiming link and Fetch Once / Start Polling.');
});

