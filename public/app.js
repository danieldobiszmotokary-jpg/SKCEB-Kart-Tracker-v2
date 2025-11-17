let pitRows = [];
let kartScores = {};
let raceTracking = {};
const NUM_ROWS = 3;
const KARTS_PER_ROW = 3;
const REFRESH_INTERVAL = 5000; // auto refresh every 5s

// Initialize pit rows
for (let i = 0; i < NUM_ROWS; i++) {
    pitRows[i] = [];
    for (let j = 0; j < KARTS_PER_ROW; j++) {
        // Unknown kart at start
        let tempId = `R${i+1}K${j+1}`;
        pitRows[i].push({ id: tempId, number: null, transponder: null, score: 0, color: 'blue', manual: false });
    }
}

function renderPitRows() {
    const container = document.getElementById('pit-rows');
    container.innerHTML = '';
    pitRows.forEach((row, rowIndex) => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'pit-row';
        row.forEach(kart => {
            const kartDiv = document.createElement('div');
            kartDiv.className = `kart-box ${kart.color}`;
            kartDiv.innerHTML = `${kart.number || '?'}<br>${kart.score}`;
            if(kart.manual) {
                const manualSpan = document.createElement('span');
                manualSpan.className = 'manual';
                manualSpan.innerText = 'M';
                kartDiv.appendChild(manualSpan);
            }
            rowDiv.appendChild(kartDiv);
        });
        const btn = document.createElement('button');
        btn.innerText = '+';
        btn.onclick = () => handlePitEntry(rowIndex);
        rowDiv.appendChild(btn);
        container.appendChild(rowDiv);
    });
}

function renderKartScores() {
    const container = document.getElementById('kart-scores-list');
    container.innerHTML = '';
    for (const id in kartScores) {
        const ks = kartScores[id];
        const div = document.createElement('div');
        div.innerText = `Kart ${ks.number} | Score: ${ks.score} | Color: ${ks.color}`;
        container.appendChild(div);
    }
}

function renderRaceTracking() {
    const container = document.getElementById('race-tracking-list');
    container.innerHTML = '';
    for (const team in raceTracking) {
        const rt = raceTracking[team];
        const div = document.createElement('div');
        div.innerText = `Team ${team} | Current Kart: ${rt.kartId} | Last Lap Score: ${rt.lastScore}`;
        container.appendChild(div);
    }
}

// Handles pit entry logic
function handlePitEntry(rowIndex) {
    const row = pitRows[rowIndex];
    if(row.length === 0) return;

    // Team takes first kart (remove)
    const exitingKart = row.shift();

    // Shift remaining karts forward
    // Nothing to do, already shifted by array shift

    // Add the kart just driven by the team at the end
    const teamKart = { ...exitingKart, color: getScoreColor(exitingKart.score), manual: false };
    row.push(teamKart);

    renderPitRows();
    renderKartScores();
    renderRaceTracking();
}

// Example scoring color function
function getScoreColor(score) {
    if(score >= 100) return 'purple';
    if(score >= 85) return 'green';
    if(score >= 70) return 'yellow';
    if(score >= 50) return 'orange';
    return 'red';
}

// Fetch Apex Timing Data
async function fetchApexData() {
    const link = document.getElementById('apex-link').value;
    if(!link) return;
    try {
        const res = await fetch('/fetch-laps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: link })
        });
        const data = await res.json();
        if(data.success) {
            data.kartData.forEach(k => {
                // Update kart scores
                if(!kartScores[k.transponder]) {
                    kartScores[k.transponder] = { number: k.number, score: k.lapTime, color: getScoreColor(k.lapTime) };
                } else {
                    // simple moving average
                    kartScores[k.transponder].score = (kartScores[k.transponder].score + k.lapTime) / 2;
                    kartScores[k.transponder].color = getScoreColor(kartScores[k.transponder].score);
                }
                // Update race tracking
                raceTracking[k.number] = { kartId: k.transponder, lastScore: k.lapTime };
            });
            renderPitRows();
            renderKartScores();
            renderRaceTracking();
        }
    } catch(err) {
        console.error(err);
    }
}

document.getElementById('fetch-btn').addEventListener('click', fetchApexData);
document.getElementById('reset-colors-btn').addEventListener('click', () => {
    for(const id in kartScores) {
        kartScores[id].color = getScoreColor(kartScores[id].score);
        kartScores[id].manual = false;
    }
    renderPitRows();
});

document.getElementById('export-btn').addEventListener('click', () => {
    const data = { pitRows, kartScores, raceTracking };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pit_mapping.json';
    a.click();
});

// Auto refresh every REFRESH_INTERVAL milliseconds
setInterval(fetchApexData, REFRESH_INTERVAL);

// Initial render
renderPitRows();
renderKartScores();
renderRaceTracking();

