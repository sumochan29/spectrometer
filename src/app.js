import { createCamera } from './camera.js';
import { createSyntheticRenderer, SYNTHETIC_PEAKS } from './synthetic.js';

const canvas = document.querySelector('#preview');
const context = canvas.getContext('2d', { willReadFrequently: true });
const video = document.querySelector('#camera-video');
const status = document.querySelector('#status');
const frameDescription = document.querySelector('#frame-description');
const frameSize = document.querySelector('#frame-size');
const sourceDetail = document.querySelector('#source-detail');
const sourceOptions = document.querySelectorAll('input[name="source"]');

let mode = 'demo';
let drawDemoFrame = createSyntheticRenderer(context, canvas.width, canvas.height);

const camera = createCamera({
  video,
  selector: document.querySelector('#camera-select'),
  button: document.querySelector('#camera-button'),
  status,
});

function showStatus(message, state = 'normal') {
  status.textContent = message;
  status.dataset.state = state;
}

function setCanvasSize(width, height) {
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  frameSize.textContent = `${width} × ${height}`;
}

function renderFrame() {
  if (mode === 'demo') {
    setCanvasSize(640, 360);
    drawDemoFrame();
  } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width > 0 && height > 0) {
      setCanvasSize(width, height);
      context.drawImage(video, 0, 0, width, height);
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
  requestAnimationFrame(renderFrame);
}

function setMode(nextMode) {
  mode = nextMode;
  const isDemo = mode === 'demo';
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

setMode('demo');
requestAnimationFrame(renderFrame);