let kartScores = {};   // kartNumber -> score
let teamScores = {};   // teamId -> { totalScore, laps }
let pitSlots = [];     // pitSlots[row][slot] = { teamId, kartNumber, score, color, manualOverride, div }

// -------- Color helpers --------
function getColorFromScore(score){
    if(score===undefined) return "blue";
    if(score>=900) return "purple";
    if(score>=750) return "green";
    if(score>=600) return "yellow";
    if(score>=500) return "orange";
    return "red";
}

function getColorFromTeam(teamId){
    if(!teamScores[teamId] || teamScores[teamId].laps===0) return "blue";
    const avg = teamScores[teamId].totalScore / teamScores[teamId].laps;
    return getColorFromScore(avg);
}

// -------- Create a kart slot --------
function createKartSlot(kartNumber, teamId, color) {
    const kartDiv = document.createElement('div');
    kartDiv.className = 'kart';
    kartDiv.textContent = kartNumber || "?";
    kartDiv.style.background = color;

    return {
        kartNumber: kartNumber,
        teamId: teamId,
        color: color,
        manualOverride: false,
        div: kartDiv
    };
}

// -------- Setup pit rows --------
function setupPitRows() {
    const container = document.getElementById('pitContainer');
    container.innerHTML = '';
    pitSlots = [];

    const numRows = parseInt(document.getElementById('numRows').value);
    const kartsPerRow = parseInt(document.getElementById('kartsPerRow').value);

    for (let r = 0; r < numRows; r++) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'row';
        let row = [];

        for (let k = 0; k < kartsPerRow; k++) {
            const slot = createKartSlot("", "", "blue");
            row.push(slot);
            rowDiv.appendChild(slot.div);

            // Add manual buttons under each kart
            const colorBtn = document.createElement('button');
            colorBtn.textContent = "Color";
            colorBtn.onclick = () => manualColorChange(r, k);
            const numberBtn = document.createElement('button');
            numberBtn.textContent = "Number";
            numberBtn.onclick = () => manualNumberChange(r, k);

            const btnContainer = document.createElement('div');
            btnContainer.style.display = 'flex';
            btnContainer.style.justifyContent = 'center';
            btnContainer.style.gap = '4px';
            btnContainer.appendChild(colorBtn);
            btnContainer.appendChild(numberBtn);

            rowDiv.appendChild(btnContainer);
        }

        // + button for row
        const plusBtn = document.createElement('button');
        plusBtn.textContent = '+';
        plusBtn.onclick = () => addNewKartToRow(r);
        rowDiv.appendChild(plusBtn);

        container.appendChild(rowDiv);
        pitSlots.push(row);
    }
}

// -------- Add new kart to a row --------
function addNewKartToRow(rowIdx) {
    const row = pitSlots[rowIdx];
    const rowDiv = document.getElementById('pitContainer').children[rowIdx];

    if(row.length === 0) return;

    // Remove first kart from array and DOM
    const removed = row.shift();
    removed.div.remove();
    // Remove buttons container immediately following removed div
    const firstBtnContainer = rowDiv.querySelector('div');
    if (firstBtnContainer) firstBtnContainer.remove();

    // Simulate new kart (blue) if no data
    const newNumber = "?"; // unknown kart
    const newSlot = createKartSlot(newNumber, "", "blue");

    // Add manual buttons under the new kart
    const colorBtn = document.createElement('button');
    colorBtn.textContent = "Color";
    colorBtn.onclick = () => manualColorChange(rowIdx, row.length);

    const numberBtn = document.createElement('button');
    numberBtn.textContent = "Number";
    numberBtn.onclick = () => manualNumberChange(rowIdx, row.length);

    const newBtnContainer = document.createElement('div');
    newBtnContainer.style.display = 'flex';
    newBtnContainer.style.justifyContent = 'center';
    newBtnContainer.style.gap = '4px';
    newBtnContainer.appendChild(colorBtn);
    newBtnContainer.appendChild(numberBtn);

    // Insert new kart and buttons before the + button
    const plusBtn = rowDiv.querySelector('button:last-child');
    rowDiv.insertBefore(newSlot.div, plusBtn);
    rowDiv.insertBefore(newBtnContainer, plusBtn);

    // Add new slot to array
    row.push(newSlot);
}

// -------- Manual color change --------
function manualColorChange(rowIdx, slotIdx) {
    const colors = ["blue","red","orange","yellow","green","purple"];
    const newColor = prompt("Enter color (blue, red, orange, yellow, green, purple):", pitSlots[rowIdx][slotIdx].color);
    if (colors.includes(newColor)) {
        pitSlots[rowIdx][slotIdx].color = newColor;
        pitSlots[rowIdx][slotIdx].manualOverride = true;
        pitSlots[rowIdx][slotIdx].div.style.background = newColor;
    }
}

// -------- Manual number change --------
function manualNumberChange(rowIdx, slotIdx) {
    const newNumber = prompt("Enter kart number:", pitSlots[rowIdx][slotIdx].kartNumber);
    if (newNumber !== null) {
        pitSlots[rowIdx][slotIdx].kartNumber = newNumber;
        pitSlots[rowIdx][slotIdx].div.textContent = newNumber;
    }
}

// -------- Start tracker placeholder --------
function startTracker() {
    const link = document.getElementById('apexLink').value;
    alert("Tracker started! (for testing: no Apex Timing data connected, new karts will be blue)");
}
