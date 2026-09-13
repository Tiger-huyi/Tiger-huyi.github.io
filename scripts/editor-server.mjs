import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveAndFetch, MusicResolveError } from './resolve-netease.mjs';
import { buildSite } from './build.mjs';
import { loadMusicRecords, validateMusicRecord } from './validate-content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const editorDir = path.join(root, 'editor');
const draftDir = path.join(root, '.local-data', 'music');
const publicDir = path.join(root, 'content', 'music');
const token = crypto.randomBytes(24).toString('hex');
const port = Number(process.env.EDITOR_PORT || 4310);

function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 16_384) throw new Error('输入内容过长。');
  }
  return JSON.parse(raw || '{}');
}

function requireLocalMutation(request) {
  const origin = request.headers.origin;
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  return request.headers['x-editor-token'] === token && (!origin || allowedOrigins.has(origin));
}

function recordFrom(body) {
  const songId = String(body.songId || '').trim();
  const current = new Date().toISOString();
  return validateMusicRecord({
    schemaVersion: 1, id: `netease-${songId}`, provider: 'netease', songId,
    canonicalUrl: `https://music.163.com/song?id=${songId}`,
    title: String(body.title || '').trim(),
    artists: Array.isArray(body.artists) ? body.artists.map((value) => String(value).trim()).filter(Boolean) : [],
    albumTitle: body.albumTitle ? String(body.albumTitle).trim() : null,
    cover: { remoteUrl: body.coverUrl ? String(body.coverUrl).trim() : null, localPath: null },
    recommendation: String(body.recommendation || '').trim(),
    sharedAt: String(body.sharedAt || ''), showDate: Boolean(body.showDate), visible: true,
    metadata: { sourceKind: 'manual-confirmed', fetchedAt: current, lockedFields: ['title', 'artists', 'albumTitle', 'coverUrl'] }
  });
}

async function atomicWrite(directory, filename, data) {
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, filename);
  const temporary = path.join(directory, `.${filename}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
  await fs.rename(temporary, target);
}

async function route(request, response) {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (request.method === 'GET' && url.pathname === '/') {
    const html = (await fs.readFile(path.join(editorDir, 'index.html'), 'utf8')).replace('{{TOKEN_JSON}}', JSON.stringify(token));
    send(response, 200, html, 'text/html; charset=utf-8'); return;
  }
  if (request.method === 'GET' && url.pathname === '/app.js') {
    send(response, 200, await fs.readFile(path.join(editorDir, 'app.js'), 'utf8'), 'text/javascript; charset=utf-8'); return;
  }
  if (request.method !== 'POST' || !url.pathname.startsWith('/api/')) { send(response, 404, { ok: false, message: '没有找到这个地址。' }); return; }
  if (!requireLocalMutation(request)) { send(response, 403, { ok: false, message: '本地维护会话已经失效，请刷新页面。' }); return; }

  try {
    const body = await readJson(request);
    if (url.pathname === '/api/music/resolve') {
      const metadata = await resolveAndFetch(body.input);
      const existing = await loadMusicRecords();
      send(response, 200, { ok: true, metadata, duplicate: existing.some((item) => item.songId === metadata.songId), warnings: [] }); return;
    }
    if (url.pathname === '/api/music/drafts') {
      const record = recordFrom(body);
      await atomicWrite(draftDir, `${record.id}.json`, record);
      send(response, 200, { ok: true, id: record.id, state: 'draft' }); return;
    }
    if (url.pathname === '/api/music/prepare-publication') {
      const record = recordFrom(body);
      await atomicWrite(publicDir, `${record.id}.json`, record);
      send(response, 200, { ok: true, id: record.id, state: 'pending-publication' }); return;
    }
    if (url.pathname === '/api/preview/build') {
      await buildSite(); send(response, 200, { ok: true }); return;
    }
    send(response, 404, { ok: false, message: '没有找到这个操作。' });
  } catch (error) {
    const known = error instanceof MusicResolveError;
    send(response, known ? 422 : 400, { ok: false, code: known ? error.code : 'INVALID_INPUT', message: error.message || '操作失败。', retryable: known && error.retryable });
  }
}

http.createServer((request, response) => route(request, response).catch((error) => send(response, 500, { ok: false, message: error.message })))
  .listen(port, '127.0.0.1', () => console.log(`音乐维护工具：http://127.0.0.1:${port}/`));
