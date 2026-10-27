export function getExposureControlDefinitions(capabilities) {
  return [
    { property: 'exposureTime', label: 'Exposure time', unit: 'ms', scale: 1000 },
    { property: 'iso', label: 'ISO', unit: '', scale: 1 },
    { property: 'gain', label: 'Gain', unit: '', scale: 1 },
  ].flatMap((definition) => {
    const range = capabilities[definition.property];
    if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max <= range.min) {
      return [];
    }

    return [{
      ...definition,
      min: range.min,
      max: range.max,
      step: Number.isFinite(range.step) && range.step > 0
        ? range.step
        : (range.max - range.min) / 100,
    }];
  });
}

export function createCamera({ video, selector, button, status, exposureControls, exposureNotice }) {
  let stream = null;
  let enabled = false;
  let exposureTrack = null;
  let exposureInputs = [];

  function showMessage(message, isError = false) {
    status.textContent = message;
    status.dataset.state = isError ? 'error' : 'normal';
  }

  function showExposureNotice(message, isWarning = false) {
    exposureNotice.textContent = message;
    exposureNotice.dataset.state = isWarning ? 'warning' : 'normal';
  }

  function clearExposureControls(message) {
    exposureTrack = null;
    exposureInputs = [];
    exposureControls.replaceChildren();
    showExposureNotice(message);
  }

  function formatControlValue(definition, value) {
    const displayValue = value * definition.scale;
    const formatted = Number(displayValue.toPrecision(4));
    return definition.unit ? `${formatted} ${definition.unit}` : `${formatted}`;
  }

  function createExposureSlider(definition, initialValue) {
    const row = document.createElement('div');
    row.className = 'exposure-control';

    const heading = document.createElement('div');
    heading.className = 'exposure-control-heading';

    const label = document.createElement('label');
    label.textContent = definition.label;

    const value = document.createElement('output');
    value.textContent = formatControlValue(definition, initialValue);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(definition.min);
    input.max = String(definition.max);
    input.step = String(definition.step);
    input.value = String(initialValue);
    input.setAttribute('aria-label', definition.label);
    label.htmlFor = `camera-${definition.property}`;
    input.id = label.htmlFor;

    input.addEventListener('input', () => {
      value.textContent = formatControlValue(definition, Number(input.value));
    });
    input.addEventListener('change', () => applyExposureControls());

    heading.append(label, value);
    row.append(heading, input);
    exposureControls.append(row);
    exposureInputs.push({ definition, input });
  }

  async function applyExposureControls() {
    if (!exposureTrack || typeof exposureTrack.applyConstraints !== 'function') return;

    const constraints = {};
    let capabilities;
    try {
      capabilities = exposureTrack.getCapabilities();
    } catch {
      showExposureNotice('Camera capabilities could not be read. Disable auto-exposure in your OS or camera utility.', true);
      return;
    }

    if (capabilities.exposureMode?.includes('manual')) constraints.exposureMode = 'manual';
    if (capabilities.whiteBalanceMode?.includes('manual')) constraints.whiteBalanceMode = 'manual';
    exposureInputs.forEach(({ definition, input }) => {
      constraints[definition.property] = Number(input.value);
    });

    try {
      await exposureTrack.applyConstraints({ advanced: [constraints] });
      if (constraints.exposureMode === 'manual') {
        showExposureNotice('Manual exposure is active. Adjust exposure time and ISO/gain to avoid clipping.');
      } else {
        showExposureNotice('Values applied, but auto-exposure may override them on this camera.', true);
      }
    } catch (error) {
      showExposureNotice(`The camera rejected these controls. Disable auto-exposure in its system utility if available. ${error.message || ''}`.trim(), true);
    }
  }

  async function configureExposure(track) {
    exposureTrack = track;
    exposureControls.replaceChildren();
    exposureInputs = [];

    if (typeof track.getCapabilities !== 'function' || typeof track.applyConstraints !== 'function') {
      exposureTrack = null;
      showExposureNotice('This browser does not expose manual camera controls. Disable auto-exposure in your OS or camera utility.', true);
      return;
    }

    let capabilities;
    try {
      capabilities = track.getCapabilities();
    } catch {
      exposureTrack = null;
      showExposureNotice('Camera capabilities could not be read. Disable auto-exposure in your OS or camera utility.', true);
      return;
    }

    const definitions = getExposureControlDefinitions(capabilities);
    const manualModeAvailable = capabilities.exposureMode?.includes('manual') ?? false;
    if (definitions.length === 0 && !manualModeAvailable) {
      exposureTrack = null;
      showExposureNotice('This camera does not expose manual exposure controls. Disable auto-exposure in your OS or camera utility.', true);
      return;
    }

    definitions.forEach((definition) => createExposureSlider(definition, definition.min));

    if (definitions.length === 0) {
      showExposureNotice('Manual exposure mode is available, but this camera exposes no exposure-time or ISO/gain slider.', true);
    } else if (!manualModeAvailable) {
      showExposureNotice('Manual values are available, but this camera has no manual exposure mode; auto-exposure may override slider changes.', true);
    } else {
      showExposureNotice('Turning off auto-exposure and applying conservative minimum exposure values...');
    }

    await applyExposureControls();
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
    clearExposureControls('Start the camera to inspect its manual exposure controls.');
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
      await configureExposure(stream.getVideoTracks()[0]);
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
      showExposureNotice('Switch to Webcam and start the camera to inspect its manual controls.');
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
  return {
    setEnabled,
    getDeviceLabel: () => stream?.getVideoTracks()[0]?.label || selector.value || 'Unknown camera',
  };
}