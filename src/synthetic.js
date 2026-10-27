export const SYNTHETIC_PEAKS = Object.freeze([160, 320, 470]);

const PEAK_COLORS = [
  [80, 145, 255],
  [115, 255, 170],
  [255, 105, 92],
];

export function createSyntheticRenderer(context, width, height) {
  const image = context.createImageData(width, height);
  const { data } = image;
  const bandTop = Math.floor(height * 0.39);
  const bandBottom = Math.floor(height * 0.61);
  const centers = SYNTHETIC_PEAKS.map((position) => (position / 640) * width);
  const sigmas = [2.4, 3.2, 2.7].map((sigma) => (sigma / 640) * width);

  return function drawSyntheticFrame() {
    for (let y = 0; y < height; y += 1) {
      const inBand = y >= bandTop && y <= bandBottom;
      const verticalDistance = inBand
        ? Math.min(y - bandTop, bandBottom - y) / Math.max(1, (bandBottom - bandTop) / 2)
        : 0;
      const bandStrength = inBand ? 0.72 + 0.28 * Math.sqrt(verticalDistance) : 0;

      for (let x = 0; x < width; x += 1) {
        const pixelIndex = (y * width + x) * 4;
        const noise = Math.random() * 7;
        let red = 5 + noise;
        let green = 7 + noise;
        let blue = 9 + noise;

        if (inBand) {
          red += 9 * bandStrength;
          green += 13 * bandStrength;
          blue += 17 * bandStrength;

          for (let peak = 0; peak < centers.length; peak += 1) {
            const distance = (x - centers[peak]) / sigmas[peak];
            const intensity = Math.exp(-0.5 * distance * distance) * 220 * bandStrength;
            red += (PEAK_COLORS[peak][0] / 255) * intensity;
            green += (PEAK_COLORS[peak][1] / 255) * intensity;
            blue += (PEAK_COLORS[peak][2] / 255) * intensity;
          }
        }

        data[pixelIndex] = red;
        data[pixelIndex + 1] = green;
        data[pixelIndex + 2] = blue;
        data[pixelIndex + 3] = 255;
      }
    }

    context.putImageData(image, 0, 0);
  };
}