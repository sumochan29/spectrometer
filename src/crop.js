const MIN_CROP_SIZE = 8;

export function createCropController({ sourceCanvas, overlayCanvas, stripCanvas, onChange = () => {} }) {
	const overlayContext = overlayCanvas.getContext('2d');
	const stripContext = stripCanvas.getContext('2d');
	let sourceWidth = 0;
	let sourceHeight = 0;
	let rectangle = null;
	let drag = null;

	function defaultRectangle() {
		return {
			x: sourceWidth * 0.1,
			y: sourceHeight * 0.4,
			width: sourceWidth * 0.8,
			height: sourceHeight * 0.2,
		};
	}

	function clamp(value, minimum, maximum) {
		return Math.max(minimum, Math.min(maximum, value));
	}

	function getHandles() {
		const { x, y, width, height } = rectangle;
		const middleX = x + width / 2;
		const middleY = y + height / 2;
		return [
			{ name: 'nw', x, y },
			{ name: 'n', x: middleX, y },
			{ name: 'ne', x: x + width, y },
			{ name: 'e', x: x + width, y: middleY },
			{ name: 'se', x: x + width, y: y + height },
			{ name: 's', x: middleX, y: y + height },
			{ name: 'sw', x, y: y + height },
			{ name: 'w', x, y: middleY },
		];
	}

	function drawOverlay() {
		if (!rectangle || sourceWidth === 0 || sourceHeight === 0) return;

		overlayContext.clearRect(0, 0, sourceWidth, sourceHeight);
		overlayContext.fillStyle = 'rgba(0, 0, 0, 0.48)';
		overlayContext.fillRect(0, 0, sourceWidth, sourceHeight);
		overlayContext.clearRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
		overlayContext.strokeStyle = '#c8f169';
		overlayContext.lineWidth = Math.max(1, sourceWidth / 640);
		overlayContext.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);

		const handleSize = Math.max(6, sourceWidth / 80);
		overlayContext.fillStyle = '#c8f169';
		getHandles().forEach(({ x, y }) => {
			overlayContext.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
		});
	}

	function drawStrip() {
		if (!rectangle || sourceWidth === 0 || sourceHeight === 0) return;

		const outputWidth = sourceWidth;
		const outputHeight = Math.max(
			1,
			Math.min(sourceHeight, Math.round((rectangle.height / rectangle.width) * outputWidth)),
		);
		if (stripCanvas.width !== outputWidth) stripCanvas.width = outputWidth;
		if (stripCanvas.height !== outputHeight) stripCanvas.height = outputHeight;

		stripContext.drawImage(
			sourceCanvas,
			rectangle.x,
			rectangle.y,
			rectangle.width,
			rectangle.height,
			0,
			0,
			outputWidth,
			outputHeight,
		);
	}

	function syncSourceSize() {
		const nextWidth = sourceCanvas.width;
		const nextHeight = sourceCanvas.height;
		if (nextWidth === sourceWidth && nextHeight === sourceHeight) return;

		const previousWidth = sourceWidth;
		const previousHeight = sourceHeight;
		sourceWidth = nextWidth;
		sourceHeight = nextHeight;
		overlayCanvas.width = sourceWidth;
		overlayCanvas.height = sourceHeight;

		if (rectangle && previousWidth > 0 && previousHeight > 0) {
			const scaleX = sourceWidth / previousWidth;
			const scaleY = sourceHeight / previousHeight;
			rectangle = {
				x: rectangle.x * scaleX,
				y: rectangle.y * scaleY,
				width: rectangle.width * scaleX,
				height: rectangle.height * scaleY,
			};
		} else {
			rectangle = defaultRectangle();
		}

		drawOverlay();
	}

	function pointerPosition(event) {
		const bounds = overlayCanvas.getBoundingClientRect();
		return {
			x: clamp((event.clientX - bounds.left) * (sourceWidth / bounds.width), 0, sourceWidth),
			y: clamp((event.clientY - bounds.top) * (sourceHeight / bounds.height), 0, sourceHeight),
		};
	}

	function findHandle(point) {
		const radius = Math.max(8, (sourceWidth / overlayCanvas.getBoundingClientRect().width) * 8);
		return getHandles().find((handle) => (
			Math.abs(point.x - handle.x) <= radius && Math.abs(point.y - handle.y) <= radius
		));
	}

	function isInside(point) {
		return point.x >= rectangle.x
			&& point.x <= rectangle.x + rectangle.width
			&& point.y >= rectangle.y
			&& point.y <= rectangle.y + rectangle.height;
	}

	function cursorForHandle(handle) {
		if (!handle) return 'crosshair';
		if (handle.name === 'n' || handle.name === 's') return 'ns-resize';
		if (handle.name === 'e' || handle.name === 'w') return 'ew-resize';
		return handle.name === 'ne' || handle.name === 'sw' ? 'nesw-resize' : 'nwse-resize';
	}

	function resizeTo(point) {
		const { rectangle: start, handle } = drag;
		const left = start.x;
		const top = start.y;
		const right = left + start.width;
		const bottom = top + start.height;
		const next = { ...start };

		if (handle.includes('w')) {
			next.x = clamp(point.x, 0, right - MIN_CROP_SIZE);
			next.width = right - next.x;
		} else if (handle.includes('e')) {
			next.width = clamp(point.x, left + MIN_CROP_SIZE, sourceWidth) - left;
		}

		if (handle.includes('n')) {
			next.y = clamp(point.y, 0, bottom - MIN_CROP_SIZE);
			next.height = bottom - next.y;
		} else if (handle.includes('s')) {
			next.height = clamp(point.y, top + MIN_CROP_SIZE, sourceHeight) - top;
		}

		rectangle = next;
	}

	function drawTo(point) {
		let left = Math.min(drag.start.x, point.x);
		let top = Math.min(drag.start.y, point.y);
		let right = Math.max(drag.start.x, point.x);
		let bottom = Math.max(drag.start.y, point.y);

		if (right - left < MIN_CROP_SIZE) {
			if (point.x < drag.start.x) left = Math.max(0, drag.start.x - MIN_CROP_SIZE);
			else right = Math.min(sourceWidth, drag.start.x + MIN_CROP_SIZE);
		}
		if (bottom - top < MIN_CROP_SIZE) {
			if (point.y < drag.start.y) top = Math.max(0, drag.start.y - MIN_CROP_SIZE);
			else bottom = Math.min(sourceHeight, drag.start.y + MIN_CROP_SIZE);
		}

		rectangle = { x: left, y: top, width: right - left, height: bottom - top };
	}

	function updateFromPointer(event) {
		const point = pointerPosition(event);
		if (drag.type === 'move') {
			rectangle = {
				...drag.rectangle,
				x: clamp(drag.rectangle.x + point.x - drag.start.x, 0, sourceWidth - drag.rectangle.width),
				y: clamp(drag.rectangle.y + point.y - drag.start.y, 0, sourceHeight - drag.rectangle.height),
			};
		} else if (drag.type === 'resize') {
			resizeTo(point);
		} else {
			drawTo(point);
		}

		drawOverlay();
		drawStrip();
	}

	function handlePointerDown(event) {
		syncSourceSize();
		if (sourceWidth === 0 || sourceHeight === 0) return;

		const point = pointerPosition(event);
		const handle = findHandle(point);
		if (handle) {
			drag = { type: 'resize', handle: handle.name, rectangle: { ...rectangle } };
		} else if (isInside(point)) {
			drag = { type: 'move', start: point, rectangle: { ...rectangle } };
		} else {
			drag = { type: 'draw', start: point };
			rectangle = { x: point.x, y: point.y, width: MIN_CROP_SIZE, height: MIN_CROP_SIZE };
		}

		overlayCanvas.setPointerCapture(event.pointerId);
		overlayCanvas.classList.add('is-dragging');
		updateFromPointer(event);
	}

	function handlePointerMove(event) {
		if (drag) {
			updateFromPointer(event);
			return;
		}

		const point = pointerPosition(event);
		const handle = findHandle(point);
		overlayCanvas.style.cursor = handle
			? cursorForHandle(handle)
			: isInside(point) ? 'move' : 'crosshair';
	}

	function handlePointerUp(event) {
		if (!drag) return;
		drag = null;
		overlayCanvas.classList.remove('is-dragging');
		if (overlayCanvas.hasPointerCapture(event.pointerId)) {
			overlayCanvas.releasePointerCapture(event.pointerId);
		}
		drawOverlay();
		drawStrip();
		onChange({ ...rectangle });
	}

	function update() {
		syncSourceSize();
		drawStrip();
	}

	function reset() {
		syncSourceSize();
		rectangle = defaultRectangle();
		drawOverlay();
		drawStrip();
		onChange({ ...rectangle });
	}

	overlayCanvas.addEventListener('pointerdown', handlePointerDown);
	overlayCanvas.addEventListener('pointermove', handlePointerMove);
	overlayCanvas.addEventListener('pointerup', handlePointerUp);
	overlayCanvas.addEventListener('pointercancel', handlePointerUp);

	update();
	return {
		getRect: () => rectangle && { ...rectangle },
		reset,
		update,
	};
}