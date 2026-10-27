# Webcam Spectrometer: Spec

A single-page, frontend-only web app that turns a webcam looking at a diffraction-grating spectrum into a calibrated spectral graph.

**Pipeline:** webcam feed → user crops to the spectrum → per-column intensity (R, G, B, combined) → known-peak wavelength calibration → graph with nm axis, peak detection, and export.

---

## 1. Working rules (for any AI assistant or contributor)

1. **One request = one change.** Do exactly what was asked. No unrequested refactors, no "improvements".
2. **Never remove or disable an existing feature to make a new one easier.** If a conflict seems unavoidable, stop and ask.
3. **After every change, run the regression checklist (section 10).** Report each item as pass, fail, or "not built yet". "Syntax passed" is not verification.
4. **Commit after every completed change** with a message that names it.
5. **All asset paths are relative** (`styles.css`, `src/app.js`, never `/styles.css`). The site is deployed on GitHub Pages under `/<repo-name>/`, and root-absolute paths break there.
6. **Pure math lives in pure functions** (section 6) with no DOM access, so it can be tested with plain inputs.
7. If a user report sounds like a bug, treat it as a bug. Do not explain it away.

---

## 2. How spectrometer software works (research summary)

This is the model the app implements. It follows the approach of established open tools (Public Lab Spectral Workbench, PySpectrometer2/3, and similar DIY Raspberry Pi tools).

### 2.1 Optics, and why the image looks the way it does

A slit plus a diffraction grating in front of a camera spreads incoming light into a spectrum, which lands on the sensor as a horizontal band. **Horizontal position along the band corresponds to wavelength.** Vertical position carries essentially no spectral information; it is just the slit's height, so rows of the band are repeated measurements of the same spectrum. The software's job is to collapse that 2D band into a 1D curve of intensity vs. position, then label position with wavelength.

### 2.2 Extracting the 1D spectrum

- **Choose a cross-section.** Spectral Workbench reads a single row of pixels by default. Other tools average over a band of rows, which lowers noise. PySpectrometer3, for example, lets the user average anywhere from 1 to 41 rows. The band should be narrow enough that spectral lines are still effectively vertical, because lines in DIY instruments are often slightly curved.
- **Per-column intensity.** For each pixel column x in the crop, take the mean over the chosen rows of each channel (R, G, B), and a combined intensity. The channels exist because the sensor has red, green and blue filters, so each channel responds to a different part of the spectrum. The combined curve is what you calibrate and analyze; the per-channel curves are useful for diagnosing exposure and sensor response.
- **Temporal averaging (frame stacking).** Individual pixels are noisy and fluctuate independently from frame to frame. Averaging across several frames reduces noise, but it cannot add resolution. Cheap webcams have roughly 1 pixel per nanometer at 640 px width, so a sharp source line is often defined by only a pixel or two.
- **Smoothing and peak detection.** Savitzky-Golay smoothing is commonly used before finding peaks, but it can create artifacts, shift maxima, or invent faint lines if over-applied. Keep smoothing optional and light, and do peak detection on a lightly smoothed copy while always keeping the raw curve available.

### 2.3 Wavelength calibration with known peaks

Calibration maps pixel column → wavelength (nm) using spectral lines whose wavelengths are known.

- The standard reference is a **compact fluorescent lamp (CFL)**, whose mercury lines are sharp and always at the same wavelengths. The two lines almost every tool uses are **Hg 435.833 nm (blue)** and **Hg 546.074 nm (green)**.
- Two points give a **linear** map. With three or more peaks, fit a **low-order polynomial** (linear or quadratic) by least squares and report the residuals, because the pixel-to-wavelength relationship is not perfectly linear.
- **Caveats about CFL peaks:** not every CFL line is a reliable reference (only a subset are precise; the rest vary between lamps or are broad). A bright green line near 542-543 nm in many CFLs is *not* the mercury 546 nm line (it is generally attributed to terbium). If the user picks the wrong green peak, the whole calibration is off. The UI must make it easy to see which peak was assigned to which wavelength.
- Calibration is only valid for the geometry it was made in. If the camera moves, the slit/grating shifts, the resolution changes, or the crop's horizontal extent changes, recalibrate.
- Good calibration needs **no clipping**. Over-exposure flattens peak tops and makes peak positions unreliable.

### 2.4 Intensity is relative

Without extra work (camera spectral response correction, reference lamp), intensity values are relative and uncalibrated. The y-axis should be labeled "relative intensity (arb. units)". Optional improvements: dark-frame subtraction (capture with the slit covered, subtract per pixel) and normalization.

### 2.5 Browser and camera realities (this is a web app)

- `getUserMedia` requires **HTTPS or localhost**. GitHub Pages is HTTPS, so it is fine.
- Browsers may pick the wrong camera (the laptop webcam instead of the spectrometer's camera). Provide a **camera selector** using `enumerateDevices()` and `deviceId`.
- Auto exposure, auto white balance and auto gain wreck spectra because the curve shifts when the scene changes. Try to switch them to manual via `track.getCapabilities()` / `applyConstraints()` (`exposureMode`, `whiteBalanceMode`, and exposure time/ISO/gain where available). **These controls are only reliably supported in Chromium-based browsers (Chrome, Edge); Firefox does not support `getCapabilities()`.** The app must feature-detect, show sliders only for supported controls, and otherwise show a notice telling the user to disable auto settings in their OS or camera utility.
- Read pixels by drawing the `<video>` frame to a `<canvas>` and calling `getImageData` (create the 2D context with `willReadFrequently: true`). Work in **source video pixel coordinates**, not CSS pixels, so the x-axis is consistent regardless of how the video is displayed.
- 8-bit video from a browser is typically processed (gamma, color correction) by the camera pipeline. Do not claim linear, physical intensities.

---

## 3. Scope

### MVP (must have)
1. Live webcam feed with camera selector and start/stop.
2. Crop tool: user draws and adjusts a rectangle on the video so that only the spectrum band is inside.
3. Row-averaged per-column intensity for R, G, B and combined, shown as a live graph.
4. Saturation warning when pixels in the crop reach full scale.
5. Calibration: user assigns known wavelengths to peaks (by clicking detected peaks or graph positions, choosing from a preset list or typing a value), app fits pixel → nm, graph x-axis switches to nm.
6. Calibration quality readout (residuals, and R² when 3+ points) and a warning when calibration is invalidated.
7. Peak detection with a labeled peak table (nm, relative intensity).
8. Save/load calibration in `localStorage`.
9. Export: CSV of the calibrated spectrum and PNG of the graph.

### Stretch
- Frame averaging control; row-band height control; smoothing control.
- Dark-frame capture and subtraction.
- Freeze / capture a spectrum and overlay it on live data.
- Graph line colored by approximate visible color for each wavelength.
- Upload an image instead of using a webcam.
- Absorbance mode (reference vs. sample).

### Non-goals
Backend, accounts, build tooling, absolute intensity calibration, mobile-first layout.

---

## 4. Tech and file layout

Plain HTML + CSS + JavaScript ES modules. No build step, no framework. Chart.js or a hand-drawn `<canvas>` graph are both acceptable; if a library is used it must load from a CDN with a pinned version. All paths relative.

```
index.html
styles.css
src/
  app.js            // wiring and UI state only
  camera.js         // getUserMedia, device list, constraint handling
  crop.js           // crop rectangle interaction (overlay canvas)
  extract.js        // frame -> per-column intensities (pure functions + a thin canvas reader)
  calibrate.js      // pixel->nm fitting (pure)
  peaks.js          // smoothing and peak detection (pure)
  graph.js          // drawing the graph
  export.js         // CSV and PNG
  synthetic.js      // synthetic test spectrum generator
README.md
SPEC.md
```

---

## 5. UI layout

- **Left/top:** video preview with the crop rectangle overlay, camera selector, start/stop, exposure controls (if supported).
- **Below the video:** a zoomed strip preview of just the cropped band (so the user can see the spectrum they are measuring).
- **Main panel:** the graph. X-axis is pixel index until calibrated, then nm. Channel toggles (R, G, B, combined). Cursor readout of x and intensity.
- **Side panel:** calibration section (list of assigned points: pixel, nm, remove button; fit order selector; quality readout), peak table, export buttons, saturation indicator.
- Clear status messages for: no camera permission, no camera found, unsupported controls, saturated signal, calibration invalidated.

---

## 6. Core functions (pure, no DOM)

```js
// extract.js
// rgba: Uint8ClampedArray from getImageData of the crop; w, h: crop size in source pixels
// returns { r: Float32Array(w), g: ..., b: ..., combined: ..., saturatedColumns: number[] }
extractSpectrum(rgba, w, h, { rowStart, rowEnd, combine })   // combine: 'mean' (default) | 'max' | 'luma'

// frame stacking: running average of the per-column arrays
accumulate(prev, next, nFrames)

// calibrate.js
// points: [{ px, nm }] with px sub-pixel allowed
fitCalibration(points, order)   // order 1 or 2; returns { coeffs, order, rmsResidualNm, r2, residuals }
                                // requires >= order+1 points; throws or returns an error object otherwise
pixelToNm(cal, px)
nmToPixel(cal, nm)              // numeric inverse (bisection/Newton); calibration must be monotonic

// peaks.js
smooth(arr, windowSize)         // light smoothing (moving average or Savitzky-Golay); never mutates input
findPeaks(arr, { minProminence, minDistance })   // returns [{ index, value }]
refinePeak(arr, index)          // sub-pixel position by quadratic (parabolic) interpolation on 3 points
```

Calibration state saved to `localStorage` must include: points, fit order, coefficients, **crop rectangle, video resolution, and camera device label** at calibration time.

---

## 7. Calibration behavior (details)

1. User points the instrument at a CFL (or any source with known lines) and aims for a bright but **non-saturated** spectrum.
2. App auto-detects peaks and marks them on the graph. User clicks a peak (or any graph position) and selects its wavelength from a preset list or types one.
3. Preset list (editable in code; verify values against a reference such as NIST before relying on them):
   - Hg 404.66 nm
   - Hg 435.833 nm
   - Hg 546.074 nm
   - Hg 576.96 nm and 579.07 nm (doublet, often unresolved on webcams)
   - Eu ~611 nm (CFL red phosphor)
   - Tb ~542-544 nm (CFL green phosphor; **not** the Hg 546 line)
4. Once two points exist, the graph switches to nm (linear). With three or more points the user can choose order 1 or 2; the app shows RMS residual in nm and each point's residual, so a bad assignment is obvious.
5. Peak positions use sub-pixel refinement.
6. After calibration, the app overlays expected-line markers for the preset peaks so the user can sanity-check.
7. **Invalidation:** if the crop's x-offset or width, the video resolution, or the selected camera changes after calibration, show "Calibration no longer valid" and fall back to pixel axis until the user recalibrates (or explicitly restores the saved calibration). Changing only the crop's vertical extent does **not** invalidate calibration.

---

## 8. Invariants (log a warning in the console if any fail)

1. Extracted arrays have length equal to the crop width in source pixels.
2. Changing the crop's rows never changes the x-axis calibration.
3. `fitCalibration` with exactly two points maps both points exactly.
4. The calibration is strictly monotonic over the crop width (wavelength never decreases as pixel increases, or never increases, consistently). Reject a fit that is not.
5. `nmToPixel(pixelToNm(x))` returns x within 0.01 px.
6. Combined intensity is always within 0-255 and the per-channel arrays are within 0-255.
7. The graph never silently clips: values at 255 must trigger the saturation warning.

---

## 9. Testing without hardware

`synthetic.js` must provide a **demo mode** that generates a fake spectrum image (dark background, a band of rows containing Gaussian peaks at known pixel positions, small random noise, optional saturation) and feeds it through the same pipeline as the webcam. This lets every milestone be tested without a spectrometer: with known peak positions, calibration and peak detection can be checked against exact expected values. Add a small set of pure-function tests (a simple `tests.html` that runs in the browser and prints pass/fail is enough) for `fitCalibration`, `pixelToNm`/`nmToPixel`, `findPeaks`, `refinePeak` and `extractSpectrum`.

---

## 10. Regression checklist (run after EVERY change; report pass, fail, or "not built yet")

- [ ] Page loads from a local server and from GitHub Pages with no 404s (all paths relative).
- [ ] Camera permission prompt works; denied permission shows a clear message.
- [ ] Camera selector lists devices and switching works.
- [ ] Crop rectangle can be drawn, moved and resized; spectrum strip preview updates.
- [ ] Live graph updates; array length matches crop width.
- [ ] R, G, B, combined toggles work.
- [ ] Saturation warning appears when the signal is clipped (use demo mode).
- [ ] Demo mode works without a camera.
- [ ] Calibration with two assigned peaks switches the axis to nm; points can be removed.
- [ ] Calibration quality readout shows residuals; a wrong assignment is visible.
- [ ] Changing crop x-range or width shows "calibration no longer valid"; changing only vertical extent does not.
- [ ] Saved calibration restores after reload.
- [ ] Peak table lists detected peaks with nm and intensity.
- [ ] CSV and PNG export produce correct files.
- [ ] `tests.html` passes.

---

## 11. Milestones (build in this order; one milestone per request; commit after each)

| # | Milestone | Done when |
|---|-----------|-----------|
| M1 | Scaffold, camera feed, camera selector, canvas readout, demo mode shell | live or synthetic video shows; relative paths; deploys on Pages |
| M2 | Crop tool and strip preview | crop adjustable; cropped band displayed |
| M3 | Extraction and graph (pixel axis), channels, saturation warning, frame averaging | live graph; synthetic peaks appear at expected pixels; tests for `extractSpectrum` |
| M4 | Peak detection and sub-pixel refinement | peak table matches synthetic ground truth |
| M5 | Calibration (fit, UI, quality readout, invalidation, persistence) | nm axis; synthetic calibration exact; invalidation works |
| M6 | Export, camera exposure controls, polish | CSV/PNG; exposure sliders where supported; README with usage and limits |

---

## 12. Sources used for this spec (for verification)

- Public Lab, Spectral Workbench calibration guide: https://publiclab.org/wiki/spectral-workbench-calibration
- Public Lab research note on CFL calibration and non-linear dispersion: https://publiclab.org/n/11647
- Public Lab research note on the 542-543 nm CFL peak: https://publiclab.org/n/12654
- PySpectrometer3 notes (row stacking, peak detection, calibration quality, filtering artifacts): https://dehilster.info/astronomy/pyspectrometer3.php
- obstruse/spectrometer (calibration landmarks, overexposure): https://github.com/obstruse/spectrometer
- MDN, Media Capture constraints and capabilities: https://developer.mozilla.org/en-US/docs/Web/API/Media_Streams_API/Constraints

---

