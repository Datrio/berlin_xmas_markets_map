import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMarket, validateInfo, marketSlug } from './validate.js';

const base = { name: 'X', lat: 52.5, lng: 13.4 };
const bad = (input, field, opts = { partial: false }) => {
  const r = validateMarket(input, opts);
  assert.equal(r.ok, false);
  assert.equal(r.field, field);
};

test('valid create passes', () => {
  const r = validateMarket(base, { partial: false });
  assert.equal(r.ok, true);
  assert.equal(r.value.name, 'X');
});
test('create requires lat and lng', () => {
  bad({ name: 'X', lng: 13.4 }, 'lat');
  bad({ name: 'X', lat: 52.5 }, 'lng');
});
test('lat/lng must be inside the Berlin box', () => {
  bad({ ...base, lat: 53 }, 'lat');
  bad({ ...base, lng: 12.9 }, 'lng');
});
test('numeric strings are coerced, NaN rejected', () => {
  assert.equal(validateMarket({ ...base, lat: '52.51' }, { partial: false }).value.lat, 52.51);
  bad({ ...base, lat: 'abc' }, 'lat');
});
test('name must be 1-120 non-blank chars', () => {
  bad({ ...base, name: '  ' }, 'name');
  bad({ ...base, name: 'a'.repeat(121) }, 'name');
});
test('dates must be real calendar dates', () => {
  bad({ ...base, start: '2026-02-30' }, 'start');
  bad({ ...base, start: '2026-13-01' }, 'start');
  assert.equal(validateMarket({ ...base, start: '2026-12-01' }, { partial: false }).ok, true);
});
test('start must not be after end', () => {
  bad({ ...base, start: '2026-12-02', end: '2026-12-01' }, 'end');
});
test('date lists validate each entry', () => {
  bad({ ...base, dates: ['2026-11-27', 'nope'] }, 'dates');
});
test('days_of_week are unique integers 0-6', () => {
  bad({ ...base, days_of_week: [1, 1] }, 'days_of_week');
  bad({ ...base, days_of_week: [7] }, 'days_of_week');
  assert.equal(validateMarket({ ...base, days_of_week: [3, 4, 5] }, { partial: false }).value.days_of_week, '[3,4,5]');
});
test('days_of_week are stored sorted', () => {
  assert.equal(validateMarket({ ...base, days_of_week: [1, 2, 3, 4, 5, 6, 0] }, { partial: false }).value.days_of_week, '[0,1,2,3,4,5,6]');
});
test('empty list is stored as null', () => {
  assert.equal(validateMarket({ ...base, closed: [] }, { partial: false }).value.closed, null);
});
test('url must be http(s) or empty', () => {
  bad({ ...base, url: 'javascript:alert(1)' }, 'url');
  assert.equal(validateMarket({ ...base, url: '' }, { partial: false }).value.url, null);
});
test('tbc is stored as 0/1', () => {
  assert.equal(validateMarket({ ...base, tbc: true }, { partial: false }).value.tbc, 1);
});
test('partial rejects empty, unknown keys and null coordinates', () => {
  const p = { partial: true };
  assert.equal(validateMarket({}, p).ok, false);
  assert.equal(validateMarket({ bogus: 1 }, p).ok, false);
  bad({ lat: null }, 'lat', p);
});
test('text fields and url reject markup characters (the public map renders them as HTML)', () => {
  bad({ ...base, name: '<img src=x onerror=alert(1)>' }, 'name');
  bad({ ...base, name: 'Say "hi"' }, 'name');
  bad({ ...base, loc: 'A</script>B' }, 'loc');
  bad({ ...base, name_de: 'a>b' }, 'name_de');
  bad({ ...base, url: 'https://a"onmouseover="alert(1)' }, 'url');
  assert.equal(validateMarket({ ...base, name: "Märkte & Co's" }, { partial: false }).ok, true);
});
test('tbc must be a boolean or 0/1', () => {
  bad({ ...base, tbc: 'false' }, 'tbc');
  assert.equal(validateMarket({ ...base, tbc: false }, { partial: false }).value.tbc, 0);
});
test('marketSlug', () => {
  assert.equal(marketSlug('Märkte  ß!'), 'markte-ss');
});
test('validateInfo', () => {
  assert.deepEqual(validateInfo('entrance', ''), { ok: true, value: null });
  assert.equal(validateInfo('entrance', 'x'.repeat(501)).ok, false);
  assert.equal(validateInfo('fun', 'x').ok, false);
});
