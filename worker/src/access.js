// Local-only bypass for the Access check: DEV_ADMIN lives in the gitignored .dev.vars, never in wrangler.jsonc.
export function isDevAdmin(request, env) {
  return env.DEV_ADMIN === '1' && new URL(request.url).hostname === 'localhost';
}
