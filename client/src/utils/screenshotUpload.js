export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

export function readScreenshot(file) {
  if (!file) return Promise.reject(new Error('Each player needs an MMR screenshot'));
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return Promise.reject(new Error('Screenshot must be a JPEG, PNG, or WebP image'));
  }
  if (file.size > MAX_SCREENSHOT_BYTES) {
    return Promise.reject(new Error('Each screenshot must be 2 MB or less'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read screenshot'));
    reader.readAsDataURL(file);
  });
}
