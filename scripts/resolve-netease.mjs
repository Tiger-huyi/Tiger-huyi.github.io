const DIRECT_HOSTS = new Set(['music.163.com', 'y.music.163.com']);
const SHORT_HOSTS = new Set(['163cn.tv']);
const ALLOWED_REDIRECT_HOSTS = new Set([...DIRECT_HOSTS, ...SHORT_HOSTS]);
const SONG_ID_PATTERN = /^[1-9]\d{0,19}$/;

export class MusicResolveError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.name = 'MusicResolveError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function extractUrls(input) {
  const matches = String(input || '').match(/https:\/\/[^\s<>"'，。；、】）》]+/giu) || [];
  return matches.map((value) => value.replace(/[),.;!?，。；！？”’】》]+$/u, ''));
}

function assertAllowedUrl(url, hosts = ALLOWED_REDIRECT_HOSTS) {
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.has(url.hostname.toLowerCase())) {
    throw new MusicResolveError('UNSUPPORTED_HOST', '请提供受支持的网易云歌曲链接。');
  }
}

function readSongId(url) {
  const host = url.hostname.toLowerCase();
  if (!DIRECT_HOSTS.has(host)) return null;

  const path = url.pathname.replace(/\/+$/u, '') || '/';
  const pathMatch = path.match(/^\/(?:m\/)?song\/(\d+)$/u);
  const isSongPath = path === '/song' || path === '/m/song' || Boolean(pathMatch);

  let hashId = null;
  if (url.hash.startsWith('#/song?')) {
    hashId = new URLSearchParams(url.hash.slice('#/song?'.length)).get('id');
  } else if (url.hash && /#\/(playlist|album|artist|dj|video)/u.test(url.hash)) {
    throw new MusicResolveError('UNSUPPORTED_RESOURCE', '这不是单曲链接，请打开具体歌曲后重新分享。');
  }

  if (!isSongPath && !hashId) {
    throw new MusicResolveError('UNSUPPORTED_RESOURCE', '这不是单曲链接，请打开具体歌曲后重新分享。');
  }

  const queryId = url.searchParams.get('id');
  const pathId = pathMatch?.[1] || null;
  const ids = [queryId, hashId, pathId].filter(Boolean);
  if (new Set(ids).size > 1) {
    throw new MusicResolveError('INVALID_SONG_ID', '链接中出现了互相冲突的歌曲编号，请重新分享。');
  }
  const songId = ids[0];
  if (!songId || !SONG_ID_PATTERN.test(songId)) {
    throw new MusicResolveError('INVALID_SONG_ID', '没有找到有效的歌曲编号。');
  }
  return songId;
}

export async function expandShortUrl(initialUrl, fetchImpl = fetch) {
  let current = new URL(initialUrl);
  assertAllowedUrl(current, SHORT_HOSTS);
  const seen = new Set();

  for (let hop = 0; hop < 5; hop += 1) {
    if (seen.has(current.href)) throw new MusicResolveError('REDIRECT_FAILED', '短链接发生循环，请粘贴展开后的歌曲地址。');
    seen.add(current.href);

    const response = await fetchImpl(current, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new MusicResolveError('REDIRECT_FAILED', '短链接没有返回跳转地址。');
      current = new URL(location, current);
      assertAllowedUrl(current);
      if (DIRECT_HOSTS.has(current.hostname.toLowerCase())) return current;
      continue;
    }
    if (response.ok && DIRECT_HOSTS.has(current.hostname.toLowerCase())) return current;
    throw new MusicResolveError('REDIRECT_FAILED', '无法展开短链接，请粘贴最终的单曲地址。', response.status >= 500);
  }
  throw new MusicResolveError('REDIRECT_FAILED', '短链接跳转次数过多，请粘贴最终的单曲地址。');
}

export async function resolveNeteaseLink(input, fetchImpl = fetch) {
  if (String(input || '').length > 4096) throw new MusicResolveError('NO_URL', '输入内容过长，请只保留分享链接。');
  const urls = extractUrls(input);
  if (urls.length === 0) throw new MusicResolveError('NO_URL', '没有找到链接，请粘贴网易云单曲分享链接。');
  if (urls.length > 1) throw new MusicResolveError('MULTIPLE_URLS', '检测到多个链接，请一次只导入一首。');

  let url;
  try { url = new URL(urls[0]); } catch { throw new MusicResolveError('NO_URL', '链接格式无法识别。'); }
  assertAllowedUrl(url);
  if (SHORT_HOSTS.has(url.hostname.toLowerCase())) url = await expandShortUrl(url, fetchImpl);
  const songId = readSongId(url);
  return { provider: 'netease', songId, canonicalUrl: `https://music.163.com/song?id=${songId}` };
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function fetchNeteaseMetadata(songId, fetchImpl = fetch) {
  if (!SONG_ID_PATTERN.test(String(songId))) throw new MusicResolveError('INVALID_SONG_ID', '歌曲编号格式不正确。');
  const endpoint = `https://music.163.com/api/song/detail/?id=${songId}&ids=%5B${songId}%5D`;
  let response;
  try {
    response = await fetchImpl(endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  } catch {
    throw new MusicResolveError('UPSTREAM_TIMEOUT', '暂时无法连接网易云，可以重试或手动填写。', true);
  }
  if (response.status === 429) throw new MusicResolveError('RATE_LIMITED', '网易云请求较多，请稍后重试。', true);
  if (!response.ok) throw new MusicResolveError('UPSTREAM_TIMEOUT', '网易云暂时没有返回歌曲信息。', response.status >= 500);

  let data;
  try { data = await response.json(); } catch { throw new MusicResolveError('METADATA_INVALID', '返回的歌曲信息无法读取。'); }
  const song = Array.isArray(data?.songs) ? data.songs[0] : null;
  if (!song || String(song.id) !== String(songId)) throw new MusicResolveError('METADATA_INVALID', '返回结果与请求的歌曲不一致。');

  const title = cleanText(song.name);
  if (!title) throw new MusicResolveError('METADATA_INVALID', '没有取得有效歌名，请手动填写。');
  const artists = (song.artists || song.ar || []).map((artist) => cleanText(artist?.name)).filter(Boolean);
  const album = song.album || song.al || {};
  const coverUrl = cleanText(album.picUrl) || null;

  return {
    provider: 'netease', songId: String(songId), title, artists,
    albumTitle: cleanText(album.name) || null, coverUrl,
    canonicalUrl: `https://music.163.com/song?id=${songId}`,
    fetchedAt: new Date().toISOString(), sourceKind: 'public-detail'
  };
}

export async function resolveAndFetch(input, fetchImpl = fetch) {
  const resolved = await resolveNeteaseLink(input, fetchImpl);
  const metadata = await fetchNeteaseMetadata(resolved.songId, fetchImpl);
  return { ...metadata, canonicalUrl: resolved.canonicalUrl };
}
