import * as sauce from '/pages/src/../../shared/sauce/index.mjs';
import * as common from '/pages/src/common.mjs';

const doc = document.documentElement;
const L = sauce.locale;
const H = L.human;
const num = H.number;

let gameConnection;
const page = location.pathname.split('/').at(-1).split('.')[0];

common.settingsStore.setDefault({
    overlayMode: false,
    solidBackground: false,
    backgroundColor: '#00ff00',
    minDuration: 3,
    pullPowerThreshold: 290,
    maxHistoryLength: 10
});

let overlayMode;
if (window.isElectron) {
    overlayMode = !!window.electron.context.spec.overlay;
    doc.classList.toggle('overlay-mode', overlayMode);
    document.querySelector('#titlebar').classList.toggle('always-visible', overlayMode !== true);
    if (common.settingsStore.get('overlayMode') !== overlayMode) {
        // Sync settings to our actual window state, not going to risk updating the window now
        common.settingsStore.set('overlayMode', overlayMode);
    }
}

let latestDuration = 0;
let latestSumPowerTimesDuration = 0;
let oldWorldTimeS = undefined;

let pullHistory = [];
let draftHistory = [];

let isPulling = false;
let wasPulling;
let currentAthlete;
let maxHistoryLength = 10;
let pullDraftTable;
let minDuration = 3;
let pullPowerThreshold = 0;

function initHistoryTable() {
    pullDraftTable = document.getElementById("pullDraftTable");
    for (let i = 2; i < 2 + maxHistoryLength; ++i) {
        let row = pullDraftTable.insertRow(i);
        for (let j = 0; j < 4; ++j) {
            let cell = row.insertCell(j);
            cell.classList.add('history');
        }
    }
}

function formatDuration(v) {
    const minutes = Math.floor(v / 60);
    const seconds = Math.floor(v % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
function formatAvgPower(v) {
    return `${Math.round(v)}W`;
}

function updateTable() {
    let activeDurationField = document.getElementById(isPulling ? 'pullDuration' : 'draftDuration');
    let inactiveDurationField = document.getElementById(!isPulling ? 'pullDuration' : 'draftDuration');
    let activeAvgPowerField = document.getElementById(isPulling ? 'pullAvgPower' : 'draftAvgPower');
    let inactiveAvgPowerField = document.getElementById(!isPulling ? 'pullAvgPower' : 'draftAvgPower');
    activeDurationField.innerHTML = formatDuration(latestDuration);
    const avgPower = latestDuration > 0 ? formatAvgPower(latestSumPowerTimesDuration / latestDuration) : '-';
    activeAvgPowerField.innerHTML = avgPower;
    inactiveDurationField.innerHTML = "\u00a0\u00a0\u00a0\u00a0";
    inactiveAvgPowerField.innerHTML = "\u00a0\u00a0\u00a0\u00a0";
    for (let i = 0; i < maxHistoryLength; ++i) {
        let row = pullDraftTable.rows[i + 2];
        if (i < pullHistory.length) {
            row.cells[0].innerHTML = formatDuration(pullHistory[pullHistory.length - 1 - i].duration);
            row.cells[1].innerHTML = formatAvgPower(pullHistory[pullHistory.length - 1 - i].avgPower);
        } else {
            row.cells[0].innerHTML = '';
            row.cells[1].innerHTML = '';
        }
        if (i < draftHistory.length) {
            row.cells[2].innerHTML = formatDuration(draftHistory[draftHistory.length - 1 - i].duration);
            row.cells[3].innerHTML = formatAvgPower(draftHistory[draftHistory.length - 1 - i].avgPower);
        } else {
            row.cells[2].innerHTML = '';
            row.cells[3].innerHTML = '';
        }
    }
}

function addToHistory(h) {
    h.push({duration:latestDuration, sumPowerTimesDuration: latestSumPowerTimesDuration, avgPower: latestSumPowerTimesDuration/latestDuration});
}

function reset() {
    latestDuration = 0;
    latestSumPowerTimesDuration = 0;
    oldWorldTimeS = undefined;
    pullHistory = [];
    draftHistory = [];
    isPulling = undefined;
    wasPulling = undefined;
    currentAthlete = undefined;
}

function onAthleteData(data) {
    if (currentAthlete != data.athleteId || !data.state.time) {
        reset();
        currentAthlete = data.athleteId;
    }
    const worldTimeS = data.state.worldTime / 1000.0;
    const deltaTimeS = oldWorldTimeS != undefined ? worldTimeS - oldWorldTimeS : undefined;
    isPulling = data.state.draft === 0 && data.state.power >= pullPowerThreshold;
    if (isPulling != wasPulling) {
        if (latestDuration > minDuration) {
            addToHistory(wasPulling ? pullHistory : draftHistory);
            latestDuration = 0;
            latestSumPowerTimesDuration = 0;
        } else {
            let saved = isPulling ? pullHistory.pop() : draftHistory.pop();
            if (saved != undefined) {
                latestDuration += saved.duration;
                latestSumPowerTimesDuration += saved.sumPowerTimesDuration;
            }
        }
    } else if (isPulling === wasPulling) {
        if (deltaTimeS != undefined && data.state.speed > 1) {
            latestDuration += deltaTimeS;
            latestSumPowerTimesDuration += deltaTimeS * data.state.power;
        }
    }
    updateTable();
    wasPulling = isPulling;
    oldWorldTimeS = worldTimeS;
}

function render() {
    doc.style.setProperty('--font-scale', common.settingsStore.get('fontScale') || 1);
}

function setBackground() {
    const {solidBackground, backgroundColor} = common.settingsStore.get();
    doc.classList.toggle('solid-background', !!solidBackground);
    if (solidBackground) {
        doc.style.setProperty('--background-color', backgroundColor);
    } else {
        doc.style.removeProperty('--background-color');
    }
}

export async function main() {
    common.initInteractionListeners();

    minDuration = common.settingsStore.get('minDuration') ?? minDuration;
    pullPowerThreshold = common.settingsStore.get('pullPowerThreshold') ?? pullPowerThreshold;
    maxHistoryLength = common.settingsStore.get('maxHistoryLength') ?? maxHistoryLength;

    const gcs = await common.rpc.getGameConnectionStatus();

    gameConnection = !!(gcs && gcs.connected);
    doc.classList.toggle('game-connection', gameConnection);
    common.subscribe('status', gcs => {
        gameConnection = gcs.connected;
        doc.classList.toggle('game-connection', gameConnection);
    }, {source: 'gameConnection'});

    common.settingsStore.addEventListener('changed', async ev => {
        const changed = ev.data.changed;
        if (changed.has('solidBackground') || changed.has('backgroundColor')) {
            setBackground();
        }
        if (window.isElectron && changed.has('overlayMode')) {
            await common.rpc.updateWindow(window.electron.context.id,
                {overlay: changed.get('overlayMode')});
            await common.rpc.reopenWindow(window.electron.context.id);
        }
        if (changed.has('minDuration')) {
            minDuration = changed.get('minDuration');
        }
        if (changed.has('pullPowerThreshold')) {
            pullPowerThreshold = changed.get('pullPowerThreshold');
        }
        if (changed.has('maxHistoryLength')) {
            maxHistoryLength = changed.get('maxHistoryLength');
        }
        render();
    });

    setBackground();
    render();
    
    const resetBtn = document.querySelector('.button.reset');
    resetBtn.addEventListener('click', reset);
    
    initHistoryTable();
    common.subscribe(`athlete/watching`, onAthleteData);
}

export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form#general')();
}

