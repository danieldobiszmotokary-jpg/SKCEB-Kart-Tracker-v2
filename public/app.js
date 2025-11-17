/* ===========================================
   SKCEB Kart Tracker — Final (app.js)
   - Polls Apex Timing via /proxy?url=...
   - Parses lap rows heuristically
   - Builds per-transponder lap history and per-team cumulative scores
   - Pit visualization: rows, vertical karts, + button, manual color/number
   - When no incoming data, + adds blue kart for testing
   =========================================== */

/* -------------------------
   Config / runtime state
   ------------------------- */
let pollTimer = null;
let pollIntervalMs = 4000;
let lastApexHtml = '';
let apexUrl = '';

/* lap tracking */
const transponderLaps = {}; // transponderId/string -> [{lapNumber, time, timestamp, teamName, stint}]
const kartScores = {};      // kartNumber (string) -> latest score (float)
const teamProfiles = {};    // teamName -> { totalScore, count } (cumulative across stints)

/* pit slots structure: pitSlots[row] = [{ slot: KartSlot, btnContainer: HTMLElement }] */
let pitSlots = [];

/* manual override map: kept per slot via slot.manualOverride */

/* -------------------------
   Utilities
   ------------------------- */
function parseSeconds(t) {
  if (!t) return null;
  t = t.trim();
  if (t.includes(':')) {
    const parts = t.split(':');
    if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  }
  const f = parseFloat(t.replace(',', '.'));
  return isNaN(f) ? null : f;
}

function getColorFromScore(score) {
  if (score === undefined || score === null) return 'blue';
  if (score >= 900) return 'purple';
  if (score >= 750) return 'green';
  if (score >= 600) return 'yellow';
  if (score >= 500) return 'orange';
  return 'red';
}

/* -------------------------
   Apex parsing & scoring
   ------------------------- */

async function fetchApexHtml(url) {
  try {
    const resp = await fetch('/proxy?url=' + encodeURIComponent(url));
    if (!resp.ok) throw new Error('fetch failed');
    return await resp.text();
  } catch (e) {
    console.error('fetchApexHtml', e && e.message);
    return null;
  }
}

/* Heuristic parser for Apex timing pages.
   It tries to extract rows containing a kart/transponder number and lap time.
   Returns array of objects: {number: '12', lapTime: '1:05.23', team: 'Team X' (if available), rawCols: []}
*/
function parseApexHtmlForLaps(html) {
  const rows = [];
  if (!html) return rows;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Common patterns: table rows with lap data
  const candidateTables = Array.from(doc.querySelectorAll('table')).slice(0, 6);

  candidateTables.forEach(table => {
    Array.from(table.querySelectorAll('tr')).forEach(tr => {
      const tds = Array.from(tr.querySelectorAll('td'));
      if (tds.length < 2) return;
      const cols = tds.map(td => td.textContent.trim());
      const text = cols.join(' | ');

      // find time like mm:ss.xx or s.ss
      const timeMatch = text.match(/(\d{1,2}:\d{2}\.\d{2})|(\d+\.\d{2})/);
      const numberMatch = text.match(/\b\d{1,4}\b/);
      if (timeMatch && numberMatch) {
        // try to find a team/driver string heuristically (long text piece without numbers)
        let team = null;
        const teamCandidate = cols.find(c => c.length > 2 && !/\d/.test(c));
        if (teamCandidate) team = teamCandidate;
        rows.push({ number: numberMatch[0], lapTime: timeMatch[0], team, rawCols: cols });
      }
    });
  });

  // fallback: look for elements with class names used by Apex
  if (rows.length === 0) {
    const rowsEls = doc.querySelectorAll('.lap, .lap-row, .live-lap-row, .live-lap');
    rowsEls.forEach(el => {
      const txt = el.textContent.trim();
      const timeMatch = txt.match(/(\d{1,2}:\d{2}\.\d{2})|(\d+\.\d{2})/);
      const numberMatch = txt.match(/\b\d{1,4}\b/);
      if (timeMatch && numberMatch) rows.push({ number: numberMatch[0], lapTime: timeMatch[0], team: null, rawCols: [txt] });
    });
  }

  return rows;
}

function addLapToTransponder(id, timeSec, teamName = null) {
  if (!id) return;
  if (!transponderLaps[id]) transponderLaps[id] = [];
  const laps = transponderLaps[id];
  const lapNumber = laps.length ? laps[laps.length - 1].lapNumber + 1 : 1;
  laps.push({ lapNumber, time: timeSec, timestamp: Date.now(), teamName, stint: 1 });
  // keep only recent 200 laps to avoid memory growth
  if (laps.length > 200) transponderLaps[id] = laps.slice(-200);
}

function updateTeamProfilesFromTransponders() {
  // compute per-transponder recent avg and update teamProfiles
  Object.keys(transponderLaps).forEach(tid => {
    const laps = transponderLaps[tid];
    if (!laps || laps.length < 2) return;
    const recent = laps.slice(-10);
    const avg = recent.reduce((s, x) => s + x.time, 0) / recent.length;
    const team = (recent[0] && recent[0].teamName) || null;
    if (!team) return;
    if (!teamProfiles[team]) teamProfiles[team] = { totalScore: 0, count: 0 };
    // For team profile we store avg as score-like value (lower lap -> better)
    // Convert avg lap to inverted score: higher better. Simple transform:
    const score = Math.max(0, 1000 - avg * 6); // tuning param: 6
    teamProfiles[team].totalScore += score;
    teamProfiles[team].count += 1;
  });

  // derive teamScores average
  Object.keys(teamProfiles).forEach(team => {
    const p = teamProfiles[team];
    teamProfiles[team].avgScore = p.count ? p.totalScore / p.count : null;
  });
}

/* compute kartScores mapping by using transponder data and simple formula */
function computeKartScores() {
  // For each transponder, compute a score and map to kart number (if possible)
  Object.keys(transponderLaps).forEach(tid => {
    const laps = transponderLaps[tid];
    if (!laps || laps.length < 2) return;
    const recent = laps.slice(-8);
    const avg = recent.reduce((s, x) => s + x.time, 0) / recent.length;
    const std = Math.sqrt(recent.reduce((s, x) => s + Math.pow(x.time - avg, 2), 0) / recent.length);
    const best = Math.min(...recent.map(x => x.time));
    // Score formula (tunable)
    const score = 500 + (200 * (60 / Math.max(avg, 1))) - std * 20 + (60 / Math.max(best, 1)) * 30;
    // Try to map transponder to kart number: check most recent lap raw team/number info if present
    const last = laps[laps.length - 1];
    const mapKey = tid.toString(); // store by transponder id
    // store as kartScores by transponder id string
    kartScores[mapKey] = { score, avg, std, best, lastTeam: last.teamName || null };
  });

  // Also compute teamProfiles
  // updateTeamProfilesFromTransponders(); // optional: commented, using teamProfiles updated elsewhere
}

/* -------------------------
   Pit visualization and UI
   ------------------------- */

/* create a kart slot object */
function createKartSlot(kartNumber = '', teamId = '', color = 'blue') {
  const kartDiv = document.createElement('div');
  kartDiv.className = 'kart';
  kartDiv.textContent = kartNumber || '?';
  kartDiv.style.background = color;

  return {
    kartNumber: kartNumber || '',
    teamId: teamId || '',
    color,
    manualOverride: false,
    div: kartDiv
  };
}

/* set up pit rows (UI + pitSlots array) */
function setupPitRows() {
  const container = document.getElementById('pitContainer');
  container.innerHTML = '';
  pitSlots = [];

  const numRows = Math.max(1, parseInt(document.getElementById('numRows').value) || 3);
  const kartsPerRow = Math.max(1, parseInt(document.getElementById('kartsPerRow').value) || 3);

  for (let r = 0; r < numRows; r++) {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'row';
    const rowArr = [];

    for (let k = 0; k < kartsPerRow; k++) {
      const slot = createKartSlot('', '', 'blue');

      // create buttons container
      const btnContainer = document.createElement('div');
      btnContainer.className = 'kart-btns';

      const colorBtn = document.createElement('button');
      colorBtn.className = 'color-btn';
      colorBtn.textContent = 'Color';
      colorBtn.onclick = () => manualColorChange(r, k);

      const numBtn = document.createElement('button');
      numBtn.className = 'num-btn';
      numBtn.textContent = 'Number';
      numBtn.onclick = () => manualNumberChange(r, k);

      btnContainer.appendChild(colorBtn);
      btnContainer.appendChild(numBtn);

      // append to DOM
      rowDiv.appendChild(slot.div);
      rowDiv.appendChild(btnContainer);

      rowArr.push({ slot, btnContainer });
    }

    const plusBtn = document.createElement('button');
    plusBtn.textContent = '+';
    plusBtn.onclick = () => addNewKartToRow(r);
    rowDiv.appendChild(plusBtn);

    container.appendChild(rowDiv);
    pitSlots.push(rowArr);
  }

  setStatus(`Pit rows created: ${pitSlots.length} rows`);
}

/* add new kart to a row — removes first, shifts others, inserts blue if no incoming data */
function addNewKartToRow(rowIdx) {
  const row = pitSlots[rowIdx];
  const rowDiv = document.getElementById('pitContainer').children[rowIdx];
  const plusBtn = rowDiv.querySelector('button:last-child');

  if (!row || row.length === 0) return;

  // remove first slot + buttons
  const firstUnit = row.shift();
  firstUnit.slot.div.remove();
  firstUnit.btnContainer.remove();

  // Try to detect incoming kart from latest Apex data (not implemented automatically here).
  // For testing/no-data: add a blue unknown kart.
  const newKartNumber = ''; // leave blank -> displays '?'
  const newSlot = createKartSlot(newKartNumber, '', 'blue');

  // create btn container for new slot
  const btnContainer = document.createElement('div');
  btnContainer.className = 'kart-btns';
  const colorBtn = document.createElement('button');
  colorBtn.className = 'color-btn';
  colorBtn.textContent = 'Color';
  colorBtn.onclick = () => manualColorChange(rowIdx, row.length);
  const numBtn = document.createElement('button');
  numBtn.className = 'num-btn';
  numBtn.textContent = 'Number';
  numBtn.onclick = () => manualNumberChange(rowIdx, row.length);
  btnContainer.appendChild(colorBtn);
  btnContainer.appendChild(numBtn);

  // insert before plusBtn
  rowDiv.insertBefore(newSlot.div, plusBtn);
  rowDiv.insertBefore(btnContainer, plusBtn);

  row.push({ slot: newSlot, btnContainer });
}

/* Manual color override (works on any device) */
function manualColorChange(rowIdx, slotIdx) {
  const row = pitSlots[rowIdx];
  if (!row || !row[slotIdx]) return;
  const slot = row[slotIdx].slot;
  const colors = ['blue','red','orange','yellow','green','purple'];
  const current = slot.color || 'blue';
  const ask = prompt(`Enter color (${colors.join(', ')}):`, current);
  if (ask && colors.includes(ask)) {
    slot.color = ask;
    slot.manualOverride = true;
    slot.div.style.background = ask;
  }
}

/* Manual number change (works on any device) */
function manualNumberChange(rowIdx, slotIdx) {
  const row = pitSlots[rowIdx];
  if (!row || !row[slotIdx]) return;
  const slot = row[slotIdx].slot;
  const newNum = prompt('Enter kart number (team fixed ID):', slot.kartNumber || '');
  if (newNum !== null) {
    slot.kartNumber = newNum;
    slot.div.textContent = newNum || '?';
    // If we have a known score for that kart number, update color automatically (unless overridden)
    if (!slot.manualOverride && newNum && kartScores[newNum]) {
      slot.color = getColorFromScore(kartScores[newNum].score || kartScores[newNum]);
      slot.div.style.background = slot.color;
    }
  }
}

/* synchronize pit slot colors with scoring data (call whenever scores update) */
function refreshPitColors() {
  pitSlots.forEach((row, rIdx) => {
    row.forEach((unit, sIdx) => {
      const slot = unit.slot;
      if (slot.manualOverride) return; // don't override manual choice
      // priority: kartNumber -> teamId -> unknown
      if (slot.kartNumber && kartScores[slot.kartNumber]) {
        const v = kartScores[slot.kartNumber];
        const score = typeof v === 'object' ? v.score : v;
        slot.color = getColorFromScore(score);
      } else if (slot.teamId && teamProfiles[slot.teamId] && teamProfiles[slot.teamId].avgScore) {
        slot.color = getColorFromScore(teamProfiles[slot.teamId].avgScore);
      } else {
        slot.color = 'blue';
      }
      unit.slot.div.style.background = slot.color;
    });
  });
}

/* -------------------------
   Polling loop
   ------------------------- */

async function pollApexAndProcess() {
  if (!apexUrl) return;
  setStatus('Fetching Apex...');
  const html = await fetchApexHtml(apexUrl);
  if (!html) {
    setStatus('Fetch failed');
    return;
  }
  if (html === lastApexHtml) {
    setStatus('No change');
    return;
  }
  lastApexHtml = html;

  // parse
  const rows = parseApexHtmlForLaps(html);

  // Add rows to transponderLaps — heuristic mapping: number -> transponder id string
  rows.forEach(r => {
    const id = r.number.toString();
    const t = parseSeconds(r.lapTime);
    addLapToTransponder(id, t, r.team || null);
    // also, if we have slot with kartNumber equals id, update quick kartScores mapping
  });

  // compute scores
  computeKartScores();

  // Map kartScores by simple key: number strings (transponder id used here)
  // If your Apex provides separate transponder id vs shown kart number, you might need to tweak parser.
  // For display, we'll set kartScores[kartNumberString] = number.score
  Object.keys(kartScores).forEach(k => {
    const v = kartScores[k];
    // try to set simple numeric key as well
    kartScores[k] = v; // already stored by transponder id
  });

  // update any pit slots whose kartNumber matches a tracked id
  pitSlots.forEach(row => {
    row.forEach(unit => {
      const s = unit.slot;
      if (s.manualOverride) return;
      // if slot.kartNumber matches a tracked transponder id
      if (s.kartNumber && kartScores[s.kartNumber]) {
        const obj = kartScores[s.kartNumber];
        const score = typeof obj === 'object' ? obj.score : obj;
        s.color = getColorFromScore(score);
        s.div.style.background = s.color;
      }
    });
  });

  setStatus(`Updated ${new Date().toLocaleTimeString()}`);
}

/* start/stop polling */
function startPolling() {
  const url = document.getElementById('apexUrl').value.trim();
  if (!url) { alert('Paste an Apex Timing URL first'); return; }
  apexUrl = url;
  const sec = Math.max(2, parseInt(document.getElementById('pollSec').value) || 4);
  pollIntervalMs = sec * 1000;
  if (pollTimer) clearInterval(pollTimer);
  // first immediate poll
  pollApexAndProcess();
  pollTimer = setInterval(pollApexAndProcess, pollIntervalMs);
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
  setStatus('Polling started');
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  setStatus('Polling stopped');
}

/* -------------------------
   UI helpers
   ------------------------- */
function setStatus(s) {
  document.getElementById('status').textContent = s;
}

/* -------------------------
   Wire up UI events
   ------------------------- */
document.getElementById('setupBtn').onclick = setupPitRows;
document.getElementById('startBtn').onclick = startPolling;
document.getElementById('stopBtn').onclick = stopPolling;
document.getElementById('exportBtn').onclick = () => {
  console.log('Pit Slots:', pitSlots.map(r => r.map(u => ({ num: u.slot.kartNumber, color: u.slot.color, team: u.slot.teamId }))));
  alert('Slot mapping exported to console');
};
document.getElementById('resetSlotsBtn').onclick = () => {
  document.getElementById('pitContainer').innerHTML = '';
  pitSlots = [];
  setStatus('Slots cleared');
};

/* expose some debug for console */
window._SKCEB = { pitSlots, transponderLaps, kartScores, teamProfiles, computeKartScores, refreshPitColors };
