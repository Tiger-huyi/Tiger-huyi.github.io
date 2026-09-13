import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMusicRecords } from './validate-content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const out = path.join(root, 'dist');
const pageSize = 12;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function dateLabel(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/u);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : '';
}

function header(current = '') {
  const links = [
    ['about', '关于我'], ['music', '音乐分享'], ['updates', '最近动态'], ['designs', '随手设计'], ['photos', '摄影']
  ].map(([id, label]) => `<a href="/${id === 'music' ? 'music/' : `#${id}`}"${current === id ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<header class="site-header grid-shell"><a class="site-name" href="/" aria-label="虎義 HUYI 首页">HUYI</a><nav class="site-nav" aria-label="主要导航">${links}</nav></header>`;
}

function footer() {
  return `<footer class="site-footer grid-shell"><p class="footer-name"><span class="name-ja" lang="ja">虎義</span><br><span>HUYI</span></p><p>音乐、旅行、设计与摄影。</p><p>© 2026 HUYI</p><a class="text-link" href="#main">返回顶部</a></footer>`;
}

function renderTrack(record) {
  const artists = record.artists.length ? escapeHtml(record.artists.join(' / ')) : '歌手信息待补充';
  const cover = record.cover?.remoteUrl
    ? `<img src="${escapeHtml(record.cover.remoteUrl)}" alt="" width="640" height="640" loading="lazy" referrerpolicy="no-referrer">`
    : '';
  const note = record.recommendation ? `<p class="track-note">${escapeHtml(record.recommendation)}</p>` : '';
  const date = record.showDate ? `<p class="track-date">${escapeHtml(dateLabel(record.sharedAt))}</p>` : '';
  return `<article class="track-item" id="${escapeHtml(record.id)}"><div class="track-cover"><span class="track-cover-fallback">暂无封面</span>${cover}</div><div class="track-main"><h3 class="track-title">${escapeHtml(record.title)}</h3><p class="track-artists">${artists}</p>${note}${date}</div><a class="track-action" href="${escapeHtml(record.canonicalUrl)}" aria-label="去网易云听《${escapeHtml(record.title)}》">去网易云听</a></article>`;
}

function renderMusic(records) {
  if (!records.length) return '<div class="track-empty"><p>还没有分享音乐。</p><p>以后听到喜欢的，就从这里开始。</p></div>';
  return records.map(renderTrack).join('');
}

function pagination(page, pages) {
  if (pages <= 1) return '';
  const previous = page > 1 ? `<a class="text-link" href="${page === 2 ? '/music/' : `/music/page/${page - 1}/`}">上一页</a>` : '<span></span>';
  const next = page < pages ? `<a class="text-link" href="/music/page/${page + 1}/">下一页</a>` : '<span></span>';
  return `<nav class="pagination" aria-label="音乐归档分页">${previous}<span>第 ${page} / ${pages} 页</span>${next}</nav>`;
}

function htmlDocument(title, description, current, body, canonical) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#ffffff"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><script src="/site.js" defer></script></head><body><a class="skip-link" href="#main">跳到主要内容</a>${header(current)}${body}${footer()}</body></html>`;
}

function simpleArchive(id, title, description, empty) {
  const body = `<main id="main"><section class="archive-hero grid-shell"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></section><section class="archive-content grid-shell"><a class="text-link back-link" href="/#${id}">返回首页</a><div class="compact-empty"><p>${escapeHtml(empty)}</p><p>这里会在有真实内容后更新。</p></div></section></main>`;
  return htmlDocument(`${title}｜虎義 HUYI`, description, id, body, `https://tiger-huyi.github.io/${id}/`);
}

async function write(relative, content) {
  const target = path.join(out, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

export async function buildSite() {
  const records = (await loadMusicRecords()).filter((record) => record.visible);
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  await fs.cp(path.join(root, 'public'), out, { recursive: true });
  for (const asset of ['favicon.svg', 'favicon.png', 'og.png']) {
    try { await fs.copyFile(path.join(root, asset), path.join(out, asset)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await write('.nojekyll', '\n');

  const homeTemplate = await fs.readFile(path.join(src, 'index.html'), 'utf8');
  await write('index.html', homeTemplate.replace('{{MUSIC_LIST}}', renderMusic(records.slice(0, 3))));

  const musicTemplate = await fs.readFile(path.join(src, 'music.html'), 'utf8');
  const pages = Math.max(1, Math.ceil(records.length / pageSize));
  for (let page = 1; page <= pages; page += 1) {
    const pageRecords = records.slice((page - 1) * pageSize, page * pageSize);
    const rendered = musicTemplate
      .replace('{{HEADER}}', header('music'))
      .replace('{{MUSIC_LIST}}', renderMusic(pageRecords))
      .replace('{{PAGINATION}}', pagination(page, pages))
      .replace('{{FOOTER}}', footer())
      .replace('https://tiger-huyi.github.io/music/', page === 1 ? 'https://tiger-huyi.github.io/music/' : `https://tiger-huyi.github.io/music/page/${page}/`);
    await write(page === 1 ? 'music/index.html' : `music/page/${page}/index.html`, rendered);
  }

  await write('updates/index.html', simpleArchive('updates', '最近动态', '最近听的、看到的，和想记下来的。', '还没有发布动态。'));
  await write('designs/index.html', simpleArchive('designs', '随手设计', '一些排版、配色和图像的小尝试。', '图片还在整理中。'));
  await write('photos/index.html', simpleArchive('photos', '摄影', '想留下的画面，慢慢整理在这里。', '照片正在整理中。'));

  const works = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="4;url=/designs/"><meta name="robots" content="noindex"><link rel="canonical" href="https://tiger-huyi.github.io/designs/"><link rel="stylesheet" href="/styles.css"><title>作品入口已调整｜虎義 HUYI</title></head><body>${header('designs')}<main id="main"><section class="archive-content grid-shell"><div class="compact-empty"><h1>作品入口已经调整。</h1><p>这里现在是个人网站，原来的作品入口已归入随手设计。</p><a class="text-link" href="/designs/">前往随手设计</a></div></section></main>${footer()}</body></html>`;
  await write('works/index.html', works);

  const notFound = `<main id="main" class="not-found grid-shell"><h1>404</h1><div><h2>没有找到这个页面。</h2><p>链接可能已经调整，或者内容还没有发布。</p><a class="text-link" href="/">返回首页</a></div></main>`;
  await write('404.html', htmlDocument('页面未找到｜虎義 HUYI', '没有找到这个页面。', '', notFound, 'https://tiger-huyi.github.io/404.html'));

  const urls = ['/', '/music/', '/updates/', '/designs/', '/photos/'];
  for (let page = 2; page <= pages; page += 1) urls.push(`/music/page/${page}/`);
  await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>https://tiger-huyi.github.io${url}</loc></url>`).join('\n')}\n</urlset>\n`);
  await write('robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://tiger-huyi.github.io/sitemap.xml\n');
  console.log(`构建完成：${records.length} 条公开音乐，${pages} 个音乐归档页。`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildSite();
