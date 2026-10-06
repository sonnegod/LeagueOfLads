export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const SCREENSHOT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const OUTPUT_EDGE_SIZES = [3200, 2800, 2400, 2000, 1600];
const OUTPUT_QUALITIES = [0.9, 0.82, 0.72];

export function screenshotValidationError(file) {
  if (!file) return 'Add an MMR screenshot.';
  if (!SCREENSHOT_TYPES.has(file.type)) return 'Screenshot must be a JPEG, PNG, or WebP image.';
  if (!Number.isFinite(file.size) || file.size <= 0) return 'Screenshot file is empty or invalid.';
  if (file.size > MAX_SCREENSHOT_BYTES) {
    return `Screenshot is ${(file.size / (1024 * 1024)).toFixed(1)} MB; the limit is 2 MB. ` +
      'Resize or compress the image and try again.';
  }
  return null;
}

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open screenshot image.')); };
    image.src = url;
  });
}

function jpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) :
      reject(new Error('Could not optimize screenshot image.')), 'image/jpeg', quality);
  });
}

export async function prepareScreenshot(file) {
  if (!file) throw new Error('Add an MMR screenshot.');
  if (!SCREENSHOT_TYPES.has(file.type)) {
    throw new Error('Screenshot must be a JPEG, PNG, or WebP image.');
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new Error('Screenshot file is empty or invalid.');
  }
  if (file.size <= MAX_SCREENSHOT_BYTES) return { file, compressed: false };

  let image;
  try {
    image = await loadImage(file);
    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    if (!width || !height || width * height > 60_000_000) {
      throw new Error('Screenshot resolution is too large to optimize. Crop it and try again.');
    }
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot optimize screenshots. Save a smaller JPEG and try again.');
    for (const maxEdge of OUTPUT_EDGE_SIZES) {
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of OUTPUT_QUALITIES) {
        const blob = await jpegBlob(canvas, quality);
        if (blob.type !== 'image/jpeg') {
          throw new Error('This browser cannot convert screenshots to JPEG. Save a smaller image and try again.');
        }
        if (blob.size > 0 && blob.size <= MAX_SCREENSHOT_BYTES) {
          const stem = file.name?.replace(/\.[^.]+$/, '') || 'mmr-screenshot';
          const optimized = new File([blob], `${stem}.jpg`, {
            type: 'image/jpeg', lastModified: file.lastModified || Date.now(),
          });
          return { file: optimized, compressed: true, originalBytes: file.size };
        }
      }
    }
    throw new Error('Screenshot could not be reduced below 2 MB. Crop it or save a smaller JPEG.');
  } catch (error) {
    if (error?.message) throw error;
    throw new Error('Could not optimize screenshot. Crop it or save a smaller JPEG.');
  } finally {
    image?.close?.();
  }
}

export function readScreenshot(file) {
  const error = screenshotValidationError(file);
  if (error) return Promise.reject(new Error(error));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read screenshot'));
    reader.readAsDataURL(file);
  });
}
