import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMusicRecord } from '../scripts/validate-content.mjs';
import { buildSite } from '../scripts/build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('公开记录必须使用规范网易云链接与允许的封面来源', () => {
  const record = {
    schemaVersion: 1, id: 'netease-1', provider: 'netease', songId: '1', canonicalUrl: 'https://music.163.com/song?id=1',
    title: '测试歌曲', artists: [], albumTitle: null, cover: { remoteUrl: 'https://p1.music.126.net/a.jpg', localPath: null },
    recommendation: '', sharedAt: '2026-09-13T12:00:00+08:00', showDate: true, visible: true
  };
  assert.equal(validateMusicRecord(record), record);
  assert.throws(() => validateMusicRecord({ ...record, canonicalUrl: 'https://example.com/' }), /canonicalUrl/);
  assert.throws(() => validateMusicRecord({ ...record, cover: { remoteUrl: 'https://example.com/a.jpg' } }), /封面/);
});

test('无音乐时仍生成静态首页、音乐归档和干净发布目录', async () => {
  await buildSite();
  const [home, music, sitemap] = await Promise.all([
    fs.readFile(path.join(root, 'dist', 'index.html'), 'utf8'),
    fs.readFile(path.join(root, 'dist', 'music', 'index.html'), 'utf8'),
    fs.readFile(path.join(root, 'dist', 'sitemap.xml'), 'utf8')
  ]);
  assert.match(home, /<h1[^>]*lang="ja"[^>]*aria-label="虎義"[^>]*>/u);
  assert.match(home, /<span>虎<\/span><span class="name-accent">義<\/span>/u);
  assert.match(home, /还没有分享音乐/u);
  assert.match(music, /音乐分享/u);
  assert.match(sitemap, /\/music\//u);
  await assert.rejects(fs.access(path.join(root, 'dist', 'editor')));
  await assert.rejects(fs.access(path.join(root, 'dist', '.local-data')));
});
