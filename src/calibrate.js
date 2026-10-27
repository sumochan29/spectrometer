export const WAVELENGTH_PRESETS = Object.freeze([
	{ label: 'Hg 404.66 nm', nm: 404.66 },
	{ label: 'Hg 435.833 nm', nm: 435.833 },
	{ label: 'Hg 546.074 nm', nm: 546.074 },
	{ label: 'Hg 576.96 nm', nm: 576.96 },
	{ label: 'Hg 579.07 nm', nm: 579.07 },
	{ label: 'Eu ~611 nm', nm: 611 },
	{ label: 'Tb ~543 nm (not Hg 546)', nm: 543 },
]);

export function calibrationInvalidationReason(previous, current) {
	if (!previous || !current) return null;
	if (!previous.cropRect || !current.cropRect || !previous.videoResolution || !current.videoResolution) {
		return 'calibration metadata is incomplete';
	}
	if (previous.cameraDeviceLabel !== current.cameraDeviceLabel) return 'selected camera changed';
	if (previous.videoResolution?.width !== current.videoResolution?.width
		|| previous.videoResolution?.height !== current.videoResolution?.height) {
		return 'video resolution changed';
	}
	if (Math.abs(previous.cropRect?.x - current.cropRect?.x) >= 0.5
		|| Math.abs(previous.cropRect?.width - current.cropRect?.width) >= 0.5) {
		return 'crop x-range or width changed';
	}
	return null;
}

export function calibrationRestoreReason(saved, current) {
	if (!saved?.cropRect || !saved?.videoResolution || !current?.videoResolution) {
		return 'saved calibration metadata is incomplete';
	}
	if (saved.cameraDeviceLabel !== current.cameraDeviceLabel) {
		return 'saved calibration belongs to a different camera';
	}
	if (saved.videoResolution.width !== current.videoResolution.width
		|| saved.videoResolution.height !== current.videoResolution.height) {
		return 'saved calibration belongs to a different video resolution';
	}
	return null;
}

export function createCalibrationRecord(points, fitOrder, calibration, metadata) {
	if (!calibration?.coeffs || !metadata?.cropRect || !metadata?.videoResolution) {
		throw new TypeError('A fitted calibration and capture metadata are required.');
	}
	return {
		points: points.map((point) => ({ px: point.px, nm: point.nm })),
		fitOrder,
		coefficients: [...calibration.coeffs],
		cropRect: { ...metadata.cropRect },
		videoResolution: { ...metadata.videoResolution },
		cameraDeviceLabel: metadata.cameraDeviceLabel,
	};
}

export function restoreCalibrationRecord(record, domain) {
	if (!Array.isArray(record?.points) || ![1, 2].includes(record.fitOrder)
		|| !Array.isArray(record.coefficients) || !record.coefficients.every(Number.isFinite)
		|| typeof record.cameraDeviceLabel !== 'string'
		|| !record.cropRect || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(record.cropRect[key]))
		|| !record.videoResolution
		|| !['width', 'height'].every((key) => Number.isInteger(record.videoResolution[key]) && record.videoResolution[key] > 0)) {
		throw new TypeError('Saved calibration data is incomplete.');
	}
	const points = record.points.map(({ px, nm }) => ({ px: Number(px), nm: Number(nm) }));
	return {
		points,
		fitOrder: record.fitOrder,
		calibration: fitCalibration(points, record.fitOrder, domain),
	};
}

function solveLinearSystem(matrix, vector) {
	const size = vector.length;
	const rows = matrix.map((row, index) => [...row, vector[index]]);

	for (let column = 0; column < size; column += 1) {
		let pivot = column;
		for (let row = column + 1; row < size; row += 1) {
			if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
		}
		if (Math.abs(rows[pivot][column]) < 1e-12) {
			throw new RangeError('Calibration points do not determine this fit order.');
		}
		[rows[column], rows[pivot]] = [rows[pivot], rows[column]];

		const divisor = rows[column][column];
		for (let entry = column; entry <= size; entry += 1) rows[column][entry] /= divisor;
		for (let row = 0; row < size; row += 1) {
			if (row === column) continue;
			const factor = rows[row][column];
			for (let entry = column; entry <= size; entry += 1) {
				rows[row][entry] -= factor * rows[column][entry];
			}
		}
	}

	return rows.map((row) => row[size]);
}

function domainFor(points, domain) {
	const minimum = domain?.minPx ?? Math.min(...points.map(({ px }) => px));
	const maximum = domain?.maxPx ?? Math.max(...points.map(({ px }) => px));
	if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) {
		throw new RangeError('Calibration pixel domain must have a positive width.');
	}
	return { minPx: minimum, maxPx: maximum };
}

function fitIsMonotonic(coeffs, order, origin, scale, domain) {
	function derivative(px) {
		const normalized = (px - origin) / scale;
		let value = 0;
		for (let degree = 1; degree <= order; degree += 1) {
			value += degree * coeffs[degree] * normalized ** (degree - 1);
		}
		return value;
	}

	const first = derivative(domain.minPx);
	const last = derivative(domain.maxPx);
	const epsilon = 1e-10;
	const increasing = first >= -epsilon && last >= -epsilon && (first > epsilon || last > epsilon);
	const decreasing = first <= epsilon && last <= epsilon && (first < -epsilon || last < -epsilon);
	return increasing || decreasing;
}

export function fitCalibration(points, order = 1, requestedDomain) {
	if (![1, 2].includes(order)) throw new RangeError('Calibration order must be 1 or 2.');
	if (!Array.isArray(points) || points.length < order + 1) {
		throw new RangeError(`At least ${order + 1} calibration points are required for order ${order}.`);
	}
	if (points.some(({ px, nm }) => !Number.isFinite(px) || !Number.isFinite(nm))) {
		throw new TypeError('Calibration points must have finite pixel and wavelength values.');
	}

	const domain = domainFor(points, requestedDomain);
	const origin = (domain.minPx + domain.maxPx) / 2;
	const scale = (domain.maxPx - domain.minPx) / 2;
	const terms = order + 1;
	const matrix = Array.from({ length: terms }, () => new Array(terms).fill(0));
	const vector = new Array(terms).fill(0);

	points.forEach(({ px, nm }) => {
		const normalized = (px - origin) / scale;
		const powers = Array.from({ length: terms }, (_, degree) => normalized ** degree);
		for (let row = 0; row < terms; row += 1) {
			vector[row] += powers[row] * nm;
			for (let column = 0; column < terms; column += 1) {
				matrix[row][column] += powers[row] * powers[column];
			}
		}
	});

	const coeffs = solveLinearSystem(matrix, vector);
	if (!fitIsMonotonic(coeffs, order, origin, scale, domain)) {
		throw new RangeError('Calibration fit is not strictly monotonic across the crop width.');
	}

	const residuals = points.map(({ px, nm }) => {
		const predictedNm = pixelToNm({ coeffs, origin, scale }, px);
		return { px, nm, predictedNm, residualNm: predictedNm - nm };
	});
	const residualSumSquares = residuals.reduce((sum, item) => sum + item.residualNm ** 2, 0);
	const meanNm = points.reduce((sum, point) => sum + point.nm, 0) / points.length;
	const totalSumSquares = points.reduce((sum, point) => sum + (point.nm - meanNm) ** 2, 0);

	return {
		coeffs,
		order,
		origin,
		scale,
		domain,
		rmsResidualNm: Math.sqrt(residualSumSquares / points.length),
		r2: totalSumSquares === 0
			? (residualSumSquares === 0 ? 1 : 0)
			: 1 - residualSumSquares / totalSumSquares,
		residuals,
	};
}

export function pixelToNm(calibration, px) {
	if (!calibration?.coeffs || !Number.isFinite(px)) {
		throw new TypeError('A calibration and finite pixel position are required.');
	}
	const normalized = (px - calibration.origin) / calibration.scale;
	return calibration.coeffs.reduce(
		(wavelength, coefficient, degree) => wavelength + coefficient * normalized ** degree,
		0,
	);
}

export function nmToPixel(calibration, nm) {
	if (!Number.isFinite(nm)) throw new TypeError('A finite wavelength is required.');
	const { minPx, maxPx } = calibration.domain;
	const minimumNm = pixelToNm(calibration, minPx);
	const maximumNm = pixelToNm(calibration, maxPx);
	const increasing = maximumNm > minimumNm;
	const lowNm = Math.min(minimumNm, maximumNm);
	const highNm = Math.max(minimumNm, maximumNm);
	if (nm < lowNm - 1e-9 || nm > highNm + 1e-9) {
		throw new RangeError('Wavelength falls outside the calibration pixel domain.');
	}
	if (Math.abs(nm - minimumNm) < 1e-12) return minPx;
	if (Math.abs(nm - maximumNm) < 1e-12) return maxPx;

	let low = minPx;
	let high = maxPx;
	for (let iteration = 0; iteration < 80; iteration += 1) {
		const middle = (low + high) / 2;
		const value = pixelToNm(calibration, middle);
		if ((value < nm) === increasing) low = middle;
		else high = middle;
	}
	return (low + high) / 2;
}