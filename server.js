// Tiny dependency-free static server for the reader. Railway sets PORT.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Files are small and never change while running, so keep raw and gzipped copies in memory.
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const body = fs.readFileSync(file);
  const entry = { body, gz: zlib.gzipSync(body, { level: 9 }) };
  cache.set(file, entry);
  return entry;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const file = path.join(PUBLIC, path.normalize(urlPath));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const ext = path.extname(file);
    const { body, gz } = load(file);
    const useGz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': urlPath.startsWith('/data/') ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Accept-Encoding',
    };
    if (useGz) headers['Content-Encoding'] = 'gzip';
    const out = useGz ? gz : body;
    headers['Content-Length'] = out.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : out);
  });
});

server.listen(PORT, () => console.log(`Reader running on http://localhost:${PORT}`));
