import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SCREENSHOT_BYTES, prepareScreenshot, screenshotValidationError }
  from '../client/src/utils/screenshotUpload.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=', 'base64');
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');

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
  const small = new File([webp], 'rank.webp', { type: 'image/webp' });
  assert.equal((await prepareScreenshot(small)).file, small);
  await assert.rejects(prepareScreenshot(new File(['x'], 'rank.txt', { type: 'text/plain' })),
    /JPEG, PNG, or WebP/);
});

test('mislabeled PNG screenshots are corrected without re-encoding their bytes', async () => {
  const original = new File([png], 'rank.webp', { type: 'image/webp', lastModified: 1000 });
  const prepared = await prepareScreenshot(original);
  assert.equal(prepared.file.type, 'image/png');
  assert.equal(prepared.file.name, 'rank.png');
  assert.equal(prepared.file.lastModified, original.lastModified);
  assert.equal(prepared.compressed, false);
  assert.deepEqual(Buffer.from(await prepared.file.arrayBuffer()), png);
});

test('supported image bytes are recognized even if the browser gives no MIME type', async () => {
  const original = new File([png], 'rank', { type: '' });
  const prepared = await prepareScreenshot(original);
  assert.equal(prepared.file.type, 'image/png');
  assert.equal(screenshotValidationError(prepared.file), null);
});

test('a real WebP mislabeled as PNG is still sent as WebP', async () => {
  const prepared = await prepareScreenshot(new File([webp], 'rank.png', { type: 'image/png' }));
  assert.equal(prepared.file.type, 'image/webp');
  assert.equal(prepared.file.name, 'rank.webp');
  assert.deepEqual(Buffer.from(await prepared.file.arrayBuffer()), webp);
});

test('browser-readable unrecognized image contents are converted even below 2 MB', async t => {
  const oldBitmap = globalThis.createImageBitmap;
  const oldDocument = globalThis.document;
  globalThis.createImageBitmap = async () => ({ width: 1498, height: 183, close() {} });
  const jpeg = new Blob([Buffer.from('ffd8ffe000104a464946', 'hex')], { type: 'image/jpeg' });
  globalThis.document = { createElement: () => ({
    getContext: () => ({ fillRect() {}, drawImage() {}, set fillStyle(value) { this.color = value; } }),
    toBlob: callback => callback(jpeg),
  }) };
  t.after(() => { globalThis.createImageBitmap = oldBitmap; globalThis.document = oldDocument; });
  const original = new File(['unrecognized image container'], 'rank.webp', { type: 'image/webp' });
  const prepared = await prepareScreenshot(original);
  assert.equal(prepared.file.type, 'image/jpeg');
  assert.equal(prepared.file.name, 'rank.jpg');
  assert.equal(prepared.converted, true);
  assert.equal(prepared.compressed, false);
});

test('a failed bitmap decoder falls back to the browser image decoder', async t => {
  const oldBitmap = globalThis.createImageBitmap;
  const oldImage = globalThis.Image;
  const oldDocument = globalThis.document;
  globalThis.createImageBitmap = async () => { throw new Error('Bitmap decode failed'); };
  globalThis.Image = class {
    width = 100;
    height = 100;
    set src(value) { this.url = value; queueMicrotask(() => this.onload()); }
  };
  globalThis.document = { createElement: () => ({
    getContext: () => ({ fillRect() {}, drawImage() {}, set fillStyle(value) { this.color = value; } }),
    toBlob: callback => callback(new Blob([Buffer.from('ffd8ff', 'hex')], { type: 'image/jpeg' })),
  }) };
  t.after(() => { globalThis.createImageBitmap = oldBitmap; globalThis.Image = oldImage; globalThis.document = oldDocument; });
  const prepared = await prepareScreenshot(new File(['browser-readable image'], 'rank.webp', { type: 'image/webp' }));
  assert.equal(prepared.file.type, 'image/jpeg');
});

test('unreadable image contents return a useful conversion error', async t => {
  const oldBitmap = globalThis.createImageBitmap;
  const oldImage = globalThis.Image;
  globalThis.createImageBitmap = async () => { throw new Error('Bitmap decode failed'); };
  globalThis.Image = class {
    set src(value) { this.url = value; queueMicrotask(() => this.onerror()); }
  };
  t.after(() => { globalThis.createImageBitmap = oldBitmap; globalThis.Image = oldImage; });
  await assert.rejects(prepareScreenshot(new File(['not an image'], 'rank.webp', { type: 'image/webp' })),
    /Save it as JPEG or PNG/);
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
