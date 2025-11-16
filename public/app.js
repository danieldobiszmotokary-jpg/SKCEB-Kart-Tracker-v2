// ==========================
// SKCEB Kart Tracker v3
// Complete multi-stint tracker + pit visualization
// ==========================

// Example: kartScores[kartNumber] = latest score
let kartScores = {}; 
// teamScores[teamId] = { totalScore, laps }
let teamScores = {}; 
// pitSlots[row][slot] = { teamId, kartNumber, score, color, manualOverride, div }
let pitSlots = [];

// ---------- Color Helpers ----------
function getColorFromScore(score) {
    if(score===undefined) return "blue";
    if(score>=900) return "purple";
    if(score>=750) return "green";
    if(score>=600) return "yellow";
    if(score>=500) return "orange";
    return "red";
}

function getColorFromTeam(teamId) {
    if(!teamScores[teamId] || teamScores[teamId].laps===0) return "blue";
    const avg = teamScores[teamId].totalScore / teamScores[teamId].laps;
    return getColorFromScore(avg);
}

// ---------- Setup Pit Rows ----------
function setupPitRows(){
    const container = document.getElementById('pitContainer');
    container.innerHTML = '';
    pitSlots = [];

    const numRows = parseInt(document.getElementById('numRows').value);
    const kartsPerRow = parseInt(document.getElementById('kartsPerRow').value);

    for(let r=0;r<numRows;r++){
        const rowDiv = document.createElement('div');
        rowDiv.className = 'row';
        let row = [];

        for(let k=0;k<kartsPerRow;k++){
            const slot = { teamId:"", kartNumber:"", score:null, color:"blue", manualOverride:false };
            const kartDiv = document.createElement('div');
            kartDiv.className='kart';
            kartDiv.textContent = slot.kartNumber || "?";
            kartDiv.style.background = slot.color;
            kartDiv.onclick = () => manualColorOverride(r,k);
            slot.div = kartDiv;
            row.push(slot);
            rowDiv.appendChild(kartDiv);
        }

        const plusBtn = document.createElement('button');
        plusBtn.textContent = '+';
        plusBtn.onclick = () => shiftRow(r);
        rowDiv.appendChild(plusBtn);

        container.appendChild(rowDiv);
        pitSlots.push(row);
    }
}

// ---------- Manual Color Override ----------
function manualColorOverride(rowIdx, slotIdx){
    const colors = ["blue","red","orange","yellow","green","purple"];
    const newColor = prompt("Enter color (blue, red, orange, yellow, green, purple):", pitSlots[rowIdx][slotIdx].color);
    if(colors.includes(newColor)){
        pitSlots[rowIdx][slotIdx].color = newColor;
        pitSlots[rowIdx][slotIdx].manualOverride = true;
        pitSlots[rowIdx][slotIdx].div.style.background = newColor;
    }
}

// ---------- Shift Row (+ button) ----------
function shiftRow(rowIdx){
    const row = pitSlots[rowIdx];
    row.shift(); // remove first kart

    const newKartNumber = prompt("Enter incoming kart number:");
    const newSlot = { teamId:"", kartNumber:newKartNumber, score:null, color:"blue", manualOverride:false };

    // Automatic color from score if tracked
    if(kartScores[newKartNumber]!==undefined){
        newSlot.score = kartScores[newKartNumber];
        newSlot.color = getColorFromScore(newSlot.score);
    }

    const kartDiv = document.createElement('div');
    kartDiv.className='kart';
    kartDiv.textContent = newSlot.kartNumber || "?";
    kartDiv.style.background = newSlot.color;
    kartDiv.onclick = () => manualColorOverride(rowIdx,row.length);

    newSlot.div = kartDiv;
    row.push(newSlot);

    const rowDiv = row[0].div.parentElement;
    rowDiv.insertBefore(kartDiv,rowDiv.querySelector('button'));
}

// ---------- Start Tracker Placeholder ----------
function startTracker(){
    const link = document.getElementById('apexLink').value;
    alert("Tracker started! (future: fetch lap data from: " + link + ")");
    // Later: integrate live timing, update kartScores, teamScores
}
