import { createCamera } from './camera.js';
import { createCropController } from './crop.js';
import { accumulate, extractSpectrum } from './extract.js';
import {
  calibrationInvalidationReason,
  calibrationRestoreReason,
  createCalibrationRecord,
  fitCalibration,
  restoreCalibrationRecord,
  WAVELENGTH_PRESETS,
} from './calibrate.js';
import { drawGraph, graphPixelFromClientX } from './graph.js';
import { createSyntheticRenderer, SYNTHETIC_PEAKS } from './synthetic.js';

const canvas = document.querySelector('#preview');
const context = canvas.getContext('2d', { willReadFrequently: true });
const previewStage = document.querySelector('#preview-stage');
const video = document.querySelector('#camera-video');
const status = document.querySelector('#status');
const frameDescription = document.querySelector('#frame-description');
const frameSize = document.querySelector('#frame-size');
const cropSize = document.querySelector('#crop-size');
const sourceDetail = document.querySelector('#source-detail');
const sourceOptions = document.querySelectorAll('input[name="source"]');
const graphCanvas = document.querySelector('#spectrum-graph');
const graphReadout = document.querySelector('#graph-readout');
const saturationWarning = document.querySelector('#saturation-warning');
const frameAverageInput = document.querySelector('#frame-average');
const channelOptions = document.querySelectorAll('input[name="channel"]');
const demoSaturationInput = document.querySelector('#demo-saturation');
const demoSaturationControl = document.querySelector('#demo-saturation-control');
const calibrationStatus = document.querySelector('#calibration-status');
const calibrationQuality = document.querySelector('#calibration-quality');
const calibrationPointsList = document.querySelector('#calibration-points');
const wavelengthPreset = document.querySelector('#wavelength-preset');
const wavelengthValue = document.querySelector('#wavelength-value');
const pickCalibrationPoint = document.querySelector('#pick-calibration-point');
const calibrationOrder = document.querySelector('#calibration-order');
const fitCalibrationButton = document.querySelector('#fit-calibration');
const restoreCalibrationButton = document.querySelector('#restore-calibration');

let mode = 'demo';
let drawDemoFrame = createSyntheticRenderer(context, canvas.width, canvas.height);
let frameLimit = Number(frameAverageInput.value);
let frameStack = [];
let averagedSpectrum = null;
let lastCropKey = '';
let lastVideoTime = -1;
let calibrationPoints = [];
let calibration = null;
let calibrationMetadata = null;
let calibrationValid = false;
let fitOrder = 1;
let pickingCalibrationPoint = false;
let pendingCalibrationWavelength = null;
let savedCalibration = null;
let savedRestoreAttempted = false;
const CALIBRATION_STORAGE_KEY = 'webcam-spectrometer-calibration-v1';
const visibleChannels = new Set(
  [...channelOptions].filter((option) => option.checked).map((option) => option.value),
);

const camera = createCamera({
  video,
  selector: document.querySelector('#camera-select'),
  button: document.querySelector('#camera-button'),
  status,
  exposureControls: document.querySelector('#exposure-controls'),
  exposureNotice: document.querySelector('#exposure-notice'),
});

const crop = createCropController({
  sourceCanvas: canvas,
  overlayCanvas: document.querySelector('#crop-overlay'),
  stripCanvas: document.querySelector('#crop-strip'),
  onChange: handleCropChange,
});

function showStatus(message, state = 'normal') {
  status.textContent = message;
  status.dataset.state = state;
}

function currentCropBounds() {
  const rectangle = crop.getRect();
  const minPx = Math.max(0, Math.floor(rectangle.x));
  const maxPx = Math.min(canvas.width, Math.ceil(rectangle.x + rectangle.width)) - 1;
  return { minPx, maxPx };
}

function currentCalibrationMetadata() {
  return {
    cropRect: { ...crop.getRect() },
    videoResolution: { width: canvas.width, height: canvas.height },
    cameraDeviceLabel: mode === 'demo' ? 'Synthetic demo' : camera.getDeviceLabel(),
  };
}

function savedCalibrationData() {
  return createCalibrationRecord(calibrationPoints, fitOrder, calibration, calibrationMetadata);
}

function saveCalibration() {
  savedCalibration = savedCalibrationData();
  try {
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(savedCalibration));
    restoreCalibrationButton.hidden = false;
  } catch {
    calibrationStatus.textContent = 'Calibration is active, but browser storage is unavailable.';
    calibrationStatus.dataset.state = 'warning';
  }
}

function clearSavedCalibration() {
  savedCalibration = null;
  restoreCalibrationButton.hidden = true;
  try {
    localStorage.removeItem(CALIBRATION_STORAGE_KEY);
  } catch {
    // Storage may be disabled by the browser.
  }
}

function setCalibrationStatus(message, warning = false) {
  calibrationStatus.textContent = message;
  calibrationStatus.dataset.state = warning ? 'warning' : 'normal';
}

function updateGraph() {
  drawGraph(graphCanvas, averagedSpectrum, visibleChannels, {
    pixelOffset: averagedSpectrum?.pixelOffset ?? 0,
    calibration: calibrationValid ? calibration : null,
    calibrationPoints: calibrationValid ? calibrationPoints : [],
  });
}

function renderCalibrationPoints() {
  calibrationPointsList.replaceChildren();
  const residuals = calibrationValid ? calibration.residuals : [];

  calibrationPoints.forEach((point, index) => {
    const item = document.createElement('li');
    item.className = 'calibration-point';
    const residual = residuals[index];
    const detail = document.createElement('span');
    const residualText = residual ? ` · residual ${residual.residualNm >= 0 ? '+' : ''}${residual.residualNm.toFixed(3)} nm` : '';
    detail.textContent = `${point.px.toFixed(2)} px → ${point.nm} nm${residualText}`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove calibration point at ${point.px.toFixed(2)} pixels`);
    remove.addEventListener('click', () => {
      calibrationPoints.splice(index, 1);
      if (calibrationPoints.length < 2) {
        calibration = null;
        calibrationMetadata = null;
        calibrationValid = false;
        clearSavedCalibration();
        setCalibrationStatus('Add at least two points to fit a calibration.');
        renderCalibrationUi();
        updateGraph();
      } else {
        if (fitOrder === 2 && calibrationPoints.length < 3) {
          fitOrder = 1;
          calibrationOrder.value = '1';
        }
        fitCurrentCalibration();
      }
    });

    item.append(detail, remove);
    calibrationPointsList.append(item);
  });
}

function renderCalibrationUi() {
  const orderTwoOption = calibrationOrder.querySelector('option[value="2"]');
  orderTwoOption.disabled = calibrationPoints.length < 3;
  if (fitOrder === 2 && calibrationPoints.length < 3) {
    fitOrder = 1;
    calibrationOrder.value = '1';
  }
  fitCalibrationButton.disabled = calibrationPoints.length < fitOrder + 1;

  if (calibrationValid && calibration) {
    const r2 = calibrationPoints.length >= 3 ? ` · R² ${calibration.r2.toFixed(5)}` : '';
    calibrationQuality.textContent = `${fitOrder === 1 ? 'Linear' : 'Quadratic'} fit · RMS ${calibration.rmsResidualNm.toFixed(4)} nm${r2}`;
  } else if (calibrationPoints.length >= 2 && !calibrationValid) {
    calibrationQuality.textContent = 'Calibration inactive · graph uses pixel axis';
  } else {
    calibrationQuality.textContent = 'No calibration fit';
  }

  renderCalibrationPoints();
}

function fitCurrentCalibration() {
  if (calibrationPoints.length < fitOrder + 1) {
    calibration = null;
    calibrationValid = false;
    setCalibrationStatus(`At least ${fitOrder + 1} points are required for this fit order.`, true);
    renderCalibrationUi();
    updateGraph();
    return false;
  }

  try {
    calibration = fitCalibration(calibrationPoints, fitOrder, currentCropBounds());
    calibrationMetadata = currentCalibrationMetadata();
    calibrationValid = true;
    setCalibrationStatus('Calibration is active. Click Fit calibration after changing assignments.');
    saveCalibration();
    renderCalibrationUi();
    updateGraph();
    return true;
  } catch (error) {
    calibration = null;
    calibrationValid = false;
    setCalibrationStatus(error.message, true);
    renderCalibrationUi();
    updateGraph();
    return false;
  }
}

function invalidateCalibration(reason) {
  if (!calibrationValid) return;
  calibrationValid = false;
  setCalibrationStatus(`Calibration no longer valid: ${reason}. Refit the points or restore a matching saved setup.`, true);
  renderCalibrationUi();
  updateGraph();
}

function handleCropChange(nextRectangle) {
  if (!calibrationValid || !calibrationMetadata) return;
  const reason = calibrationInvalidationReason(calibrationMetadata, {
    ...currentCalibrationMetadata(),
    cropRect: nextRectangle,
  });
  if (reason) invalidateCalibration(reason);
}

function applySavedCalibration(data) {
  const restored = restoreCalibrationRecord(data, currentCropBounds());
  calibrationPoints = restored.points;
  fitOrder = restored.fitOrder;
  calibrationOrder.value = String(fitOrder);
  calibration = restored.calibration;
  calibrationMetadata = currentCalibrationMetadata();
  calibrationValid = true;
  savedRestoreAttempted = true;
  setCalibrationStatus('Saved calibration restored for this camera and crop.');
  renderCalibrationUi();
  updateGraph();
}

function maybeRestoreSavedCalibration() {
  if (!savedCalibration || savedRestoreAttempted || calibrationValid) return;
  if (mode === 'demo' && savedCalibration.cameraDeviceLabel !== 'Synthetic demo') return;
  savedRestoreAttempted = true;
  const restoreReason = calibrationRestoreReason(savedCalibration, currentCalibrationMetadata());
  if (restoreReason) {
    setCalibrationStatus(`${restoreReason}.`, true);
    restoreCalibrationButton.hidden = false;
    return;
  }

  try {
    crop.setRect(savedCalibration.cropRect);
    applySavedCalibration(savedCalibration);
  } catch {
    setCalibrationStatus('Saved calibration could not be restored; add points and recalibrate.', true);
    clearSavedCalibration();
  }
}

function loadSavedCalibration() {
  try {
    const stored = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!stored) return;
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed.points) || parsed.points.length < 2 || ![1, 2].includes(parsed.fitOrder)) return;
    savedCalibration = parsed;
    restoreCalibrationButton.hidden = false;
  } catch {
    clearSavedCalibration();
  }
}

function setCanvasSize(width, height) {
  if (canvas.width === width && canvas.height === height) return;
  const resolutionChanged = canvas.width !== width || canvas.height !== height;
  canvas.width = width;
  canvas.height = height;
  previewStage.style.aspectRatio = `${width} / ${height}`;
  frameSize.textContent = `${width} × ${height}`;
  if (resolutionChanged && calibrationMetadata) {
    const reason = calibrationInvalidationReason(calibrationMetadata, currentCalibrationMetadata());
    if (reason) invalidateCalibration(reason);
  }
}

function clearFrameStack() {
  frameStack = [];
  averagedSpectrum = null;
}

function updateSpectrum(rectangle) {
  const x = Math.max(0, Math.floor(rectangle.x));
  const y = Math.max(0, Math.floor(rectangle.y));
  const right = Math.min(canvas.width, Math.ceil(rectangle.x + rectangle.width));
  const bottom = Math.min(canvas.height, Math.ceil(rectangle.y + rectangle.height));
  const width = right - x;
  const height = bottom - y;
  if (width < 1 || height < 1) return;

  const cropKey = [canvas.width, canvas.height, x, y, width, height].join(':');
  if (cropKey !== lastCropKey) {
    clearFrameStack();
    lastCropKey = cropKey;
  }

  const image = context.getImageData(x, y, width, height);
  const currentSpectrum = extractSpectrum(image.data, width, height);
  frameStack.push(currentSpectrum);
  if (frameStack.length > frameLimit) frameStack.shift();

  averagedSpectrum = frameStack.reduce(
    (average, spectrum, index) => accumulate(average, spectrum, index + 1),
    null,
  );
  averagedSpectrum.pixelOffset = x;
  graphReadout.textContent = `${width} px · ${frameStack.length} / ${frameLimit} frames`;
  maybeRestoreSavedCalibration();
  updateGraph();

  if (currentSpectrum.saturatedColumns.length > 0) {
    saturationWarning.hidden = false;
    saturationWarning.textContent = `Saturated signal: ${currentSpectrum.saturatedColumns.length} of ${width} columns contain full-scale pixels (255). Reduce exposure to avoid clipped peaks.`;
  } else {
    saturationWarning.hidden = true;
    saturationWarning.textContent = '';
  }
}

function renderFrame() {
  let frameReady = false;
  let newFrame = false;
  if (mode === 'demo') {
    setCanvasSize(640, 360);
    drawDemoFrame();
    frameReady = true;
    newFrame = true;
  } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width > 0 && height > 0) {
      frameReady = true;
      if (video.currentTime !== lastVideoTime) {
        setCanvasSize(width, height);
        context.drawImage(video, 0, 0, width, height);
        lastVideoTime = video.currentTime;
        newFrame = true;
      }
    }
  } else {
    context.fillStyle = '#080c0e';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#91a09c';
    context.font = '14px Manrope, sans-serif';
    context.textAlign = 'center';
    context.fillText('Start the camera to view a live frame', canvas.width / 2, canvas.height / 2);
  }

  frameSize.textContent = `${canvas.width} × ${canvas.height}`;
  crop.update();
  const rectangle = crop.getRect();
  cropSize.textContent = `${Math.round(rectangle.width)} × ${Math.round(rectangle.height)} px`;
  if (frameReady) {
    if (newFrame) updateSpectrum(rectangle);
  } else {
    clearFrameStack();
    lastCropKey = '';
    graphReadout.textContent = 'Waiting for frame';
    saturationWarning.hidden = true;
    updateGraph();
  }
  requestAnimationFrame(renderFrame);
}

function setMode(nextMode) {
  if (mode !== nextMode) invalidateCalibration('camera source changed');
  mode = nextMode;
  clearFrameStack();
  lastCropKey = '';
  lastVideoTime = -1;
  savedRestoreAttempted = false;
  const isDemo = mode === 'demo';
  demoSaturationControl.hidden = !isDemo;
  camera.setEnabled(!isDemo);

  if (isDemo) {
    frameDescription.textContent = 'Synthetic spectrum';
    sourceDetail.textContent = `Demo peaks at ${SYNTHETIC_PEAKS.join(', ')} px`;
    showStatus('Demo mode is running. No camera is required.');
  } else {
    frameDescription.textContent = 'Webcam image';
    sourceDetail.textContent = 'Camera frames are displayed at their source resolution';
  }
}

sourceOptions.forEach((option) => {
  option.addEventListener('change', () => {
    if (option.checked) setMode(option.value);
  });
});

function selectedWavelength() {
  if (wavelengthPreset.value === 'custom' || wavelengthPreset.value === '') {
    return wavelengthValue.value === '' ? null : Number(wavelengthValue.value);
  }
  return Number(wavelengthPreset.value);
}

function updatePickButton() {
  const wavelength = selectedWavelength();
  pickCalibrationPoint.disabled = !Number.isFinite(wavelength) || wavelength <= 0;
}

function setupWavelengthPresets() {
  wavelengthPreset.replaceChildren(new Option('Choose preset', ''));
  WAVELENGTH_PRESETS.forEach(({ label, nm }) => wavelengthPreset.add(new Option(label, String(nm))));
  wavelengthPreset.add(new Option('Custom', 'custom'));
}

wavelengthPreset.addEventListener('change', () => {
  wavelengthValue.value = wavelengthPreset.value && wavelengthPreset.value !== 'custom'
    ? wavelengthPreset.value
    : '';
  updatePickButton();
});

wavelengthValue.addEventListener('input', () => {
  if (wavelengthValue.value !== '') wavelengthPreset.value = 'custom';
  updatePickButton();
});

pickCalibrationPoint.addEventListener('click', () => {
  const wavelength = selectedWavelength();
  if (!Number.isFinite(wavelength) || wavelength <= 0) return;
  pickingCalibrationPoint = !pickingCalibrationPoint;
  pendingCalibrationWavelength = pickingCalibrationPoint ? wavelength : null;
  pickCalibrationPoint.textContent = pickingCalibrationPoint ? 'Cancel point' : 'Pick on graph';
  graphCanvas.classList.toggle('is-picking-point', pickingCalibrationPoint);
  setCalibrationStatus(pickingCalibrationPoint
    ? `Click the graph at ${pendingCalibrationWavelength} nm.`
    : 'Point selection canceled.');
});

graphCanvas.addEventListener('click', (event) => {
  if (!pickingCalibrationPoint || !averagedSpectrum) return;
  const pixel = graphPixelFromClientX(
    graphCanvas,
    event.clientX,
    averagedSpectrum.pixelOffset,
    averagedSpectrum.combined.length,
    calibrationValid ? calibration : null,
  );
  if (pixel === null) return;

  calibrationPoints.push({ px: pixel, nm: pendingCalibrationWavelength });
  pickingCalibrationPoint = false;
  pendingCalibrationWavelength = null;
  pickCalibrationPoint.textContent = 'Pick on graph';
  graphCanvas.classList.remove('is-picking-point');
  if (calibrationPoints.length >= fitOrder + 1) {
    fitCurrentCalibration();
  } else {
    setCalibrationStatus('Add one more wavelength point to fit a linear calibration.');
    renderCalibrationUi();
  }
});

calibrationOrder.addEventListener('change', () => {
  fitOrder = Number(calibrationOrder.value);
  if (calibrationPoints.length >= fitOrder + 1) fitCurrentCalibration();
});

fitCalibrationButton.addEventListener('click', () => fitCurrentCalibration());

restoreCalibrationButton.addEventListener('click', () => {
  if (!savedCalibration) return;
  const restoreReason = calibrationRestoreReason(savedCalibration, currentCalibrationMetadata());
  if (restoreReason) {
    setCalibrationStatus(`${restoreReason}.`, true);
    return;
  }
  try {
    crop.setRect(savedCalibration.cropRect);
    applySavedCalibration(savedCalibration);
  } catch (error) {
    setCalibrationStatus(`Saved calibration could not be restored: ${error.message}`, true);
  }
});

document.querySelector('#camera-select').addEventListener('change', () => {
  savedRestoreAttempted = false;
  invalidateCalibration('selected camera changed');
});

channelOptions.forEach((option) => {
  option.addEventListener('change', () => {
    if (option.checked) visibleChannels.add(option.value);
    else visibleChannels.delete(option.value);
    updateGraph();
  });
});

frameAverageInput.addEventListener('change', () => {
  frameLimit = Math.max(1, Math.min(32, Math.round(Number(frameAverageInput.value) || 1)));
  frameAverageInput.value = String(frameLimit);
  clearFrameStack();
});

demoSaturationInput.addEventListener('change', () => {
  drawDemoFrame = createSyntheticRenderer(context, 640, 360, {
    saturate: demoSaturationInput.checked,
  });
  clearFrameStack();
});

document.querySelector('#reset-crop').addEventListener('click', () => crop.reset());

setupWavelengthPresets();
loadSavedCalibration();
renderCalibrationUi();
updateGraph();
setMode('demo');
requestAnimationFrame(renderFrame);