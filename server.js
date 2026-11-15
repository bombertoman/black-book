// Local server: serves the static app, read-only. Breaks are added only with bb.js.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const PUBLIC = /^\/(index\.html|app\.js|style\.css|data\/[\w-]+\.json)$/;

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function handle(req, res) {
  // Answer only to localhost: blocks DNS rebinding (an outside site whose domain resolves to 127.0.0.1).
  if (!LOCAL.test(req.headers.host || '')) return send(res, 403, { error: 'Host non consentito' });
  const origin = req.headers.origin;
  if (origin && !LOCAL.test(origin.replace(/^http:\/\//, ''))) return send(res, 403, { error: 'Origine non consentita' });
  const url = new URL(req.url, 'http://localhost').pathname;
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
