import test from 'node:test';
import assert from 'node:assert/strict';
import { isDevAdmin } from './access.js';

const req = (url) => new Request(url);

test('allowed on localhost with DEV_ADMIN=1', () => {
  assert.equal(isDevAdmin(req('http://localhost:8787/admin'), { DEV_ADMIN: '1' }), true);
});
test('never on the real host', () => {
  assert.equal(isDevAdmin(req('https://xmas.dariuszsiedlecki.com/admin'), { DEV_ADMIN: '1' }), false);
});
test('closed without the var or with another value', () => {
  assert.equal(isDevAdmin(req('http://localhost:8787/admin'), {}), false);
  assert.equal(isDevAdmin(req('http://localhost:8787/admin'), { DEV_ADMIN: 'true' }), false);
});
test('lookalike hosts are rejected', () => {
  assert.equal(isDevAdmin(req('https://localhost.evil.com/admin'), { DEV_ADMIN: '1' }), false);
});
