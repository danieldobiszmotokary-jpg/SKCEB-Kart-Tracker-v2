// -----------------------------
// SKCEB Kart Tracker - final app.js
// Fully self-contained client logic (UI + data + parser + scoring)
// -----------------------------

// ---------- Config ----------
let numRows = 3;
let kartsPerRow = 3;
let pollSeconds = 5;
let pollTimer = null;
const MAX_RECENT = 12; // laps to keep per kart for scoring
const ADAPTIVE_FACTOR = 2.8; // outlier threshold multiplier (higher -> more tolerant)

// ---------- Data models ----------
const pitRows = []; // pitRows[r] = [ kartId, kartId, ... ] (each row independent)
const karts = {};   // karts[kartId] = { id, label, score, laps:[], color, manualColor:false }
const teams = {};   // teams[teamNumber] = { number, transponder, currentKartId }

// ---------- Utilities ----------
function genKartId() {
  return 'K' + Math.random().toString(36).slice(2,9);
}
function setStatus(s){ document.getElementById('status').textContent = s; }
function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }

// Color helper based on score (higher better)
function scoreToColor(score){
  if(score == null) return 'blue';
  if(score >= 90) return 'purple';
  if(score >= 80) return 'green';
  if(score >= 70) return 'yellow';
  if(score >= 60) return 'orange';
  return 'red';
}

// Apply color classes
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

// ---------- Initialize / Setup ----------
function setupPitRowsUI(){
  numRows = parseInt(document.getElementById('numRows').value) || 3;
  kartsPerRow = parseInt(document.getElementById('kartsPerRow').value) || 3;

  // reset data
  pitRows.length = 0;
  // Keep existing karts if they exist; otherwise create new unknown karts
  const existingKartIds = Object.keys(karts);
  let idxExisting = 0;

  for(let r=0;r<numRows;r++){
    pitRows[r] = [];
    for(let s=0;s<kartsPerRow;s++){
      let kartId = genKartId();
      // create physical kart record
      karts[kartId] = { id:kartId, label:'', score:null, laps:[], color:'blue', manualColor:false };
      pitRows[r].push(kartId);
    }
  }
  renderEverything();
  setStatus(`Setup ${numRows} rows × ${kartsPerRow} karts`);
}

// ---------- Kart scoring ----------
function addLapToKart(kartId, lapSec){
  if(!karts[kartId]) return;
  // adaptive validation: compute median of existing recent laps across all karts as baseline
  const allRecent = [];
  for(const k in karts){
    karts[k].laps.slice(-MAX_RECENT).forEach(v=>allRecent.push(v));
  }
  let median = null;
  if(allRecent.length){
    const sorted = allRecent.slice().sort((a,b)=>a-b);
    median = sorted[Math.floor(sorted.length/2)];
  }

  // if lap is obviously invalid (very large) OR extremely deviant from median, ignore
  if(lapSec > 300) { // clearly garbage >5min
    console.warn('Ignored lap >300s', kartId, lapSec);
    return;
  }
  if(median !== null){
    const diff = Math.abs(lapSec - median);
    const mad = Math.max(1, Math.abs(median*0.15)); // fallback
    if(diff > ADAPTIVE_FACTOR * mad){
      console.warn('Ignored outlier lap', kartId, lapSec, 'median', median);
      return;
    }
  }

  const arr = karts[kartId].laps;
  arr.push(lapSec);
  if(arr.length > 200) arr.shift();

  // compute score: inverted lap to make higher = better, scaled 0-100-ish
  const recent = arr.slice(-MAX_RECENT);
  const avg = recent.reduce((s,x)=>s+x,0)/recent.length;
  // scale: make smaller lap -> higher score: use baseline 60s to 100 scale (tunable)
  // score = max(0, 120 - avg) for 1:00 => 60
  let score = Math.max(0, 120 - avg); // this yields higher better; tune per use
  // normalize somewhat -> cap at ~100
  score = clamp(score, 0, 120);
  karts[kartId].score = score;
  // auto-color if not manual override
  if(!karts[kartId].manualColor){
    karts[kartId].color = scoreToColor(score);
  }
}

// ---------- Apex parser (robust / adaptive) ----------
async function fetchApexHtml(url){
  try{
    const resp = await fetch('/proxy-fetch', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ url })
    });
    const j = await resp.json();
    if(!j.success) throw new Error('proxy failed');
    return j.html;
  }catch(e){
    console.error('fetchApexHtml', e);
    return null;
  }
}

// Heuristic parse: return array [{teamNumber, lapSec}]
function parseApexHtml(html){
  if(!html) return [];
  // Create a DOM parser
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const out = [];

  // 1) Attempt to find table rows with numbers and times
  const tables = Array.from(doc.querySelectorAll('table'));
  for(const table of tables){
    const rows = Array.from(table.querySelectorAll('tr'));
    rows.forEach(tr=>{
      const tds = Array.from(tr.querySelectorAll('td')).map(td=>td.textContent.trim());
      if(tds.length >= 2){
        // find time-like value
        const timeIdx = tds.findIndex(t => /\d{1,2}:\d{2}\.\d{1,3}|\d+\.\d{1,3}/.test(t));
        const numIdx = tds.findIndex(t => /\b\d{1,4}\b/.test(t));
        if(timeIdx !== -1 && numIdx !== -1){
          const rawTime = tds[timeIdx].match(/(\d{1,2}:\d{2}\.\d{1,3}|\d+\.\d{1,3})/)[0];
          const lapSec = parseTimeToSec(rawTime);
          const teamNumber = tds[numIdx].match(/\d{1,4}/)[0];
          out.push({ teamNumber, lapSec, raw:tds });
        }
      }
    });
    if(out.length) break;
  }

  // 2) fallback: search for elements with time-like text
  if(out.length === 0){
    const candidate = Array.from(doc.querySelectorAll('div,span,li'));
    candidate.forEach(el=>{
      const txt = el.textContent.trim();
      const timeMatch = txt.match(/(\d{1,2}:\d{2}\.\d{1,3}|\b\d+\.\d{1,3}\b)/);
      const numMatch = txt.match(/\b\d{1,4}\b/);
      if(timeMatch && numMatch){
        out.push({ teamNumber: numMatch[0], lapSec: parseTimeToSec(timeMatch[0]), raw:[txt] });
      }
    });
  }

  // remove duplicates and invalids
  const cleaned = [];
  const seen = new Set();
  for(const r of out){
    if(!r.teamNumber || !r.lapSec) continue;
    const key = r.teamNumber + '|' + r.lapSec.toFixed(2);
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
    const m = parseInt(parts[0],10);
    const s = parseFloat(parts[1]);
    return m*60 + s;
  } else {
    return parseFloat(t);
  }
}

// ---------- Mapping laps to karts ----------
function processApexRows(parsedRows){
  // parsedRows: [{teamNumber, lapSec}]
  parsedRows.forEach(r=>{
    const team = r.teamNumber.toString();
    // If team exists and has currentKartId, map lap to that kart
    if(teams[team] && teams[team].currentKartId){
      addLapToKart(teams[team].currentKartId, r.lapSec);
    } else {
      // optionally, if team unknown, create a team and leave currentKartId null
      if(!teams[team]) teams[team] = { number: team, transponder: team, currentKartId: null };
      // we will not assign laps until they take a kart
    }
  });
}

// ---------- UI: renderers ----------
function renderPit(){
  const c = document.getElementById('pitContainer');
  c.innerHTML = '';
  for(let r=0;r<pitRows.length;r++){
    const col = document.createElement('div');
    col.className = 'pit-column';
    const title = document.createElement('div');
    title.style.fontWeight='700';
    title.style.marginBottom='6px';
    title.textContent = `Row ${r+1}`;
    col.appendChild(title);

    // show karts top->bottom
    pitRows[r].forEach((kartId, idx)=>{
      const k = karts[kartId];
      const box = document.createElement('div');
      box.className = 'kart-box ' + colorClass(k.color);
      const label = document.createElement('div');
      label.innerHTML = `<div style="font-size:14px">${k.label|| '?'} </div><div style="font-size:12px">Score: ${k.score?Math.round(k.score):'—'}</div>`;
      box.appendChild(label);

      // manual controls (big enough for mobile)
      const controls = document.createElement('div');
      controls.className = 'kart-controls';

      // color select (with Auto option)
      const colorSelect = document.createElement('select');
      const options = [
        {v:'',t:'Auto'},
        {v:'blue',t:'Blue'},
        {v:'purple',t:'Purple'},
        {v:'green',t:'Green'},
        {v:'yellow',t:'Yellow'},
        {v:'orange',t:'Orange'},
        {v:'red',t:'Red'}
      ];
      options.forEach(op=>{
        const o = document.createElement('option');
        o.value = op.v;
        o.textContent = op.t;
        colorSelect.appendChild(o);
      });
      colorSelect.value = k.manualColor? k.color : '';
      colorSelect.onchange = () => {
        const v = colorSelect.value;
        if(!v){
          k.manualColor = false;
          k.color = scoreToColor(k.score);
        } else {
          k.manualColor = true;
          k.color = v;
        }
        renderPit();
        renderSidebar();
      };
      controls.appendChild(colorSelect);

      // number input
      const numInp = document.createElement('input');
      numInp.type='text';
      numInp.placeholder='team#';
      numInp.value = k.label||'';
      numInp.onchange = () => {
        const val = numInp.value.trim();
        k.label = val;
        // If this number corresponds to a team, map team.currentKartId
        if(val){
          if(!teams[val]) teams[val] = { number: val, transponder: val, currentKartId: null };
          teams[val].currentKartId = kartId;
        }
        renderSidebar();
      };
      numInp.style.minWidth='68px';
      controls.appendChild(numInp);

      // replace button
      const repBtn = document.createElement('button');
      repBtn.textContent = 'Replace';
      repBtn.onclick = () => {
        // replace this kart with known or unknown
        const known = confirm('Replace with a known kart (OK) or unknown kart (Cancel)?');
        if(known){
          const existingId = prompt('Enter existing kartId to place here (exact):');
          if(existingId && karts[existingId]){
            // swap: keep same position but replace record
            const newId = existingId;
            // remove newId from any row where it currently is
            removeKartFromRows(newId);
            // place newId in this position in current row
            pitRows[r][idx] = newId;
            renderPit(); renderSidebar();
            return;
          } else {
            alert('Kart id not found.');
          }
        } else {
          // create unknown kart and put here
          const newK = genKartId();
          karts[newK] = { id:newK, label:'', score:null, laps:[], color:'blue', manualColor:false };
          pitRows[r][idx] = newK;
          renderPit(); renderSidebar();
          return;
        }
      };
      controls.appendChild(repBtn);

      // restore color to auto
      const autoBtn = document.createElement('button');
      autoBtn.textContent = 'Auto';
      autoBtn.onclick = () => {
        k.manualColor = false;
        k.color = scoreToColor(k.score);
        renderPit(); renderSidebar();
      };
      controls.appendChild(autoBtn);

      box.appendChild(controls);

      col.appendChild(box);
    });

    // + Add Kart button for this row
    const addBtn = document.createElement('button');
    addBtn.className = 'add-btn';
    addBtn.textContent = '+ Add (Team enters this row)';
    addBtn.onclick = () => handleRowAdd(r);
    col.appendChild(addBtn);

    c.appendChild(col);
  }
}

function removeKartFromRows(kid){
  for(let r=0;r<pitRows.length;r++){
    pitRows[r] = pitRows[r].filter(x => x !== kid);
  }
}

// Render sidebar (scores & teams)
function renderSidebar(){
  const ks = document.getElementById('kartScoresList');
  ks.innerHTML = '';
  Object.values(karts).forEach(k=>{
    const d = document.createElement('div');
    d.textContent = `Kart ${k.id} | label:${k.label||'-'} | score:${k.score?Math.round(k.score):'-'} | color:${k.color}${k.manualColor?' (M)':''}`;
    ks.appendChild(d);
  });

  const tl = document.getElementById('teamList');
  tl.innerHTML = '';
  Object.keys(teams).forEach(t=>{
    const tt = teams[t];
    const d = document.createElement('div');
    d.textContent = `Team ${t} → kart:${tt.currentKartId||'-'}`;
    tl.appendChild(d);
  });
}

function renderEverything(){ renderPit(); renderSidebar(); }

// ---------- Row Add logic (team enters row r) ----------
function handleRowAdd(rowIndex){
  const teamNumber = prompt('Enter team number (transponder+number pair):');
  if(!teamNumber) return;

  // Ensure team record exists
  if(!teams[teamNumber]) teams[teamNumber] = { number: teamNumber, transponder: teamNumber, currentKartId: null };

  // 1) Team takes the first kart in this row (if exists)
  const row = pitRows[rowIndex];
  if(row.length === 0){
    alert('Row empty.');
    return;
  }

  const takenKartId = row.shift(); // first removed - team will take this physical kart
  // Assign to team
  teams[teamNumber].currentKartId = takenKartId;
  // label kart with team's number (teams track pair)
  karts[takenKartId].label = teamNumber;

  // 2) Team's previous kart (if any) goes to end of this same row
  const prev = teams[teamNumber].previousKartId;
  if(prev && karts[prev]){
    // remove prev from any row
    removeKartFromRows(prev);
    row.push(prev);
  } else {
    // if no prev, we do not push anything (this was the first pit for this team)
  }

  // Update previousKartId to the kart they just took (for next time)
  teams[teamNumber].previousKartId = takenKartId;

  // If the kart they took had existing score, keep it. If unknown, leave blue.
  // Render
  renderEverything();
  setStatus(`Team ${teamNumber} took kart ${takenKartId} in row ${rowIndex+1}`);
}

// ---------- Export ----------
function exportJSON(){
  const data = { pitRows, karts, teams };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'pit_mapping.json'; a.click();
}

// ---------- Apex poll loop ----------
async function doPollOnce(){
  const url = document.getElementById('apexUrl').value.trim();
  if(!url){ setStatus('No Apex URL'); return; }
  setStatus('Fetching Apex...');
  const html = await fetchApexHtml(url);
  if(!html){ setStatus('Fetch failed'); return; }
  const rows = parseApexHtml(html);
  if(rows.length === 0){ setStatus('No lap rows parsed'); return; }
  processApexRows(rows);
  renderEverything();
  setStatus(`Updated ${new Date().toLocaleTimeString()} (${rows.length} rows)`);
}

// Start/stop polling
function startPolling(){
  pollSeconds = parseInt(document.getElementById('pollSeconds').value) || 5;
  if(pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(doPollOnce, pollSeconds*1000);
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
  setStatus('Polling started');
  // one immediate poll
  doPollOnce();
}
function stopPolling(){
  if(pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  setStatus('Polling stopped');
}

// ---------- Test mode (dummy data) ----------
const dummy = [
  { teamNumber:'1', lap:72.3 },
  { teamNumber:'2', lap:74.1 },
  { teamNumber:'3', lap:70.5 },
  { teamNumber:'1', lap:71.8 },
  { teamNumber:'2', lap:73.5 },
  { teamNumber:'3', lap:69.9 },
  { teamNumber:'1', lap:72.0 },
  { teamNumber:'2', lap:75.0 },
  { teamNumber:'3', lap:70.2 }
];

function simulateTest(){
  // ensure some teams exist
  dummy.forEach(d=>{
    if(!teams[d.teamNumber]) teams[d.teamNumber] = { number:d.teamNumber, transponder:d.teamNumber, currentKartId:null, previousKartId:null };
  });
  // ensure some pit rows exist; if empty create default
  if(pitRows.length === 0) {
    document.getElementById('numRows').value = 3;
    document.getElementById('kartsPerRow').value = 3;
    setupPitRowsUI();
  }
  // assign each team to first available kart (simulate they started on track)
  let assigned=0;
  Object.keys(teams).forEach(team=>{
    // create a kart for them and set as previous kart (on track)
    const p = genKartId();
    karts[p] = { id:p, label:team, score:null, laps:[], color:'blue', manualColor:false };
    teams[team].currentKartId = p;
    teams[team].previousKartId = p;
    assigned++;
  });
  // now feed dummy laps: map to teams' current kart
  dummy.forEach(d=>{
    const t = teams[d.teamNumber];
    if(!t) return;
    if(!t.currentKartId) return;
    addLapToKart(t.currentKartId, d.lap);
  });
  renderEverything();
  setStatus('Test data loaded');
}

// ---------- Initialization and wiring ----------
document.getElementById('setupBtn').onclick = ()=>{ setupPitRowsUI(); };
document.getElementById('startBtn').onclick = ()=>{ startPolling(); };
document.getElementById('stopBtn').onclick = ()=>{ stopPolling(); };
document.getElementById('testBtn').onclick = ()=>{ simulateTest(); };
document.getElementById('exportBtn').onclick = ()=>{ exportJSON(); };
document.getElementById('pollSeconds').onchange = ()=>{ /* nothing */ };

// On load: initial setup
window.addEventListener('load', ()=>{
  // initialize pitRows array
  // default setup uses values in inputs
  setupPitRowsUI();
});
