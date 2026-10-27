import { nmToPixel, pixelToNm } from './calibrate.js';

const CHANNEL_STYLES = {
	r: { color: '#ff7768', width: 1.8 },
	g: { color: '#c8f169', width: 1.8 },
	b: { color: '#79b8ff', width: 1.8 },
	combined: { color: '#eef3e8', width: 2.2 },
};

const PLOT = { left: 66, top: 20, right: 20, bottom: 58 };

export function drawGraph(canvas, spectra, visibleChannels, {
	pixelOffset = 0,
	calibration = null,
	calibrationPoints = [],
} = {}) {
	const context = canvas.getContext('2d');
	const width = canvas.width;
	const height = canvas.height;
	const plotWidth = width - PLOT.left - PLOT.right;
	const plotHeight = height - PLOT.top - PLOT.bottom;

	context.clearRect(0, 0, width, height);
	context.fillStyle = '#101619';
	context.fillRect(0, 0, width, height);
	context.font = '12px Trebuchet MS, sans-serif';
	context.lineWidth = 1;

	[0, 64, 128, 192, 255].forEach((value) => {
		const y = PLOT.top + plotHeight * (1 - value / 255);
		context.strokeStyle = '#2a3739';
		context.beginPath();
		context.moveTo(PLOT.left, y);
		context.lineTo(width - PLOT.right, y);
		context.stroke();
		context.fillStyle = '#91a09c';
		context.textAlign = 'right';
		context.textBaseline = 'middle';
		context.fillText(String(value), PLOT.left - 10, y);
	});

	const spectrumWidth = spectra?.combined?.length ?? 0;
	for (let tick = 0; tick <= 4; tick += 1) {
		const x = PLOT.left + plotWidth * (tick / 4);
		context.strokeStyle = '#233033';
		context.beginPath();
		context.moveTo(x, PLOT.top);
		context.lineTo(x, height - PLOT.bottom);
		context.stroke();
		context.fillStyle = '#91a09c';
		context.textAlign = 'center';
		context.textBaseline = 'top';
		const fraction = tick / 4;
		const pixel = spectrumWidth > 0 ? pixelOffset + Math.round((spectrumWidth - 1) * fraction) : pixelOffset;
		const firstNm = spectrumWidth > 0 && calibration ? pixelToNm(calibration, pixelOffset) : 0;
		const lastNm = spectrumWidth > 0 && calibration ? pixelToNm(calibration, pixelOffset + spectrumWidth - 1) : 0;
		const axisValue = calibration
			? `${(firstNm + fraction * (lastNm - firstNm)).toFixed(1)}`
			: String(pixel);
		context.fillText(axisValue, x, height - PLOT.bottom + 10);
	}

	context.strokeStyle = '#71807a';
	context.beginPath();
	context.moveTo(PLOT.left, PLOT.top);
	context.lineTo(PLOT.left, height - PLOT.bottom);
	context.lineTo(width - PLOT.right, height - PLOT.bottom);
	context.stroke();

	context.fillStyle = '#b9c4bd';
	context.textAlign = 'center';
	context.textBaseline = 'bottom';
	context.fillText(calibration ? 'wavelength (nm)' : 'pixel index', PLOT.left + plotWidth / 2, height - 8);
	context.save();
	context.translate(16, PLOT.top + plotHeight / 2);
	context.rotate(-Math.PI / 2);
	context.fillText('relative intensity (arb. units)', 0, 0);
	context.restore();

	if (spectrumWidth === 0) {
		context.fillStyle = '#91a09c';
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.fillText('Waiting for spectrum data', PLOT.left + plotWidth / 2, PLOT.top + plotHeight / 2);
		return;
	}

	visibleChannels.forEach((channel) => {
		const values = spectra[channel];
		if (!values) return;
		const style = CHANNEL_STYLES[channel];
		context.strokeStyle = style.color;
		context.lineWidth = style.width;
		context.lineJoin = 'round';
		context.lineCap = 'round';
		context.beginPath();

		for (let index = 0; index < values.length; index += 1) {
			const pixel = pixelOffset + index;
			const x = calibration
				? PLOT.left + plotWidth * (pixelToNm(calibration, pixel) - pixelToNm(calibration, pixelOffset))
					/ (pixelToNm(calibration, pixelOffset + values.length - 1) - pixelToNm(calibration, pixelOffset))
				: PLOT.left + (values.length > 1 ? plotWidth * index / (values.length - 1) : 0);
			const value = Math.max(0, Math.min(255, values[index]));
			const y = PLOT.top + plotHeight * (1 - value / 255);
			if (index === 0) context.moveTo(x, y);
			else context.lineTo(x, y);
		}

		context.stroke();
	});

	if (calibration && spectrumWidth > 0) {
		context.save();
		context.setLineDash([4, 4]);
		calibrationPoints.forEach(({ px, nm }) => {
			if (px < pixelOffset || px > pixelOffset + spectrumWidth - 1) return;
			const x = PLOT.left + plotWidth * (pixelToNm(calibration, px) - pixelToNm(calibration, pixelOffset))
				/ (pixelToNm(calibration, pixelOffset + spectrumWidth - 1) - pixelToNm(calibration, pixelOffset));
			context.strokeStyle = '#f5f1c8';
			context.lineWidth = 1;
			context.beginPath();
			context.moveTo(x, PLOT.top);
			context.lineTo(x, height - PLOT.bottom);
			context.stroke();
			context.setLineDash([]);
			context.fillStyle = '#f5f1c8';
			context.textAlign = 'center';
			context.textBaseline = 'top';
			context.fillText(`${nm} nm`, x, PLOT.top + 4);
			context.setLineDash([4, 4]);
		});
		context.restore();
	}
}

export function graphPixelFromClientX(canvas, clientX, pixelOffset, spectrumWidth, calibration = null) {
	if (spectrumWidth < 1) return null;
	const bounds = canvas.getBoundingClientRect();
	const canvasX = (clientX - bounds.left) * (canvas.width / bounds.width);
	const plotWidth = canvas.width - PLOT.left - PLOT.right;
	const fraction = (canvasX - PLOT.left) / plotWidth;
	if (fraction < 0 || fraction > 1) return null;
	if (!calibration) return pixelOffset + fraction * (spectrumWidth - 1);

	const firstPixel = pixelOffset;
	const lastPixel = pixelOffset + spectrumWidth - 1;
	const firstWavelength = pixelToNm(calibration, firstPixel);
	const lastWavelength = pixelToNm(calibration, lastPixel);
	const selectedWavelength = firstWavelength + fraction * (lastWavelength - firstWavelength);
	return nmToPixel(calibration, selectedWavelength);
}