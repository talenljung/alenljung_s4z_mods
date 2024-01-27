import * as sauce from '/pages/src/../../shared/sauce/index.mjs';
import * as common from '/pages/src/common.mjs';

const doc = document.documentElement;
const L = sauce.locale;
const H = L.human;
const num = H.number;

const page = location.pathname.split('/').at(-1).split('.')[0];

const defaultPullPowerThreshold = 0;
const defaultMinDuration = 7;
const defaultShowAccumulatedStatistics = false;
const defaultShowWkg = false;
const defaultHideUnit = false;


common.settingsStore.setDefault({
    overlayMode: false,
    solidBackground: false,
    backgroundColor: '#00ff00',
    minDuration: defaultMinDuration,
    pullPowerThreshold: defaultPullPowerThreshold,
    showAccumulatedStatistics: defaultShowAccumulatedStatistics,
    showWkg: defaultShowWkg,
    hideUnit: defaultHideUnit
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
let athleteWeight;
let maxHistoryLength = 20;
let pullDraftTable;
let accumulatedDurationRow;
let minDuration = defaultMinDuration;
let pullPowerThreshold = defaultPullPowerThreshold;
let showAccumulatedStatistics = defaultShowAccumulatedStatistics;
let showWkg = defaultShowWkg;
let hideUnit = defaultHideUnit;

function addCellsToRow(row, classname) {
    for (let j = 0; j < 4; ++j) {
        let cell = row.insertCell(j);
        cell.classList.add(classname);
    }
}

const numStaticRows = 3;

function initHistoryTable() {
    pullDraftTable = document.getElementById("pullDraftTable");
    accumulatedDurationRow = pullDraftTable.insertRow(2);
    addCellsToRow(accumulatedDurationRow, 'accumDuration');
    for (let i = numStaticRows; i < numStaticRows + maxHistoryLength; ++i) {
        let row = pullDraftTable.insertRow(i);
        addCellsToRow(row, 'history');
    }
    updateTable();
}

function formatDuration(v) {
    const minutes = Math.floor(v / 60);
    const seconds = Math.floor(v % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatAvgPower(v) {
    if (showWkg && athleteWeight != undefined && athleteWeight > 0) {
        return formatWkg(v/athleteWeight);
    } else {
        return formatWatts(v);
    }
}

function formatWatts(v) {
    return (v ? Math.round(v) : '-') + (hideUnit ? '' : '<small>W</small>');
}

function formatWkg(v) {
    return (v ? v.toFixed(2) : '-') + (hideUnit ? '' : '<small>W/kg</small>');
}


function accumHistoricDuration(history) {
    return  history.reduce((sum, elem) => sum + elem.duration, 0);
}

function accumHistoricEnergy(history) {
    return  history.reduce((sum, elem) => sum + elem.sumPowerTimesDuration, 0);
}

function updateTable() {
    let activeDurationField = document.getElementById(isPulling ? 'pullDuration' : 'draftDuration');
    let inactiveDurationField = document.getElementById(!isPulling ? 'pullDuration' : 'draftDuration');
    let activeAvgPowerField = document.getElementById(isPulling ? 'pullAvgPower' : 'draftAvgPower');
    let inactiveAvgPowerField = document.getElementById(!isPulling ? 'pullAvgPower' : 'draftAvgPower');
    activeDurationField.innerHTML = formatDuration(latestDuration);
    const avgPower = latestDuration > 0 ? formatAvgPower(latestSumPowerTimesDuration/latestDuration) : '-';
    activeAvgPowerField.innerHTML = avgPower;
    inactiveDurationField.innerHTML = "\u00a0\u00a0\u00a0\u00a0";
    inactiveAvgPowerField.innerHTML = "\u00a0\u00a0\u00a0\u00a0";
    
    const accumPullDuration = accumHistoricDuration(pullHistory) + (isPulling ? latestDuration : 0);
    const accumDraftDuration = accumHistoricDuration(draftHistory) + (!isPulling ? latestDuration : 0);
    const accumPullEnergy = accumHistoricEnergy(pullHistory) + (isPulling ? latestSumPowerTimesDuration : 0);
    const accumDraftEnergy = accumHistoricEnergy(draftHistory) + (!isPulling ? latestSumPowerTimesDuration : 0);
    accumulatedDurationRow.cells[0].innerHTML = formatDuration(accumPullDuration);
    accumulatedDurationRow.cells[1].innerHTML = formatAvgPower(accumPullEnergy/accumPullDuration);
    accumulatedDurationRow.cells[2].innerHTML = formatDuration(accumDraftDuration);
    accumulatedDurationRow.cells[3].innerHTML = formatAvgPower(accumDraftEnergy/accumDraftDuration);
    const accumulatedDurationRowDisplayStyle = showAccumulatedStatistics ? 'table-row' : 'none';
    accumulatedDurationRow.style = `display:${accumulatedDurationRowDisplayStyle};`;
    for (let i = 0; i < maxHistoryLength; ++i) {
        let row = pullDraftTable.rows[i + numStaticRows];
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
    athleteWeight = data.athlete ? data.athlete.weight : undefined;
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
    showAccumulatedStatistics = common.settingsStore.get('showAccumulatedStatistics') ?? showAccumulatedStatistics;
    showWkg = common.settingsStore.get('showWkg') ?? showWkg;
    hideUnit = common.settingsStore.get('hideUnit') ?? hideUnit;

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
        if (changed.has('showAccumulatedStatistics')) {
            showAccumulatedStatistics = changed.get('showAccumulatedStatistics');
        }
        if (changed.has('showWkg')) {
            showWkg = changed.get('showWkg');
        }
        if (changed.has('hideUnit')) {
            hideUnit = changed.get('hideUnit');
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

