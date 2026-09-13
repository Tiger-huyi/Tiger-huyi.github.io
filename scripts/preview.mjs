import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

await buildSite();
http.createServer(async (request, response) => {
  const rawPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  let relative = rawPath.replace(/^\/+/, '');
  if (!relative || rawPath.endsWith('/')) relative += 'index.html';
  const file = path.resolve(dist, relative);
  if (!file.startsWith(`${dist}${path.sep}`)) { response.writeHead(403).end('Forbidden'); return; }
  try {
    const data = await fs.readFile(file);
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(data);
  } catch {
    try { response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end(await fs.readFile(path.join(dist, '404.html'))); }
    catch { response.writeHead(404).end('Not found'); }
  }
}).listen(port, '127.0.0.1', () => console.log(`预览：http://127.0.0.1:${port}/`));
