export const INFO_FIELDS = ['entrance', 'gluehwein_price', 'fun_fact', 'description'];
const MAX_NAME = 120;
const MAX_VALUE = 500;
const LAT = [52.3, 52.7], LNG = [13.0, 13.8];
const TEXT = ['name_de', 'name_en', 'loc', 'type'];
const DATE_LISTS = ['dates', 'closed', 'special_open'];
const KEYS = ['name', ...TEXT, 'url', 'lat', 'lng', 'start', 'end', 'tbc', ...DATE_LISTS, 'days_of_week'];

export function marketSlug(name) {
  return name.replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const isDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const fail = (field, error) => ({ ok: false, field, error });
// The public map interpolates these fields into HTML, so markup characters are refused rather than escaped.
const MARKUP = /[<>"]/;

function coord(v, [lo, hi]) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
}

// Checks admin input for a market. `value` is keyed by column name, ready to bind to D1.
export function validateMarket(input, { partial }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('', 'Body must be an object');
  const given = Object.keys(input);
  const unknown = given.find((k) => !KEYS.includes(k));
  if (unknown) return fail(unknown, `Unknown field: ${unknown}`);
  if (partial && !given.length) return fail('', 'Nothing to update');
  if (!partial) for (const k of ['name', 'lat', 'lng']) if (!(k in input)) return fail(k, `${k} is required`);
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'name') {
      const name = typeof v === 'string' ? v.trim() : '';
      if (!name || name.length > MAX_NAME) return fail(k, `Name must be 1-${MAX_NAME} characters`);
      if (MARKUP.test(name)) return fail(k, 'Name must not contain < > or "');
      out.name = name;
    } else if (TEXT.includes(k)) {
      const s = v == null ? '' : String(v).trim();
      if (s.length > MAX_NAME * 2) return fail(k, `${k} is too long`);
      if (MARKUP.test(s)) return fail(k, `${k} must not contain < > or "`);
      out[k] = s || null;
    } else if (k === 'url') {
      const s = v == null ? '' : String(v).trim();
      if (s && (!/^https?:\/\/\S+$/i.test(s) || MARKUP.test(s))) return fail(k, 'URL must start with http:// or https:// and not contain < > or "');
      out.url = s || null;
    } else if (k === 'lat' || k === 'lng') {
      const n = coord(v, k === 'lat' ? LAT : LNG);
      if (n === undefined) return fail(k, `${k} must be a number between ${(k === 'lat' ? LAT : LNG).join(' and ')}`);
      out[k] = n;
    } else if (k === 'start' || k === 'end') {
      if (v === null || v === '') out[k] = null;
      else if (!isDate(v)) return fail(k, `${k} must be a valid YYYY-MM-DD date`);
      else out[k] = v;
    } else if (k === 'tbc') {
      if (![true, false, 0, 1].includes(v)) return fail(k, 'tbc must be true or false');
      out.tbc = v ? 1 : 0;
    } else if (DATE_LISTS.includes(k)) {
      if (v == null) { out[k] = null; continue; }
      if (!Array.isArray(v) || !v.every(isDate)) return fail(k, `${k} must be a list of valid YYYY-MM-DD dates`);
      out[k] = v.length ? JSON.stringify([...new Set(v)].sort()) : null;
    } else if (k === 'days_of_week') {
      if (v == null) { out[k] = null; continue; }
      if (!Array.isArray(v) || !v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) || new Set(v).size !== v.length) {
        return fail(k, 'days_of_week must be unique integers 0-6 (0 = Sunday)');
      }
      out[k] = v.length ? JSON.stringify([...v].sort((a, b) => a - b)) : null;
    }
  }
  if (out.start && out.end && out.start > out.end) return fail('end', 'End must not be before start');
  return { ok: true, value: out };
}

export function validateInfo(field, value) {
  if (!INFO_FIELDS.includes(field)) return { ok: false, error: 'Unknown field' };
  const s = String(value ?? '').trim();
  if (s.length > MAX_VALUE) return { ok: false, error: `Value must be at most ${MAX_VALUE} characters` };
  return { ok: true, value: s || null };
}
