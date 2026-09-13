import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.join(projectRoot, 'content', 'music');
const ID = /^[1-9]\d{0,19}$/;

export function validateMusicRecord(record, filename = 'record') {
  const errors = [];
  if (record?.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
  if (record?.provider !== 'netease') errors.push('provider 必须为 netease');
  if (!ID.test(String(record?.songId || ''))) errors.push('songId 必须是有效十进制字符串');
  if (record?.id !== `netease-${record?.songId}`) errors.push('id 必须由 provider 和 songId 生成');
  if (record?.canonicalUrl !== `https://music.163.com/song?id=${record?.songId}`) errors.push('canonicalUrl 与 songId 不一致');
  if (typeof record?.title !== 'string' || !record.title.trim()) errors.push('title 不能为空');
  if (!Array.isArray(record?.artists) || record.artists.some((x) => typeof x !== 'string')) errors.push('artists 必须是字符串数组');
  if (typeof record?.recommendation !== 'string' || record.recommendation.length > 240) errors.push('recommendation 必须是不超过 240 字的字符串');
  if (record?.visible !== true && record?.visible !== false) errors.push('visible 必须是布尔值');
  if (record?.showDate !== true && record?.showDate !== false) errors.push('showDate 必须是布尔值');
  if (!Number.isFinite(Date.parse(record?.sharedAt))) errors.push('sharedAt 必须是带日期信息的 ISO 时间');
  const remote = record?.cover?.remoteUrl;
  if (remote != null) {
    try {
      const url = new URL(remote);
      if (url.protocol !== 'https:' || !/^(?:p\d+\.)?music\.126\.net$/u.test(url.hostname)) errors.push('封面必须来自允许的 HTTPS 图片主机');
    } catch { errors.push('封面 URL 无效'); }
  }
  if (errors.length) throw new Error(`${filename}:\n- ${errors.join('\n- ')}`);
  return record;
}

export async function loadMusicRecords() {
  await fs.mkdir(contentDir, { recursive: true });
  const files = (await fs.readdir(contentDir)).filter((name) => name.endsWith('.json')).sort();
  const records = [];
  const ids = new Set();
  for (const file of files) {
    const record = JSON.parse(await fs.readFile(path.join(contentDir, file), 'utf8'));
    validateMusicRecord(record, file);
    if (ids.has(record.id)) throw new Error(`${file}: 与已有歌曲 ${record.id} 重复`);
    ids.add(record.id);
    records.push(record);
  }
  return records.sort((a, b) => Date.parse(b.sharedAt) - Date.parse(a.sharedAt));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const records = await loadMusicRecords();
  console.log(`音乐内容校验通过：${records.length} 条记录。`);
}
