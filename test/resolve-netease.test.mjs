import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls, resolveNeteaseLink, fetchNeteaseMetadata, MusicResolveError } from '../scripts/resolve-netease.mjs';

test('从普通、hash、手机与路径链接生成规范歌曲地址', async () => {
  const inputs = [
    'https://music.163.com/song?id=347230&userid=123',
    'https://music.163.com/#/song?id=347230',
    'https://y.music.163.com/m/song?id=347230&userid=123',
    'https://music.163.com/song/347230/'
  ];
  for (const input of inputs) {
    const result = await resolveNeteaseLink(input);
    assert.deepEqual(result, { provider: 'netease', songId: '347230', canonicalUrl: 'https://music.163.com/song?id=347230' });
  }
});

test('可以从中文分享文字中取出链接并清除结尾标点', () => {
  assert.deepEqual(extractUrls('分享一首歌：https://music.163.com/song?id=42。'), ['https://music.163.com/song?id=42']);
});

test('拒绝歌单、伪造子域、多个链接与冲突编号', async () => {
  const cases = [
    ['https://music.163.com/playlist?id=1', 'UNSUPPORTED_RESOURCE'],
    ['https://music.163.com.example.com/song?id=1', 'UNSUPPORTED_HOST'],
    ['https://music.163.com/song?id=1 https://music.163.com/song?id=2', 'MULTIPLE_URLS'],
    ['https://music.163.com/song/1/?id=2', 'INVALID_SONG_ID']
  ];
  for (const [input, code] of cases) {
    await assert.rejects(resolveNeteaseLink(input), (error) => error instanceof MusicResolveError && error.code === code);
  }
});

test('短链接只在受支持域名之间有限跳转', async () => {
  const fakeFetch = async (url) => {
    assert.equal(new URL(url).hostname, '163cn.tv');
    return new Response(null, { status: 302, headers: { location: 'https://music.163.com/#/song?id=347230' } });
  };
  const result = await resolveNeteaseLink('https://163cn.tv/abc', fakeFetch);
  assert.equal(result.songId, '347230');
});

test('歌曲详情适配器读取歌名、歌手与专辑封面', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ songs: [{ id: 347230, name: '海阔天空', artists: [{ name: 'Beyond' }], album: { name: '海阔天空', picUrl: 'https://p2.music.126.net/cover.jpg' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  const result = await fetchNeteaseMetadata('347230', fakeFetch);
  assert.equal(result.title, '海阔天空');
  assert.deepEqual(result.artists, ['Beyond']);
  assert.equal(result.coverUrl, 'https://p2.music.126.net/cover.jpg');
});

test('歌曲详情返回错误歌曲时拒绝保存', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ songs: [{ id: 2, name: '错误结果' }] }), { status: 200 });
  await assert.rejects(fetchNeteaseMetadata('1', fakeFetch), (error) => error.code === 'METADATA_INVALID');
});
