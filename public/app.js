let pitSlots = []; // pitSlots[row] = [ { slot: KartSlot, btnContainer: HTMLDivElement } ]

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
        const row = [];

        for (let k = 0; k < kartsPerRow; k++) {
            const slot = createKartSlot("", "", "blue");

            // Buttons for manual overrides
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

            rowDiv.appendChild(slot.div);
            rowDiv.appendChild(btnContainer);

            row.push({ slot, btnContainer });
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
    const plusBtn = rowDiv.querySelector('button:last-child');

    if (row.length === 0) return;

    // Remove first kart + buttons from DOM
    const first = row.shift();
    first.slot.div.remove();
    first.btnContainer.remove();

    // Create new blue kart
    const newSlot = createKartSlot("?", "", "blue");

    // Buttons for manual overrides
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

    // Insert new kart + buttons before + button
    rowDiv.insertBefore(newSlot.div, plusBtn);
    rowDiv.insertBefore(newBtnContainer, plusBtn);

    // Add to row array
    row.push({ slot: newSlot, btnContainer: newBtnContainer });
}

// -------- Manual color change --------
function manualColorChange(rowIdx, slotIdx) {
    const colors = ["blue","red","orange","yellow","green","purple"];
    const newColor = prompt("Enter color (blue, red, orange, yellow, green, purple):", pitSlots[rowIdx][slotIdx].slot.color);
    if (colors.includes(newColor)) {
        pitSlots[rowIdx][slotIdx].slot.color = newColor;
        pitSlots[rowIdx][slotIdx].slot.manualOverride = true;
        pitSlots[rowIdx][slotIdx].slot.div.style.background = newColor;
    }
}

// -------- Manual number change --------
function manualNumberChange(rowIdx, slotIdx) {
    const newNumber = prompt("Enter kart number:", pitSlots[rowIdx][slotIdx].slot.kartNumber);
    if (newNumber !== null) {
        pitSlots[rowIdx][slotIdx].slot.kartNumber = newNumber;
        pitSlots[rowIdx][slotIdx].slot.div.textContent = newNumber;
    }
}

// -------- Start tracker placeholder --------
function startTracker() {
    const link = document.getElementById('apexLink').value;
    alert("Tracker started! (for testing: no Apex Timing data connected, new karts will be blue)");
}
