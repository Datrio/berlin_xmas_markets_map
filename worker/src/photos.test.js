import test from 'node:test';
import assert from 'node:assert/strict';
import { isPhotoKey, photoContentType } from './photos.js';

test('accepts hashed jpg and webp keys', () => {
  assert.equal(isPhotoKey('weihnachtsmarkt-am-gendarmenmarkt-1a2b3c4d.jpg'), true);
  assert.equal(isPhotoKey('x-1a2b3c4d.webp'), true);
});

test('rejects traversal, uppercase, other types and empty names', () => {
  for (const k of ['../x.jpg', 'a/b.jpg', 'X.jpg', 'x.png', 'x.jpg/', '', '.jpg', 'x.JPG', 'x.jpg\n']) {
    assert.equal(isPhotoKey(k), false, JSON.stringify(k));
  }
});

test('content type follows the extension', () => {
  assert.equal(photoContentType('a.jpg'), 'image/jpeg');
  assert.equal(photoContentType('a.webp'), 'image/webp');
});
