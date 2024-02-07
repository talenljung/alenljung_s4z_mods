import * as sauce from '/pages/src/../../shared/sauce/index.mjs';
import * as common from '/pages/src/common.mjs';
import crrDbJson from './crr.json' assert { type: 'json' };

const doc = document.documentElement;
const L = sauce.locale;
const H = L.human;
const num = H.number;

let gameConnection;
const page = location.pathname.split('/').at(-1).split('.')[0];

const bikeData = {
    "Canyon Aeroad 2021, DT Swiss ARC 1100 DICUT DISC": { weight: 6.326516434, tyreType: 'road'},
    "Pinarello Dogma F, DT Swiss ARC 1100 DICUT DISC": { weight: 6.111778897, tyreType: 'road'},
    "Scott Addict RC, DT Swiss ARC 1100 DICUT DISC": { weight: 5.969539361, tyreType: 'road'},
    "Scott Addict RC, ENVE SES 7.8": { weight: 5.551463039, tyreType: 'road'},
    "Specialized Aethos S-Works, DT Swiss ARC 1100 DICUT 62": { weight: 5.20017971, tyreType: 'road'},
    "Specialized Aethos S-Works, Lightweight Meilenstein": { weight: 4.773019002, tyreType: 'road'},
    "Specialized Venge S-Works, DT Swiss ARC 1100 DICUT DISC": { weight: 6.392870542, tyreType: 'road'},
    "Zwift Concept Z1 (Tron)": { weight: 5.841040875, tyreType: 'road'},
    "Gravel: Canyon Grail, ENVE G23": { weight: 6.295709214, tyreType: 'gravel'},
    "Gravel: Specialized Crux, Cadex AR 35": { weight: 6.376319988, tyreType: 'gravel'},
    "Gravel: Specialized Crux, ENVE G23": { weight: 6.180817163, tyreType: 'gravel'},
    "TT: Cadex Tri, DT Swiss ARC 1100 DICUT DISC": { weight: 8.731950421, tyreType: 'road'},
    "TT: Canyon Speedmax CF SLX Disc, DT Swiss ARC 1100 DICUT DISC": { weight: 8.777536839, tyreType: 'road'},
    "TT: Canyon Speedmax CF SLX Disc, ENVE SES 7.8": { weight: 8.307936447, tyreType: 'road'},
    "TT: Scott Plasma RC Ultimate, DT Swiss ARC 1100 DICUT DISC": { weight: 8.569863648, tyreType: 'road'},
    "MTB: Trek Super Caliber": { weight: 11.5578441, tyreType: 'mtb'},
    };

const defaultCdaAverageWindowSizeMs = 3000;

common.settingsStore.setDefault({
    overlayMode: false,
    solidBackground: false,
    backgroundColor: '#00ff00',
    bike: Object.keys(bikeData)[0],
    cdaAverageWindowSizeMs: defaultCdaAverageWindowSizeMs
});

const formatcda = v => num(v*100);

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

function download(datalog) {
    var data = "athleteId, time, deltaTimeMs, watching.state.power, watching.state.distance, altitude, gradientPercent, gradientPercentAverage, watching.state.grade, watching.state.draft, speedKph, height, riderWeight, bikeWeight, crr, cda, cdaAverage, selectedBike, cdaAverageWindowSizeMs\n";
    data += datalog.join('\n');
    var blob = new Blob([data], {type: "text/csv"});
    var url  = window.URL.createObjectURL(blob);
    window.location.assign(url);
}

function timeWindowAverage(values, deltaTimes, windowSize) {
    let accumTime = 0;
    let accumValuesXTime = 0;
    let i = values.length - 1;
    for (; i >= 0 && accumTime < windowSize; --i)
    {
        accumTime += deltaTimes[i];
        accumValuesXTime += values[i] * deltaTimes[i];
    }
    return accumTime > 0 ? accumValuesXTime / accumTime : values[values.length - 1];
}

const airDensity = 1.204700132;
const g = 9.81;

var selectedBike = Object.keys(bikeData)[0];
var cdaAverageWindowSizeMs = defaultCdaAverageWindowSizeMs;

function getSurface(courseId, roadId, roadCompletion, isReverse) {
    if (courseId in crrDbJson.roads && roadId in crrDbJson.roads[courseId])
    {
        const currentProgress = (isReverse ? 1000000 - roadCompletion : roadCompletion) / 1000000
        const roadData = crrDbJson.roads[courseId][roadId];
        const progresses = Object.keys(roadData);
        for (const [p, surface] of Object.entries(roadData)) {
            if (currentProgress <= p) {
                return surface;
            }
        }
        return roadData[progresses[progresses.length - 1]];
    }
    return undefined;
}

function getCrr(courseId, roadId, roadCompletion, isReverse, tyreType) {
    const surface = getSurface(courseId, roadId, roadCompletion, isReverse)
    return crrDbJson.surfaces[surface ?? 'pavement_sand'][tyreType];
}

function getSurfaceAndCrr(courseId, roadId, roadCompletion, isReverse, tyreType) {
    const surface = getSurface(courseId, roadId, roadCompletion, isReverse)
    return [surface, crrDbJson.surfaces[surface ?? 'pavement_sand'][tyreType]];
}

function effectiveCda(height, riderWeight, bikeWeight, pwr, newSpeedKmH, prevSpeedKmH, timeDeltaS, inclinePercent, crr) {
  const weight = riderWeight + bikeWeight;
  const inclineRad = Math.atan(inclinePercent/100.0);
  const gravitationalForce = weight * g * Math.sin(inclineRad);
  const rollingResistance = crr * Math.cos(inclineRad) * weight * g;
  const windSpeed = 0;
  const drivetrainEfficiency = 1;
  const newSpeed = newSpeedKmH / 3.6;
  const prevSpeed = prevSpeedKmH / 3.6;
  const airSpeed = newSpeed + windSpeed;
  const acceleration = (newSpeed - prevSpeed) / timeDeltaS;
  const accForce = acceleration * weight;
  const powerAtWheel = pwr * drivetrainEfficiency;
  const aeroResistance = powerAtWheel / newSpeed - (accForce + rollingResistance + gravitationalForce);
  const cda = 2 * aeroResistance / (airDensity * airSpeed * airSpeed);
  return cda;
}

export async function main() {
    common.initInteractionListeners();
    selectedBike = common.settingsStore.get('bike') ?? Object.keys(bikeData)[0];
    cdaAverageWindowSizeMs = common.settingsStore.get('cdaAverageWindowSizeMs') ?? 2000;

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
        if (changed.has('bike')) {
            selectedBike = changed.get('bike');
        }
        if (changed.has('cdaAverageWindowSizeMs')) {
            cdaAverageWindowSizeMs = changed.get('cdaAverageWindowSizeMs') ?? 2000;
        }
        render();
    });

    setBackground();
    render();

    let datalog = [];
    let datalogMaxLength = 3000;
    document.addEventListener('keydown', ev => {
        if (ev.ctrlKey && ev.shiftKey) {
            if (ev.key === 'D') {
                ev.preventDefault();
                download(datalog);
            }
        }
    }, {capture: true});

    let athleteId;

    let altitudeOld = null;
    let gradientPercent = 0;
    let gradientPercentHistory = [0];
    let cdaHistory = [0];
    let deltaTimeMsHistory = [0];
    let timeOld = null;
    let pwrTimeMaxSize = 20;
    let pwrAverageTimeMs = 2000;
    let speedKphOld = null;
    let powerOld = null;
    const gradientAverageWindowSizeMs = 500;
    const historyLength = 200;
    const extraWeight = 0.2;
    common.subscribe('athlete/watching', watching => {
        if (watching.athleteId !== athleteId) {
            athleteId = watching.athleteId;
            gradientPercentHistory = [0];
            deltaTimeMsHistory = [0];
            cdaHistory = [0];
            altitudeOld = null;
            timeOld = null;
            speedKphOld = null;
            powerOld = null;
        }
        const altitude = watching.state.altitude;
        const time = watching.state.worldTime;
        const speedKph = watching.state.speed;

        timeOld = timeOld ?? time;
        if (!altitudeOld)
        {
            gradientPercent = 0;
            altitudeOld = altitude;
        }
        speedKphOld = speedKphOld ?? speedKph;
        powerOld = powerOld ?? watching.state.power;
        
        const deltaTimeMs = time - timeOld;
        const deltaDistance = speedKph * deltaTimeMs / 3600;

        if (deltaDistance > 0)
        {
            gradientPercent = 100*(altitude - altitudeOld) / deltaDistance;
        }
        gradientPercentHistory.push(gradientPercent);
        deltaTimeMsHistory.push(deltaTimeMs);
        
        const gradientPercentAverage = timeWindowAverage(gradientPercentHistory, deltaTimeMsHistory, gradientAverageWindowSizeMs);

        const riderWeight = watching.athlete.weight
        const bikeWeight = bikeData[selectedBike].weight + extraWeight;
        const height = watching.athlete.height
        const [surface, crr] = getSurfaceAndCrr(watching.state.courseId, watching.state.roadId, watching.state.roadCompletion, watching.state.reverse, bikeData[selectedBike].tyreType);
        const powerToUse = deltaTimeMs > 300 ? watching.state.power : powerOld;
        const cda = effectiveCda(height, riderWeight, bikeWeight, powerToUse, speedKph, speedKphOld, deltaTimeMs/1000, gradientPercentHistory[gradientPercentHistory.length-2], crr);
        cdaHistory.push(cda);
        const cdaAverage = timeWindowAverage(cdaHistory, deltaTimeMsHistory, cdaAverageWindowSizeMs);

        const logarray = [athleteId, time, deltaTimeMs, watching.state.power, watching.state.distance, altitude, gradientPercent, gradientPercentAverage, watching.state.grade, watching.state.draft, speedKph, height, riderWeight, bikeWeight, crr, cda, cdaAverage, selectedBike, cdaAverageWindowSizeMs];
        datalog.push(logarray)
        while (datalog.length > datalogMaxLength) {
            datalog.shift();
        }
        console.debug(logarray)
        if (page == 'effective-cda') {
            document.getElementById('act_cda').innerHTML = formatcda(cdaAverage);
            document.getElementById('act_crr').innerHTML = `${(surface ?? 'Unknown').replace('_', '/')} ${crr}`;
        }
        timeOld = time;
        speedKphOld = speedKph;
        altitudeOld = altitude;
        powerOld = watching.state.power;
        while (gradientPercentHistory.length > historyLength)
        {
            gradientPercentHistory.shift();
            deltaTimeMsHistory.shift();
            cdaHistory.shift();
        }
    });
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

export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form#general')();
    let selectedBike = common.settingsStore.get('bike');
    let bikeSelector = document.getElementById("bikeSelector");
    for (const bikeName of Object.keys(bikeData)) {
        let bikeOption = new Option(bikeName, bikeName, false, bikeName === selectedBike);
        console.log(`Adding bike ${bikeName}, selectedBike=${selectedBike}, iseq=${bikeName === selectedBike}`);
        bikeSelector.add(bikeOption);
    }
}

