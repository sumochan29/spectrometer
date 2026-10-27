import { createCamera } from './camera.js';
import { createCropController } from './crop.js';
import { accumulate, extractSpectrum } from './extract.js';
import { drawGraph } from './graph.js';
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

let mode = 'demo';
let drawDemoFrame = createSyntheticRenderer(context, canvas.width, canvas.height);
let frameLimit = Number(frameAverageInput.value);
let frameStack = [];
let averagedSpectrum = null;
let lastCropKey = '';
let lastVideoTime = -1;
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
});

function showStatus(message, state = 'normal') {
  status.textContent = message;
  status.dataset.state = state;
}

function setCanvasSize(width, height) {
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  previewStage.style.aspectRatio = `${width} / ${height}`;
  frameSize.textContent = `${width} × ${height}`;
}

function clearFrameStack() {
  frameStack = [];
  averagedSpectrum = null;
}

function updateGraph() {
  drawGraph(graphCanvas, averagedSpectrum, visibleChannels, {
    pixelOffset: averagedSpectrum?.pixelOffset ?? 0,
  });
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
  mode = nextMode;
  clearFrameStack();
  lastCropKey = '';
  lastVideoTime = -1;
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

setMode('demo');
requestAnimationFrame(renderFrame);