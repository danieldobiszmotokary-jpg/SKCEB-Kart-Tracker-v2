let pitRows = [];
let kartScores = {};
let raceTracking = {};
const NUM_ROWS = 3;
const KARTS_PER_ROW = 3;
const REFRESH_INTERVAL = 5000;

// Initialize pit rows with unknown karts
for (let i = 0; i < NUM_ROWS; i++) {
    pitRows[i] = [];
    for (let j = 0; j < KARTS_PER_ROW; j++) {
        let tempId = `R${i+1}K${j+1}`;
        pitRows[i].push({ id: tempId, number: null, transponder: null, score: 0, color: 'blue', manual: false });
    }
}

// Determine color based on score
function getScoreColor(score) {
    if(score >= 100) return 'purple';
    if(score >= 85) return 'green';
    if(score >= 70) return 'yellow';
    if(score >= 50) return 'orange';
    return 'red';
}

// Render pit rows
function renderPitRows() {
    const container = document.getElementById('pit-rows');
    container.innerHTML = '';
    pitRows.forEach((row, rowIndex) => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'pit-row';
        row.forEach((kart, kartIndex) => {
            const kartDiv = document.createElement('div');
            kartDiv.className = `kart-box ${kart.color}`;
            kartDiv.innerHTML = `${kart.number || '?'}<br>${Math.round(kart.score)}`;

            // Manual color selector
            const colorSelect = document.createElement('select');
            ['purple','green','yellow','orange','red','blue',''].forEach(c=>{
                const opt = document.createElement('option');
                opt.value = c;
                opt.innerText = c || 'Auto';
                if(c===kart.color) opt.selected=true;
                colorSelect.appendChild(opt);
            });
            colorSelect.onchange = (e)=>{
                kart.color = e.target.value || getScoreColor(kart.score);
                kart.manual = e.target.value!=='';
                renderPitRows();
            };
            kartDiv.appendChild(colorSelect);

            // Manual number input
            const numberInput = document.createElement('input');
            numberInput.type='number';
            numberInput.value = kart.number || '';
            numberInput.placeholder='Num';
            numberInput.onchange = (e)=>{
                kart.number = e.target.value;
                renderPitRows();
            };
            kartDiv.appendChild(numberInput);

            if(kart.manual) {
                const manualSpan = document.createElement('span');
                manualSpan.className='manual';
                manualSpan.innerText='M';
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

// Render kart scores
function renderKartScores() {
    const container = document.getElementById('kart-scores-list');
    container.innerHTML = '';
    for(const id in kartScores){
        const ks = kartScores[id];
        const div = document.createElement('div');
        div.innerText = `Kart ${ks.number} | Score: ${Math.round(ks.score)} | Color: ${ks.color}`;
        container.appendChild(div);
    }
}

// Render race tracking
function renderRaceTracking() {
    const container = document.getElementById('race-tracking-list');
    container.innerHTML = '';
    for(const team in raceTracking){
        const rt = raceTracking[team];
        const div = document.createElement('div');
        div.innerText = `Team ${team} | Kart: ${rt.kartId} | Last Lap: ${Math.round(rt.lastScore)}`;
        container.appendChild(div);
    }
}

// Handle pit entry + shift logic
function handlePitEntry(rowIndex){
    const row = pitRows[rowIndex];
    if(row.length===0) return;

    // Team takes first kart
    const exitingKart = row.shift();

    // Shift remaining karts handled by array shift

    // Place team’s previous kart at end (use previous kart if exists)
    const teamKart = {...exitingKart};
    teamKart.color = getScoreColor(teamKart.score);
    teamKart.manual = false;
    row.push(teamKart);

    renderPitRows();
    renderKartScores();
    renderRaceTracking();
}

// Fetch Apex Timing data
async function fetchApexData(){
    const link = document.getElementById('apex-link').value;
    if(!link) return;
    try{
        const res = await fetch('/fetch-laps',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({url:link})
        });
        const data = await res.json();
        if(data.success){
            data.kartData.forEach(k=>{
                // Update kartScores
                if(!kartScores[k.transponder]){
                    kartScores[k.transponder] = { number:k.number, score:k.lapTime, color:getScoreColor(k.lapTime) };
                } else {
                    // moving average for scoring
                    kartScores[k.transponder].score = (kartScores[k.transponder].score + k.lapTime)/2;
                    if(!kartScores[k.transponder].manual){
                        kartScores[k.transponder].color = getScoreColor(kartScores[k.transponder].score);
                    }
                }
                // Update raceTracking
                raceTracking[k.number] = { kartId:k.transponder, lastScore:k.lapTime };
            });
            renderPitRows();
            renderKartScores();
            renderRaceTracking();
        }
    }catch(err){
        console.error(err);
    }
}

document.getElementById('fetch-btn').addEventListener('click', fetchApexData);
document.getElementById('reset-colors-btn').addEventListener('click',()=>{
    for(const id in kartScores){
        kartScores[id].color = getScoreColor(kartScores[id].score);
        kartScores[id].manual = false;
    }
    renderPitRows();
});

document.getElementById('export-btn').addEventListener('click',()=>{
    const data={pitRows,kartScores,raceTracking};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='pit_mapping.json';
    a.click();
});

// Auto refresh
setInterval(fetchApexData, REFRESH_INTERVAL);

// Initial render
renderPitRows();
renderKartScores();
renderRaceTracking();

