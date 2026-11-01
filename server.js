'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { validateRequest, validateResponse, callClaude, Limiter } = require('./marking');
try { // tiny .env loader (no dependency); real environment variables win
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch (e) { /* no .env file */ }
const env = process.env, PORT = +env.PORT || 3000, MAX_BODY = 64 * 1024;
const limiter = new Limiter(+env.RATE_LIMIT_PER_MIN || 20, +env.MAX_DAILY_CALLS || 500);
const FRONT = path.join(__dirname, '..', 'ai-past-paper-marker.html');

function send(res, status, obj, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(obj));
}
const server = http.createServer(async (req, res) => {
  const cors = env.ALLOWED_ORIGIN && req.headers.origin === env.ALLOWED_ORIGIN
    ? { 'access-control-allow-origin': env.ALLOWED_ORIGIN, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' } : {};
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.method === 'GET' && req.url === '/api/health')
    return send(res, 200, { ok: true, aiConfigured: !!env.ANTHROPIC_API_KEY, dailyRemaining: limiter.remaining }, cors);
  if (req.method === 'POST' && req.url === '/api/mark') {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > MAX_BODY) return send(res, 413, { error: 'Request too large.' }, cors); chunks.push(c); }
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return send(res, 400, { error: 'Invalid JSON.' }, cors); }
    const v = validateRequest(body); if (!v.ok) return send(res, 400, { error: v.error }, cors);
    if (!env.ANTHROPIC_API_KEY) return send(res, 503, { error: 'AI marking is not configured on the server.' }, cors);
    const lim = limiter.check(req.socket.remoteAddress || 'x'); if (!lim.ok) return send(res, lim.status, { error: lim.error }, cors);
    try {
      const { model, usage } = await callClaude(v.req);
      console.log('marked q' + v.req.question.id, 'tokens in/out', usage.input_tokens, usage.output_tokens); // never log answers or keys
      return send(res, 200, validateResponse(model, v.req), cors);
    } catch (e) { console.error('mark failed:', e.message); return send(res, e.status || 502, { error: e.message }, cors); }
  }
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html') && fs.existsSync(FRONT)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(FRONT));
  }
  send(res, 404, { error: 'Not found.' }, cors);
});
if (require.main === module) server.listen(PORT, () => console.log('AI Past Paper Marker on http://localhost:' + PORT + (env.ANTHROPIC_API_KEY ? '' : '  (no ANTHROPIC_API_KEY: AI marking disabled, local engine only)')));
module.exports = server;
