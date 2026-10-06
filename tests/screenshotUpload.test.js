import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SCREENSHOT_BYTES, prepareScreenshot, screenshotValidationError }
  from '../client/src/utils/screenshotUpload.js';

test('oversized signup screenshot is optimized to an allowed JPEG', async t => {
  const oldBitmap = globalThis.createImageBitmap;
  const oldDocument = globalThis.document;
  let closed = false;
  globalThis.createImageBitmap = async () => ({ width: 4000, height: 3000,
    close: () => { closed = true; } });
  globalThis.document = { createElement: () => ({
    getContext: () => ({ fillRect() {}, drawImage() {}, set fillStyle(value) { this.color = value; } }),
    toBlob: callback => callback(new Blob([new Uint8Array(800_000)], { type: 'image/jpeg' })),
  }) };
  t.after(() => {
    globalThis.createImageBitmap = oldBitmap;
    globalThis.document = oldDocument;
  });
  const original = new File([new Uint8Array(MAX_SCREENSHOT_BYTES + 1)], 'rank.png',
    { type: 'image/png' });
  const result = await prepareScreenshot(original);
  assert.equal(result.compressed, true);
  assert.equal(result.originalBytes, original.size);
  assert.equal(result.file.type, 'image/jpeg');
  assert.equal(result.file.name, 'rank.jpg');
  assert.equal(result.file.size, 800_000);
  assert.equal(screenshotValidationError(result.file), null);
  assert.equal(closed, true);
});

test('small valid screenshots remain unchanged and invalid types fail', async () => {
  const small = new File([new Uint8Array(100)], 'rank.webp', { type: 'image/webp' });
  assert.equal((await prepareScreenshot(small)).file, small);
  await assert.rejects(prepareScreenshot(new File(['x'], 'rank.txt', { type: 'text/plain' })),
    /JPEG, PNG, or WebP/);
});

test('an image that cannot fit below 2 MB returns a useful error', async t => {
  const oldBitmap = globalThis.createImageBitmap;
  const oldDocument = globalThis.document;
  globalThis.createImageBitmap = async () => ({ width: 4000, height: 3000, close() {} });
  const largeBlob = new Blob([new Uint8Array(MAX_SCREENSHOT_BYTES + 1)],
    { type: 'image/jpeg' });
  globalThis.document = { createElement: () => ({
    getContext: () => ({ fillRect() {}, drawImage() {}, set fillStyle(value) { this.color = value; } }),
    toBlob: callback => callback(largeBlob),
  }) };
  t.after(() => {
    globalThis.createImageBitmap = oldBitmap;
    globalThis.document = oldDocument;
  });
  const original = new File([new Uint8Array(MAX_SCREENSHOT_BYTES + 1)], 'rank.png',
    { type: 'image/png' });
  await assert.rejects(prepareScreenshot(original), /Crop it or save a smaller JPEG/);
});
