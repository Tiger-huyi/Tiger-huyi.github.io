const $ = (id) => document.getElementById(id);
const form = $('music-form');
const status = $('status');
const buttons = [...document.querySelectorAll('button')];
$('sharedAt').value = new Date().toLocaleDateString('en-CA');

async function api(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-editor-token': window.EDITOR_TOKEN }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw Object.assign(new Error(result.message || '操作失败。'), { code: result.code });
  return result;
}

function busy(value) { buttons.forEach((button) => { button.disabled = value; }); }
function message(value) { status.textContent = value; }

function values() {
  return {
    songId: $('songId').value.trim(), title: $('title').value.trim(),
    artists: $('artists').value.split('/').map((value) => value.trim()).filter(Boolean),
    albumTitle: $('albumTitle').value.trim() || null, coverUrl: $('coverUrl').value.trim() || null,
    recommendation: $('recommendation').value.trim(), sharedAt: `${$('sharedAt').value}T12:00:00+08:00`,
    showDate: $('showDate').checked
  };
}

function refreshPreview() {
  const data = values();
  $('preview-title').textContent = data.title || '歌曲名称';
  $('preview-artists').textContent = data.artists.join(' / ') || '歌手信息待补充';
  $('preview-cover').src = data.coverUrl || '/music-cover-placeholder.svg';
  $('preview-cover').alt = data.title ? `《${data.title}》封面预览` : '封面预览';
  $('preview').hidden = false;
}

$('resolve').addEventListener('click', async () => {
  busy(true); message('正在读取歌曲信息…');
  try {
    const result = await api('/api/music/resolve', { input: $('source').value });
    const data = result.metadata;
    $('songId').value = data.songId; $('title').value = data.title;
    $('artists').value = data.artists.join(' / '); $('albumTitle').value = data.albumTitle || '';
    $('coverUrl').value = data.coverUrl || ''; refreshPreview();
    message(result.duplicate ? '已找到歌曲；项目中已有这首歌，保存时会更新原记录。' : '已找到歌曲，请核对后保存。');
  } catch (error) { message(error.message); }
  finally { busy(false); }
});

form.addEventListener('input', () => { if ($('songId').value) refreshPreview(); });
form.addEventListener('submit', async (event) => {
  event.preventDefault(); busy(true); message('正在保存…');
  try { await api('/api/music/prepare-publication', values()); message('内容已保存到本地。生成预览并发布网站后会公开显示。'); }
  catch (error) { message(error.message); }
  finally { busy(false); }
});

$('draft').addEventListener('click', async () => {
  busy(true); message('正在保存草稿…');
  try { await api('/api/music/drafts', values()); message('草稿已保存，只保留在这台电脑上。'); }
  catch (error) { message(error.message); }
  finally { busy(false); }
});

$('build').addEventListener('click', async () => {
  busy(true); message('正在生成网站…');
  try { await api('/api/preview/build', {}); message('网站预览已生成。请在 http://127.0.0.1:4173/ 查看。'); }
  catch (error) { message(error.message); }
  finally { busy(false); }
});
