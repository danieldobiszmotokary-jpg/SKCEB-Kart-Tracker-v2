// app.js - FINAL implementation (no test mode)
// Features: Apex fetch, universal parser, per-team per-stint tracking, scoring by within-team comparisons,
// adaptive filtering (rain/conditions), inconsistent-team exclusion, independent pit rows, manual overrides,
// separate kart scores and team lists, export, polling.

// ---------- Config ----------
let pollTimer = null;
let pollSeconds = 5;
const IGNORE_FIRST_LAPS = 4;     // laps of fighting to ignore at start of stint
const MAX_STINT_LAPS = 200;
const MAX_RECENT = 12;           // laps per stint considered for averaging
const OUTLIER_FACTOR = 2.6;      // adaptive outlier filter sensitivity
const INCONSISTENCY_STD_FACTOR = 2.5; // if team variance > factor => exclude team
const SCORE_MIN = 0, SCORE_MAX = 1000;

// ---------- Data models ----------
let numRows = 3;
let kartsPerRow = 3;

const pitRows = [];   // pitRows[row] = [ kartId, ... ] (independent)
const karts = {};     // karts[kid] = { id, label, laps:[], score:null, manualScore:null, manualMode:false, color }
const teams = {};     // teams[teamNumber] = { number, currentKartId, previousKartId, stints: [{kartId, laps:[], avg}], excluded:false }

// live table raw: map team -> { lastLap, bestLap, name }
let liveTiming = {}; // { teamNumber: { name, kartNumber, lastLap, bestLap } }

// ---------- Utilities ----------
function setStatus(s){ document.getElementById('status').textContent = s; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function colorClass(name){
  switch(name){
    case 'blue': return 'kart-blue';
    case 'purple': return 'kart-purple';
    case 'green': return 'kart-green';
    case 'yellow': return 'kart-yellow';
    case 'orange': return 'kart-orange';
    case 'red': return 'kart-red';
    default: return 'kart-blue';
  }
}

// convert lap seconds to "higher=better" raw metric; we will later normalize to 0-1000
function lapToMetric(lapSec){
  // Use a baseline scale: smaller lap -> higher metric. Clip reasonable band.
  // baseline: metric = 120 - lapSec (so 60s -> 60, 90s -> 30)
  const raw = clamp(120 - lapSec, -10, 120);
  return raw;
}

// ---------- Apex fetch & parser ----------
async function proxyFetch(url){
  try{
    const res = await fetch('/proxy-fetch', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ url })
    });
    const json = await res.json();
    if(!json.success) throw new Error('proxy failed');
    return json.html;
  } catch(e){
    console.error('proxyFetch error', e);
    return null;
  }
}

// Robust parser: returns array of {teamNumber, teamName, kartNumber, lapSec}
function parseApexHtml(html){
  if(!html) return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const out = [];

  // Strategy: look for table rows containing time-like and number-like cells
  const tables = Array.from(doc.querySelectorAll('table'));
  for(const t of tables){
    const rows = Array.from(t.querySelectorAll('tr'));
    for(const tr of rows){
      const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
      if(cells.length < 2) continue;
      // detect time and team/number
      const timeIdx = cells.findIndex(c => /\d{1,2}:\d{2}\.\d{1,3}|\b\d+\.\d{1,3}\b/.test(c));
      const numIdx = cells.findIndex(c => /\b\d{1,4}\b/.test(c));
      if(timeIdx !== -1 && numIdx !== -1){
        const timeMatch = (cells[timeIdx].match(/(\d{1,2}:\d{2}\.\d{1,3}|\b\d+\.\d{1,3}\b)/) || [null])[0];
        const teamNum = (cells[numIdx].match(/\d{1,4}/) || [null])[0];
        if(teamNum && timeMatch){
          out.push({
            teamNumber: teamNum,
            teamName: cells.slice(0,1).join(' ') || '',
            kartNumber: teamNum, // Apex often uses same for transponder; will map teams by number
            lapSec: parseTimeToSec(timeMatch),
            rawCells: cells
          });
        }
      }
    }
    if(out.length) break;
  }

  // fallback: search spans/divs for time and number pairs
  if(out.length === 0){
    const nodes = Array.from(doc.querySelectorAll('div,span,li'));
    nodes.forEach(n=>{
      const txt = n.textContent.trim();
      const timeMatch = txt.match(/(\d{1,2}:\d{2}\.\d{1,3}|\b\d+\.\d{1,3}\b)/);
      const numMatch = txt.match(/\b\d{1,4}\b/);
      if(timeMatch && numMatch){
        out.push({ teamNumber: numMatch[0], teamName: '', kartNumber: numMatch[0], lapSec: parseTimeToSec(timeMatch[0]), rawCells:[txt] });
      }
    });
  }

  // dedupe and return
  const seen = new Set();
  const cleaned = [];
  for(const r of out){
    if(!r.teamNumber || !r.lapSec) continue;
    const key = `${r.teamNumber}|${r.lapSec.toFixed(2)}`;
    if(seen.has(key)) continue;
    seen.add(key);
    cleaned.push(r);
  }
  return cleaned;
}

function parseTimeToSec(t){
  if(!t) return null;
  if(t.indexOf(':') !== -1){
    const parts = t.split(':');
    const m = parseInt(parts[0],10), s = parseFloat(parts[1]);
    return m*60 + s;
  } else return parseFloat(t);
}

// ---------- Live processing pipeline ----------
function integrateLiveRows(rows){
  // rows: [{teamNumber, teamName, kartNumber, lapSec}]
  rows.forEach(r=>{
    liveTiming[r.teamNumber] = liveTiming[r.teamNumber] || { name: r.teamName || '', kartNumber: r.kartNumber, lastLap: null, bestLap: null };
    liveTiming[r.teamNumber].name = r.teamName || liveTiming[r.teamNumber].name;
    liveTiming[r.teamNumber].kartNumber = r.kartNumber || liveTiming[r.teamNumber].kartNumber;
    liveTiming[r.teamNumber].lastLap = r.lapSec;
    liveTiming[r.teamNumber].bestLap = liveTiming[r.teamNumber].bestLap ? Math.min(liveTiming[r.teamNumber].bestLap, r.lapSec) : r.lapSec;

    // Map team -> teams model. Ensure team exists
    if(!teams[r.teamNumber]){
      teams[r.teamNumber] = { number: r.teamNumber, currentKartId: null, previousKartId: null, stints: [], excluded:false };
    }

    // If team currently has a kart assigned (teams[...] currentKartId), push lap into that stint's lap list
    const team = teams[r.teamNumber];
    if(team.currentKartId){
      // find current stint (last stint with same kart and not closed)
      let curStint = team.stints.length ? team.stints[team.stints.length-1] : null;
      if(!curStint || curStint.kartId !== team.currentKartId){
        // start new stint
        curStint = { kartId: team.currentKartId, laps: [] };
        team.stints.push(curStint);
      }
      curStint.laps.push(r.lapSec);
      // cap
      if(curStint.laps.length > MAX_STINT_LAPS) curStint.laps.shift();
      // also append raw to karts[kartId] for history
      if(karts[team.currentKartId]) {
        karts[team.currentKartId].laps.push(r.lapSec);
        if(karts[team.currentKartId].laps.length > 1000) karts[team.currentKartId].laps.shift();
      }
    } else {
      // team not assigned a kart yet; waiting until pit entry happens
    }
  });

  // After integrating, recompute scoring
  recomputeScoring();
  renderAll();
}

// ---------- Stint averaging & noise handling ----------
function computeStintAverage(stint){
  // stint.laps is array. ignore first IGNORE_FIRST_LAPS laps (start noise)
  if(!stint || !stint.laps || stint.laps.length === 0) return null;
  const use = stint.laps.slice(IGNORE_FIRST_LAPS);
  if(use.length === 0) return null;
  // filter adaptive: remove laps that are huge outliers relative to median of use
  const sorted = use.slice().sort((a,b)=>a-b);
  const median = sorted[Math.floor(sorted.length/2)];
  const mad = Math.max(0.5, Math.abs(median * 0.12));
  const filtered = use.filter(l => Math.abs(l - median) <= OUTLIER_FACTOR * mad);
  if(filtered.length === 0) return null;
  const avg = filtered.reduce((s,x)=>s+x,0)/filtered.length;
  return { avg, median, count: filtered.length };
}

// ---------- Adaptive condition detection & team exclusion ----------
function detectConditionShift(){
  // compute median of all recent stint medians across teams
  const medians = [];
  Object.values(teams).forEach(team=>{
    team.stints.slice(-3).forEach(st=>{ 
      const cs = computeStintAverage(st);
      if(cs && cs.median) medians.push(cs.median);
    });
  });
  if(medians.length < 3) return null;
  medians.sort((a,b)=>a-b);
  const mid = medians[Math.floor(medians.length/2)];
  return mid; // baseline median lap across recent stints
}

function detectInconsistentTeams(){
  // mark teams excluded if their stint averages show too much variance relative to own mean
  Object.values(teams).forEach(team=>{
    const avgList = [];
    team.stints.forEach(st=>{
      const cs = computeStintAverage(st);
      if(cs && cs.avg) avgList.push(cs.avg);
    });
    if(avgList.length < 2){
      team.excluded = false;
      return;
    }
    const mean = avgList.reduce((s,x)=>s+x,0)/avgList.length;
    const variance = avgList.reduce((s,x)=>s+Math.pow(x-mean,2),0)/avgList.length;
    const std = Math.sqrt(variance);
    // relative std / mean is indicator; if too high mark excluded
    if(std > (INCONSISTENCY_STD_FACTOR * Math.max(0.5, mean*0.01))){
      team.excluded = true;
    } else {
      team.excluded = false;
    }
  });
}

// ---------- Scoring building (stint-to-stint comparisons) ----------
function recomputeScoring(){
  // Step 1: compute per-team per-stint averages (clean)
  const teamStintAverages = {}; // team -> [{kartId, avg}]
  Object.keys(teams).forEach(tn=>{
    const team = teams[tn];
    teamStintAverages[tn] = [];
    team.stints.forEach(st=>{
      const cs = computeStintAverage(st);
      if(cs && cs.avg) teamStintAverages[tn].push({ kartId: st.kartId, avg: cs.avg });
    });
  });

  // Step 2: detect condition baseline & inconsistent teams
  detectInconsistentTeams();
  const baseline = detectConditionShift();

  // Step 3: build per-kart "score-contributions" from teams
  // For each team, compare successive stints (only if different kart) to compute delta = previousAvg - nextAvg
  // Positive delta => improvement; negative => worse. We interpret kart quality such that if team performs better on kart B compared to A, B is better.
  const kartContributions = {}; // kartId -> array of metrics
  Object.keys(teamStintAverages).forEach(tn=>{
    if(teams[tn].excluded) return; // ignore inconsistent teams
    const arr = teamStintAverages[tn];
    if(arr.length < 2) return;
    for(let i=1;i<arr.length;i++){
      const prev = arr[i-1], cur = arr[i];
      if(prev.kartId === cur.kartId) continue; // same kart twice -> no comparison
      // We compute improvement metric: prev.avg - cur.avg (positive means cur kart faster)
      const metric = prev.avg - cur.avg;
      // Normalize metric by baseline (if present) to be condition-aware
      const normalized = baseline ? (metric / baseline) : metric;
      // push contribution to both karts: cur gets +normalized, prev gets -normalized
      kartContributions[cur.kartId] = kartContributions[cur.kartId] || [];
      kartContributions[prev.kartId] = kartContributions[prev.kartId] || [];
      kartContributions[cur.kartId].push(normalized);
      kartContributions[prev.kartId].push(-normalized);
    }
  });

  // Step 4: aggregate contributions into raw quality metric
  const rawMetrics = {};
  Object.keys(kartContributions).forEach(kid=>{
    const arr = kartContributions[kid];
    const avg = arr.reduce((s,x)=>s+x,0)/arr.length;
    rawMetrics[kid] = avg;
  });

  // Ensure every known kart has an entry (even zero)
  Object.keys(karts).forEach(kid => { if(!(kid in rawMetrics)) rawMetrics[kid] = 0; });

  // Step 5: normalize rawMetrics into 0..1000 (linear scaling)
  const vals = Object.values(rawMetrics);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = (max - min) || 1;
  Object.keys(rawMetrics).forEach(kid=>{
    const norm = (rawMetrics[kid] - min) / range; // 0..1
    const score = Math.round(norm * (SCORE_MAX - SCORE_MIN) + SCORE_MIN);
    // If manualScore mode, do not overwrite
    if(karts[kid].manualMode){
      // keep manualScore as karts[kid].score
    } else {
      karts[kid].score = score;
      karts[kid].color = scoreToColor(score);
    }
  });

  // Render updated lists
  renderSidebar();
}

// choose color from 0-1000 score
function scoreToColor(score){
  if(score == null) return 'blue';
  if(score >= 900) return 'purple';
  if(score >= 700) return 'green';
  if(score >= 500) return 'yellow';
  if(score >= 300) return 'orange';
  return 'red';
}

// ---------- Pit row logic (independent rows) ----------
function setupPitRowsUI(){
  numRows = parseInt(document.getElementById('numRows').value) || 3;
  kartsPerRow = parseInt(document.getElementById('kartsPerRow').value) || 3;
  // build fresh unknown karts for pit placeholders
  pitRows.length = 0;
  // create unique unknown IDs U1..UN
  let uid=1;
  for(let r=0;r<numRows;r++){
    pitRows[r] = [];
    for(let s=0;s<kartsPerRow;s++){
      const kid = `U${uid++}`;
      karts[kid] = { id:kid, label:'', laps:[], score:null, manualScore:null, manualMode:false, color:'blue' };
      pitRows[r].push(kid);
    }
  }
  renderAll();
  setStatus(`Setup ${numRows} rows × ${kartsPerRow} slots`);
}

// When team enters rowIndex (user clicks +), exact behavior:
// - prompt for teamNumber
// - Team takes FIRST kart in that row (removed)
// - remaining shift forward
// - the team's previousKartId (if any) is appended at end of same row
function handleRowAdd(rowIndex){
  const teamNumber = prompt('Enter team number (transponder/number):');
  if(!teamNumber) return;
  if(!teams[teamNumber]) teams[teamNumber] = { number: teamNumber, currentKartId: null, previousKartId: null, stints: [], excluded:false };
  const row = pitRows[rowIndex];
  if(!row || row.length === 0) { alert('Row empty'); return; }
  // 1. take first kart
  const takenKart = row.shift();
  // assign to team
  teams[teamNumber].previousKartId = teams[teamNumber].currentKartId || null;
  teams[teamNumber].currentKartId = takenKart;
  // label physical kart with team
  karts[takenKart].label = teamNumber;
  // 2. append team's previous kart to end
  const prev = teams[teamNumber].previousKartId;
  if(prev && karts[prev]){
    // remove prev if present in rows elsewhere
    removeKartFromAllRows(prev);
    row.push(prev);
  }
  // done
  recomputeScoring();
  renderAll();
  setStatus(`Team ${teamNumber} took kart ${takenKart} in row ${rowIndex+1}`);
}

function removeKartFromAllRows(kid){
  for(let r=0;r<pitRows.length;r++){
    pitRows[r] = pitRows[r].filter(x=>x !== kid);
  }
}

// ---------- Manual override functions (inside kart box) ----------
function setKartManualNumber(kid){
  const v = prompt('Set kart number / label (leave empty to clear):', karts[kid].label || '');
  if(v === null) return;
  karts[kid].label = v.trim();
  // if label corresponds to team, map team currentKartId
  if(karts[kid].label && teams[karts[kid].label]) teams[karts[k].label].currentKartId = kid;
  renderAll();
}

function setKartManualScore(kid){
  const s = prompt('Set manual score 0..1000 (leave empty to clear):', karts[kid].manualScore != null ? karts[kid].manualScore : '');
  if(s === null) return;
  if(s === '') {
    karts[kid].manualScore = null;
    karts[kid].manualMode = false;
    // restore auto score (recompute)
    recomputeScoring();
  } else {
    const v = clamp(parseInt(s,10), 0, 1000);
    karts[kid].manualScore = v;
    karts[kid].score = v;
    karts[kid].manualMode = true;
    karts[kid].color = scoreToColor(v);
  }
  renderAll();
}

function restoreKartAuto(kid){
  karts[kid].manualScore = null;
  karts[kid].manualMode = false;
  recomputeScoring();
}

// ---------- Renderers ----------
function renderLiveTable(){
  const container = document.getElementById('liveTable');
  const keys = Object.keys(liveTiming).sort((a,b)=> {
    // simple: by lastLap ascending (faster first) else by team num
    const la = liveTiming[a].lastLap || 9999, lb = liveTiming[b].lastLap || 9999;
    return la - lb || (parseInt(a)-parseInt(b));
  });
  if(keys.length === 0){ container.innerHTML = '<div class="live-row">No live timing</div>'; return; }
  container.innerHTML = '';
  keys.forEach(tn=>{
    const row = liveTiming[tn];
    const div = document.createElement('div');
    div.className = 'live-row';
    div.innerHTML = `<div style="width:60px">${tn}</div>
      <div style="flex:1">${row.name || '-'}</div>
      <div style="width:80px">${row.kartNumber || '-'}</div>
      <div style="width:90px">${row.lastLap?formatLap(row.lastLap):'-'}</div>
      <div style="width:90px">${row.bestLap?formatLap(row.bestLap):'-'}</div>`;
    container.appendChild(div);
  });
}

function formatLap(s){
  if(s == null) return '-';
  const m = Math.floor(s/60);
  const sec = (s - m*60).toFixed(3);
  return `${m}:${sec.padStart(6,'0')}`;
}

function renderPit(){
  const cont = document.getElementById('pitContainer');
  cont.innerHTML = '';
  for(let r=0;r<pitRows.length;r++){
    const col = document.createElement('div');
    col.className = 'pit-column';
    const h = document.createElement('h4'); h.textContent = `Row ${r+1}`; col.appendChild(h);
    pitRows[r].forEach((kid, idx)=>{
      const k = karts[kid];
      const box = document.createElement('div');
      box.className = 'kart-box ' + colorClass(k.color || 'blue');
      const label = document.createElement('div'); label.style.fontSize='16px'; label.style.marginBottom='6px';
      label.textContent = k.label || kid;
      box.appendChild(label);
      const scorediv = document.createElement('div'); scorediv.textContent = k.score != null ? `Score: ${k.score}` : 'Score: -';
      scorediv.style.fontSize='13px'; box.appendChild(scorediv);

      // manual badge
      if(k.manualMode) {
        const b = document.createElement('div'); b.textContent='MANUAL'; b.style.fontSize='11px'; b.style.marginTop='4px'; b.style.opacity='0.9';
        box.appendChild(b);
      }

      // controls
      const ctr = document.createElement('div'); ctr.className='kart-controls';
      const btnNum = document.createElement('button'); btnNum.textContent='Set#'; btnNum.onclick = ()=> setKartManualNumber(kid);
      const btnScore = document.createElement('button'); btnScore.textContent='SetScore'; btnScore.onclick = ()=> setKartManualScore(kid);
      const btnAuto = document.createElement('button'); btnAuto.textContent='Auto'; btnAuto.onclick = ()=> restoreKartAuto(kid);
      ctr.appendChild(btnNum); ctr.appendChild(btnScore); ctr.appendChild(btnAuto);
      box.appendChild(ctr);

      col.appendChild(box);
    });

    const addBtn = document.createElement('button'); addBtn.className='add-btn'; addBtn.textContent='+ Add (team enters this row)'; addBtn.onclick = ()=> handleRowAdd(r);
    col.appendChild(addBtn);
    cont.appendChild(col);
  }
}

function renderSidebar(){
  const ks = document.getElementById('kartScoresList');
  ks.innerHTML = '';
  const arr = Object.values(karts).slice().sort((a,b)=> (b.score||0) - (a.score||0));
  arr.forEach(k=>{
    const d = document.createElement('div');
    d.textContent = `Kart ${k.id} | label:${k.label||'-'} | score:${k.score!=null?k.score:'-'} ${k.manualMode?'(M)':''}`;
    ks.appendChild(d);
  });

  const tl = document.getElementById('teamList');
  tl.innerHTML = '';
  Object.keys(teams).sort((a,b)=>parseInt(a)-parseInt(b)).forEach(tn=>{
    const t = teams[tn];
    const div = document.createElement('div');
    div.textContent = `Team ${tn} → kart:${t.currentKartId||'-'} prev:${t.previousKartId||'-'} ${t.excluded?'[EXCL]':''}`;
    tl.appendChild(div);
  });
}

function renderAll(){
  renderLiveTable();
  renderPit();
  renderSidebar();
}

// ---------- Core: fetch -> parse -> integrate ----------
async function fetchOnce(){
  const url = document.getElementById('apexUrl').value.trim();
  if(!url){ setStatus('No Apex URL'); return; }
  setStatus('Fetching Apex...');
  const html = await proxyFetch(url);
  if(!html){ setStatus('Fetch failed'); return; }
  const rows = parseApexHtml(html);
  if(rows.length === 0){ setStatus('Parsed no timing rows'); renderAll(); return; }
  integrateLiveRows(rows);
  setStatus(`Fetched ${rows.length} timing rows @ ${new Date().toLocaleTimeString()}`);
}

// ---------- Polling control ----------
function startPolling(){
  pollSeconds = Math.max(2, parseInt(document.getElementById('pollSeconds').value) || 5);
  if(pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(fetchOnce, pollSeconds * 1000);
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
  setStatus('Polling started');
  fetchOnce();
}
function stopPolling(){
  if(pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  setStatus('Polling stopped');
}

// ---------- Export ----------
function exportJSON(){
  const data = { pitRows, karts, teams, liveTiming };
  const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'kart_tracker_export.json'; a.click();
}

// ---------- Wiring ----------
document.getElementById('setupBtn').onclick = ()=> setupPitRowsUI();
document.getElementById('startBtn').onclick = ()=> startPolling();
document.getElementById('stopBtn').onclick = ()=> stopPolling();
document.getElementById('fetchOnceBtn').onclick = ()=> fetchOnce();
document.getElementById('exportBtn').onclick = ()=> exportJSON();
document.getElementById('resetColorsBtn').onclick = ()=> {
  Object.values(karts).forEach(k => { k.manualMode = false; k.manualScore = null; });
  recomputeScoring(); renderAll();
};

// ---------- Initial setup ----------
window.addEventListener('load', ()=>{
  setupPitRowsUI();
  renderAll();
  setStatus('Ready. Configure rows and paste Apex link.');
});
