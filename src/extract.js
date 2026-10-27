const CHANNELS = ['r', 'g', 'b', 'combined'];

export function extractSpectrum(rgba, width, height, {
	rowStart = 0,
	rowEnd = height,
	combine = 'mean',
} = {}) {
	if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
		throw new RangeError('Spectrum dimensions must be positive integers.');
	}
	if (rgba.length !== width * height * 4) {
		throw new RangeError('RGBA data length must match the supplied dimensions.');
	}
	if (!['mean', 'max', 'luma'].includes(combine)) {
		throw new RangeError(`Unsupported combined intensity mode: ${combine}`);
	}

	const firstRow = Math.max(0, Math.min(height, Math.floor(rowStart)));
	const lastRow = Math.max(0, Math.min(height, Math.ceil(rowEnd)));
	if (lastRow <= firstRow) {
		throw new RangeError('The selected row range must contain at least one row.');
	}

	const rowCount = lastRow - firstRow;
	const spectrum = {
		r: new Float32Array(width),
		g: new Float32Array(width),
		b: new Float32Array(width),
		combined: new Float32Array(width),
		saturatedColumns: [],
	};

	for (let x = 0; x < width; x += 1) {
		let redTotal = 0;
		let greenTotal = 0;
		let blueTotal = 0;
		let combinedTotal = 0;
		let saturated = false;

		for (let y = firstRow; y < lastRow; y += 1) {
			const offset = (y * width + x) * 4;
			const red = rgba[offset];
			const green = rgba[offset + 1];
			const blue = rgba[offset + 2];
			redTotal += red;
			greenTotal += green;
			blueTotal += blue;

			if (red === 255 || green === 255 || blue === 255) saturated = true;

			if (combine === 'max') {
				combinedTotal += Math.max(red, green, blue);
			} else if (combine === 'luma') {
				combinedTotal += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
			} else {
				combinedTotal += (red + green + blue) / 3;
			}
		}

		spectrum.r[x] = redTotal / rowCount;
		spectrum.g[x] = greenTotal / rowCount;
		spectrum.b[x] = blueTotal / rowCount;
		spectrum.combined[x] = combinedTotal / rowCount;
		if (saturated) spectrum.saturatedColumns.push(x);
	}

	return spectrum;
}

export function accumulate(previous, next, nFrames) {
	if (!Number.isInteger(nFrames) || nFrames < 1) {
		throw new RangeError('Frame count must be a positive integer.');
	}

	for (const channel of CHANNELS) {
		if (!next[channel] || !ArrayBuffer.isView(next[channel])) {
			throw new TypeError(`The next spectrum is missing the ${channel} array.`);
		}
		if (previous && (!previous[channel] || previous[channel].length !== next[channel].length)) {
			throw new RangeError(`The ${channel} arrays must have matching lengths.`);
		}
	}

	const averaged = {};
	CHANNELS.forEach((channel) => {
		const values = next[channel];
		const result = new Float32Array(values.length);
		for (let index = 0; index < values.length; index += 1) {
			result[index] = previous
				? (previous[channel][index] * (nFrames - 1) + values[index]) / nFrames
				: values[index];
		}
		averaged[channel] = result;
	});
	averaged.saturatedColumns = next.saturatedColumns ? [...next.saturatedColumns] : [];
	return averaged;
}