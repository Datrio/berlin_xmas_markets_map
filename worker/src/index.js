import adminHtml from './admin.html';

const FIELDS = ['entrance', 'gluehwein_price', 'fun_fact', 'description'];
const MAX_VALUE = 500;
const MAX_NOTE = 300;
const DAY_LIMIT_PER_IP = 30;

// Price fields: a bare number like "3.50" gets " EUR" appended; text without digits ("free") or with a currency is left as is.
function withCurrency(field, value) {
  if (field !== 'entrance' && field !== 'gluehwein_price') return value;
  if (!/\d/.test(value) || /€|\beur\b|euro|\$|\busd\b|£|\bgbp\b|\bchf\b/i.test(value)) return value;
  return `${value} EUR`;
}

function marketSlug(name) {
  return name.replace(/ß/g, 'ss').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function marketPage(request, env, url, slug) {
  const { results } = await env.DB.prepare('SELECT name, loc FROM markets').all();
  const market = results.find((r) => marketSlug(r.name) === slug);
  if (!market) return Response.redirect(new URL('/', url).toString(), 302);
  const page = await env.ASSETS.fetch(new Request(new URL('/', url), request));
  const title = `${market.name} – Berlin Christmas Market 2026`;
  const desc = `${market.name}${market.loc ? ' in ' + market.loc : ''}: dates, location, entrance fee and Glühwein price for this Berlin Christmas market (Weihnachtsmarkt) 2026.`;
  const canonical = `${env.SITE_ORIGIN}/market/${slug}`;
  const attr = (name, value) => ({ element: (e) => e.setAttribute(name, value) });
  return new HTMLRewriter()
    .on('title', { element: (e) => e.setInnerContent(title) })
    .on('meta[name="description"]', attr('content', desc))
    .on('link[rel="canonical"]', attr('href', canonical))
    .on('meta[property="og:url"]', attr('content', canonical))
    .on('meta[property="og:title"]', attr('content', title))
    .on('meta[property="og:description"]', attr('content', desc))
    .on('meta[name="twitter:title"]', attr('content', title))
    .on('meta[name="twitter:description"]', attr('content', desc))
    .transform(page);
}

async function sitemap(env) {
  const { results } = await env.DB.prepare('SELECT name FROM markets ORDER BY name').all();
  const today = new Date().toISOString().slice(0, 10);
  const urls = [`${env.SITE_ORIGIN}/`, ...results.map((r) => `${env.SITE_ORIGIN}/market/${marketSlug(r.name)}`)];
  const body = urls.map((u) => `  <url><loc>${escXml(u)}</loc><lastmod>${today}</lastmod></url>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`, {
    headers: { 'content-type': 'application/xml', 'cache-control': 'public, max-age=3600' },
  });
}

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });

function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const allowed = [env.SITE_ORIGIN, 'http://localhost:8000', 'http://127.0.0.1:8000'];
  return allowed.includes(origin)
    ? { 'access-control-allow-origin': origin, vary: 'origin', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
    : {};
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

// Verifies the Cloudflare Access JWT so admin routes stay closed even if the Access policy is misconfigured.
async function verifyAccess(request, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return false;
  const [h, p, sig] = token.split('.');
  if (!sig) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    const certs = await (await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600 } })).json();
    const jwk = certs.keys.find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    return ok && aud.includes(env.ACCESS_AUD) && payload.exp * 1000 > Date.now() && payload.iss === `https://${env.ACCESS_TEAM_DOMAIN}`;
  } catch {
    return false;
  }
}

const parseJson = (s) => (s ? JSON.parse(s) : undefined);

function marketRowToJson(r) {
  const m = { name: r.name, loc: r.loc, url: r.url, name_de: r.name_de, name_en: r.name_en, type: r.type, lat: r.lat, lng: r.lng, start: r.start, end: r.end };
  const dates = parseJson(r.dates), dow = parseJson(r.days_of_week), closed = parseJson(r.closed), special = parseJson(r.special_open);
  if (dates) m.dates = dates;
  if (dow) m.daysOfWeek = dow;
  if (closed) m.closed = closed;
  if (special) m.specialOpen = special;
  if (r.tbc) m.tbc = true;
  for (const k of Object.keys(m)) if (m[k] === null || m[k] === undefined) delete m[k];
  return m;
}

async function getInfo(env) {
  const { results } = await env.DB.prepare(
    'SELECT m.name, i.field, i.value FROM market_info i JOIN markets m ON m.id = i.market_id'
  ).all();
  const out = {};
  for (const r of results) (out[r.name] ||= {})[r.field] = r.value;
  return out;
}

async function postSuggest(request, env, cors) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const ipHash = (await sha256Hex(ip + ':xmas')).slice(0, 16);
  if (env.SUGGEST_LIMIT) {
    const { success } = await env.SUGGEST_LIMIT.limit({ key: ipHash });
    if (!success) return json({ error: 'Too many submissions, try again in a minute.' }, 429, cors);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
  if (body.website) return json({ ok: true }, 200, cors); // honeypot: pretend success
  const value = String(body.value ?? '').trim();
  const note = String(body.note ?? '').trim();
  if (!FIELDS.includes(body.field)) return json({ error: 'Unknown field' }, 400, cors);
  if (!value || value.length > MAX_VALUE) return json({ error: `Value must be 1-${MAX_VALUE} characters` }, 400, cors);
  if (note.length > MAX_NOTE) return json({ error: `Note must be at most ${MAX_NOTE} characters` }, 400, cors);
  const market = await env.DB.prepare('SELECT id FROM markets WHERE name = ?').bind(String(body.market ?? '')).first();
  if (!market) return json({ error: 'Unknown market' }, 400, cors);
  const dist = Number.isFinite(body.distance_m) ? Math.max(0, Math.round(body.distance_m)) : null;
  await env.DB.prepare('INSERT INTO suggestions (market_id, field, value, note, distance_m) VALUES (?, ?, ?, ?, ?)')
    .bind(market.id, body.field, withCurrency(body.field, value), note || null, dist).run();
  return json({ ok: true }, 200, cors);
}

async function adminApi(request, env, url) {
  const path = url.pathname;
  if (request.method === 'GET' && path === '/api/admin/suggestions') {
    const status = ['pending', 'approved', 'rejected'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
    const { results } = await env.DB.prepare(
      `SELECT s.id, s.field, s.value, s.note, s.status, s.created_at, s.distance_m, m.name AS market,
              (SELECT value FROM market_info WHERE market_id = s.market_id AND field = s.field) AS old_value
       FROM suggestions s JOIN markets m ON m.id = s.market_id WHERE s.status = ? ORDER BY s.created_at DESC LIMIT 200`
    ).bind(status).all();
    return json(results);
  }
  const m = path.match(/^\/api\/admin\/suggestions\/(\d+)\/(approve|reject)$/);
  if (request.method === 'POST' && m) {
    const id = Number(m[1]);
    const s = await env.DB.prepare('SELECT * FROM suggestions WHERE id = ? AND status = ?').bind(id, 'pending').first();
    if (!s) return json({ error: 'Not found or already reviewed' }, 404);
    if (m[2] === 'reject') {
      await env.DB.prepare("UPDATE suggestions SET status='rejected', reviewed_at=datetime('now') WHERE id=?").bind(id).run();
      return json({ ok: true });
    }
    let value = s.value;
    try {
      const b = await request.json();
      if (typeof b.value === 'string' && b.value.trim()) value = withCurrency(s.field, b.value.trim()).slice(0, MAX_VALUE);
    } catch {}
    await env.DB.batch([
      env.DB.prepare("INSERT INTO market_info (market_id, field, value, suggestion_id) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(market_id, field) DO UPDATE SET value=?3, suggestion_id=?4, approved_at=datetime('now')")
        .bind(s.market_id, s.field, value, id),
      env.DB.prepare("UPDATE suggestions SET status='approved', value=?, reviewed_at=datetime('now') WHERE id=?").bind(value, id),
    ]);
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (url.pathname === '/api/info' && request.method === 'GET') {
      return json(await getInfo(env), 200, { ...cors, 'cache-control': 'public, max-age=60' });
    }
    if (url.pathname === '/api/suggest' && request.method === 'POST') return postSuggest(request, env, cors);

    if (url.pathname === '/api/export' && request.method === 'GET') {
      const auth = request.headers.get('authorization') || '';
      if (!env.EXPORT_TOKEN || auth !== `Bearer ${env.EXPORT_TOKEN}`) return json({ error: 'Unauthorized' }, 401);
      const { results } = await env.DB.prepare('SELECT * FROM markets ORDER BY id').all();
      const info = await getInfo(env);
      return json(results.map((r) => {
        const m = marketRowToJson(r);
        if (info[r.name]) m.info = info[r.name];
        return m;
      }));
    }

    if (url.pathname.startsWith('/api/admin/') || url.pathname.startsWith('/admin')) {
      if (!(await verifyAccess(request, env))) return json({ error: 'Forbidden' }, 403);
      if (url.pathname.startsWith('/api/admin/')) return adminApi(request, env, url);
      return new Response(adminHtml, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }

    if (url.pathname === '/sitemap.xml') return sitemap(env);
    const m = url.pathname.match(/^\/market\/([a-z0-9-]+)\/?$/);
    if (m) return marketPage(request, env, url, m[1]);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
