/* --------------------------------------------
   GLOBAL DATA STRUCTURES
--------------------------------------------- */
let kartScores = {};     // { transponder: {number, score, color, manual:boolean} }
let raceTracking = {};   // { teamNumber: { kartId, lastScore } }

let pitRows = [
  [], // Row 1
  [], // Row 2
  []  // Row 3
];

/* Colors by score */
function getScoreColor(score) {
  if(score === null || score === undefined) return "blue";
  if(score < 60) return "red";
  if(score < 70) return "orange";
  if(score < 80) return "yellow";
  if(score < 90) return "green";
  return "purple";
}

/* --------------------------------------------
   TEST MODE DATA
--------------------------------------------- */
const dummyKartData = [
  { number: '1', transponder: 'T1', lapTime: 72.3 },
  { number: '2', transponder: 'T2', lapTime: 74.1 },
  { number: '3', transponder: 'T3', lapTime: 70.5 },
  { number: '1', transponder: 'T1', lapTime: 71.8 },
  { number: '2', transponder: 'T2', lapTime: 73.5 },
  { number: '3', transponder: 'T3', lapTime: 69.9 },
  { number: '1', transponder: 'T1', lapTime: 72.0 },
  { number: '2', transponder: 'T2', lapTime: 75.0 },
  { number: '3', transponder: 'T3', lapTime: 70.2 }
];

function simulateApexFetch() {
  dummyKartData.forEach(k => updateKartFromLap(k.number, k.transponder, k.lapTime));
  renderEverything();
}

/* --------------------------------------------
   LIVE APEX TIMING FETCH
--------------------------------------------- */
async function fetchApexData() {
  let url = document.getElementById("apexUrlInput").value.trim();
  if(!url) {
    alert("Please paste an Apex Timing URL first.");
    return;
  }

  try {
    const res = await fetch(url);
    const text = await res.text();

    // FIND LAP LINES (automatically adapts to Apex format)
    const lapLines = text.match(/(\d+).*(\d+\.\d+)/g);

    if(!lapLines) {
      alert("Could not find lap data — race might not be active.");
      return;
    }

    lapLines.forEach(line => {
      let parts = line.trim().split(/\s+/);
      let number = parts[0];
      let lapTime = parseFloat(parts[parts.length-1]);
      let transponder = "T"+number; // Fallback mapping

      updateKartFromLap(number, transponder, lapTime);
    });

    renderEverything();

  } catch(err) {
    alert("Apex Timing fetch failed.");
  }
}

/* --------------------------------------------
   UPDATE KART PERFORMANCE
--------------------------------------------- */
function updateKartFromLap(number, transponder, lapTime) {
  if(!kartScores[transponder]) {
    kartScores[transponder] = {
      number: number,
      score: lapTime,
      color: getScoreColor(lapTime),
      manual: false
    };
  } else {
    kartScores[transponder].score =
      (kartScores[transponder].score + lapTime)/2;

    if(!kartScores[transponder].manual) {
      kartScores[transponder].color =
        getScoreColor(kartScores[transponder].score);
    }
  }

  raceTracking[number] = {
    kartId: transponder,
    lastScore: kartScores[transponder].score
  };
}

/* --------------------------------------------
   PIT ROW BUTTON LOGIC (+ BUTTON)
--------------------------------------------- */
function addKartToRow(rowIndex) {
  let teamNumber = prompt("Team number entering pits:");

  if(!teamNumber) return;

  let transponder = findKartByTeam(teamNumber);

  if(!transponder) {
    alert("This team has no tracked kart yet.");
    return;
  }

  // 1. Team TAKES first kart
  if(pitRows[rowIndex].length > 0) {
    pitRows[rowIndex].shift();
  }

  // 2. Shift remaining karts forward happens automatically by shift()

  // 3. Add the team’s PREVIOUS kart into the last spot
  pitRows[rowIndex].push(transponder);

  renderPitRows();
}

/* Find kart transponder by team number */
function findKartByTeam(teamNum) {
  for(let t in raceTracking) {
    if(t === teamNum) return raceTracking[t].kartId;
  }
  return null;
}

/* --------------------------------------------
   MANUAL OVERRIDES INSIDE KART BOX
--------------------------------------------- */
function setManualColor(transponder) {
  let c = prompt("Enter color (blue, red, orange, yellow, green, purple):");
  if(!c) return;

  kartScores[transponder].color = c;
  kartScores[transponder].manual = true;

  renderEverything();
}

function setManualNumber(transponder) {
  let n = prompt("Enter new kart/team number:");
  if(!n) return;

  kartScores[transponder].number = n;
  renderEverything();
}

function restoreAutoColor(transponder) {
  kartScores[transponder].manual = false;
  kartScores[transponder].color =
    getScoreColor(kartScores[transponder].score);

  renderEverything();
}

/* --------------------------------------------
   UI RENDERING
--------------------------------------------- */

function renderPitRows() {
  let container = document.getElementById("pitContainer");
  container.innerHTML = "";

  pitRows.forEach((row, i) => {
    let rowDiv = document.createElement("div");
    rowDiv.className = "pit-row";

    row.forEach(transponder => {
      let k = kartScores[transponder];

      let kartDiv = document.createElement("div");
      kartDiv.className = "kart";
      kartDiv.style.background = k.color;
      kartDiv.innerHTML = `
        <div><b>#${k.number}</b></div>
        <div>Score: ${k.score.toFixed(1)}</div>
        <button onclick="setManualColor('${transponder}')">Color</button>
        <button onclick="setManualNumber('${transponder}')">Number</button>
        <button onclick="restoreAutoColor('${transponder}')">AutoColor</button>
      `;
      rowDiv.appendChild(kartDiv);
    });

    // Add + button
    let plus = document.createElement("button");
    plus.innerText = "+ Add Kart";
    plus.onclick = () => addKartToRow(i);
    rowDiv.appendChild(plus);

    container.appendChild(rowDiv);
  });
}

function renderKartScores() {
  let div = document.getElementById("kartScoreList");
  div.innerHTML = "";

  Object.keys(kartScores).forEach(t => {
    let k = kartScores[t];
    let d = document.createElement("div");
    d.className = "scoreEntry";
    d.innerHTML = `Kart ${k.number} (T:${t}) — Score ${k.score.toFixed(1)} — Color: ${k.color}`;
    div.appendChild(d);
  });
}

function renderRaceTracking() {
  let div = document.getElementById("raceTracking");
  div.innerHTML = "";

  Object.keys(raceTracking).forEach(team => {
    let r = raceTracking[team];
    let d = document.createElement("div");
    d.className = "trackEntry";
    d.innerHTML = `Team ${team} → Kart ${r.kartId} — Last Score ${r.lastScore.toFixed(1)}`;
    div.appendChild(d);
  });
}

function renderEverything() {
  renderPitRows();
  renderKartScores();
  renderRaceTracking();
}

/* --------------------------------------------
   EXPORT
--------------------------------------------- */
function exportData() {
  let blob = new Blob([JSON.stringify({kartScores, raceTracking, pitRows}, null, 2)], 
                      {type : 'application/json'});
  let url = URL.createObjectURL(blob);

  let a = document.createElement("a");
  a.href = url;
  a.download = "race_data.json";
  a.click();
}
