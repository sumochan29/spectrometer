export function createCamera({ video, selector, button, status }) {
  let stream = null;
  let enabled = false;

  function showMessage(message, isError = false) {
    status.textContent = message;
    status.dataset.state = isError ? 'error' : 'normal';
  }

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];

    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    const selectedId = selector.value;
    selector.replaceChildren(new Option('Select a camera', ''));

    cameras.forEach((device, index) => {
      const option = new Option(device.label || `Camera ${index + 1}`, device.deviceId);
      selector.add(option);
    });

    if (cameras.some((device) => device.deviceId === selectedId)) {
      selector.value = selectedId;
    }
    selector.disabled = !enabled || cameras.length === 0;

    return cameras;
  }

  function stop() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    video.srcObject = null;
    button.textContent = 'Start camera';
  }

  async function start() {
    if (!enabled) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      showMessage('Camera access requires HTTPS or localhost in a supported browser.', true);
      return;
    }

    button.disabled = true;
    showMessage('Requesting camera permission...');
    stop();

    try {
      const deviceId = selector.value;
      const constraints = {
        audio: false,
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      button.textContent = 'Stop camera';
      await refreshDevices();
      showMessage('Camera is live.');
    } catch (error) {
      stop();
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
        showMessage('Camera permission was denied. Allow camera access in your browser settings, then try again.', true);
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        await refreshDevices();
        showMessage('No camera was found. Connect a camera or switch to demo mode.', true);
      } else {
        showMessage(`Could not start the camera: ${error.message || 'unknown error'}`, true);
      }
    } finally {
      button.disabled = !enabled;
    }
  }

  button.addEventListener('click', () => {
    if (stream) {
      stop();
      showMessage('Camera stopped.');
    } else {
      start();
    }
  });

  selector.addEventListener('change', () => {
    if (stream) start();
  });

  async function setEnabled(nextEnabled) {
    enabled = nextEnabled;
    selector.disabled = !enabled;
    button.disabled = !enabled;

    if (!enabled) {
      stop();
      showMessage('Camera is off in demo mode.');
      return;
    }

    try {
      const cameras = await refreshDevices();
      if (cameras.length === 0) {
        showMessage('No camera was found. Connect a camera or switch to demo mode.', true);
        selector.disabled = true;
      } else {
        showMessage('Choose a camera and select Start camera.');
      }
    } catch {
      showMessage('Could not list cameras. Check browser camera permissions or use demo mode.', true);
    }
  }

  setEnabled(false);
  return { setEnabled };
}