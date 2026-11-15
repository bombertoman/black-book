// Local server: serves the static app and a small write API.
// The hosted (static) copy has no API, so it is read-only.
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');

const ROOT = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const PUBLIC = /^\/(index\.html|app\.js|style\.css|data\/[\w-]+\.json)$/;

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

function handle(req, res) {
  const url = new URL(req.url, 'http://localhost').pathname;
  if (url === '/api/ping') return send(res, 200, { ok: true });
  if (url === '/api/breaks' && req.method === 'POST') {
    // Requiring JSON blocks cross-site form posts from other pages.
    if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Content-Type: application/json richiesto' });
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const force = new URL(req.url, 'http://localhost').searchParams.has('force');
        send(res, 200, store.addBatch(JSON.parse(body), { force }));
      } catch (e) { send(res, 400, { error: e.message }); }
    });
    return;
  }
  const rel = url === '/' ? '/index.html' : url;
  if (req.method !== 'GET' || !PUBLIC.test(rel)) return send(res, 404, { error: 'Non trovato' });
  fs.readFile(path.join(ROOT, rel), (err, buf) => {
    if (err) return send(res, 404, { error: 'Non trovato' });
    send(res, 200, buf, MIME[path.extname(rel)]);
  });
}

function start(port = Number(process.env.PORT) || 4173) {
  http.createServer(handle).listen(port, '127.0.0.1', () => console.log(`Black Book: http://localhost:${port}`));
}

module.exports = { start };
if (require.main === module) start(Number(process.argv[2]) || undefined);
