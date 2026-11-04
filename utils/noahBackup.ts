/**
 * 二改功能的本机数据备份：音乐（歌单、歌曲解读、听歌日记、你的听歌想法、最近听过）、
 * 页脚（便签、快问快答、深夜点播、时间胶囊、哄睡歌单）、口癖清洗、恨你计数器、热点口味等。
 * 这些都存在 localStorage，原版整机备份不认识它们，所以单独挂一段 noahLocal。
 *
 * 不带走：NovelAI Key、Vertex 服务账号（只留本机），LX 音源脚本（里面有密钥，换机后重新导入）。
 * 图片和音频（页脚背景、哄睡歌单的歌、点播语音缓存）存在 assets 表，跟着完整备份走。
 */

export const NOAH_LOCAL_KEYS: readonly string[] = [
  // 音乐
  'sully_music_cfg_v1', 'sully_music_state_v1', 'sully_music_local_album_v1', 'sully_music_playlists_v2',
  'sully_music_last_playlist_v1', 'sully_music_lx_quality_v1', 'sully_music_listen_api_v1',
  'sully_music_listen_diary_v1', 'sully_music_user_notes_v1', 'sully_music_song_analysis_v1',
  'sully_music_desktop_lyric_v1', 'sully_music_np_sync_v1', 'sully_listen_plays_v1', 'sully_listen_plays_inject_v1',
  // 页脚
  'sully_footnote_v1', 'sully_footnote_chat_on_v1', 'sully_footnote_char_font_v1', 'sully_footnote_my_font_v1',
  'sully_footnote_radio_bi_v1', 'sully_sleep_playlist_v1', 'sully_sleep_bgm_vol_v1', 'sully_sleep_mins_v1', 'sully_sleep_noise_v1',
  // 聊天相关
  'sully_trope_ban_v1', 'sully_trope_ban_mode_v1', 'sully_money_off_v1', 'sully_hate_counter_v1',
  'sully_reroll_notes_v1', 'sully_news_taste_v1', 'sully_study_log_v1', 'sully_study_homeroom_v1', 'sully_shelf_v1', 'sully_shelf_font_v1', 'sully_amsg_cloud_api_v1', 'sully_amsg_save_calls_v1',
];

export const NOAH_BACKUP_LABELS: [string, string][] = [
  ['sully_music_song_analysis_v1', '歌曲解读'], ['sully_music_listen_diary_v1', '听歌日记'],
  ['sully_music_user_notes_v1', '你的听歌想法'], ['sully_music_playlists_v2', '歌单'],
  ['sully_footnote_v1', '页脚（便签 / 快问快答 / 点播 / 胶囊）'], ['sully_listen_plays_v1', '最近听过'],
  ['sully_trope_ban_v1', '口癖清洗'], ['sully_study_log_v1', '自习记录'], ['sully_hate_counter_v1', '恨你计数器'],
];

export function exportNoahLocal(): Record<string, string> | undefined {
  try {
    const out: Record<string, string> = {};
    for (const k of NOAH_LOCAL_KEYS) {
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  } catch { return undefined; }
}

/** 只写名单里的键；备份里没有的键保持本机原样 */
export function importNoahLocal(data: Record<string, string> | null | undefined): number {
  if (!data || typeof data !== 'object') return 0;
  let n = 0;
  for (const k of NOAH_LOCAL_KEYS) {
    if (typeof data[k] !== 'string') continue;
    try { localStorage.setItem(k, data[k]); n++; } catch { /* 满了就跳过这一项 */ }
  }
  return n;
}

/** 单独导出成一个小 JSON 文件 */
export function downloadNoahBackup() {
  const payload = { kind: 'sullyos-noah-local', version: 1, exportedAt: new Date().toISOString(), data: exportNoahLocal() || {} };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `二改数据_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function restoreNoahBackupFile(file: File): Promise<number> {
  const j = JSON.parse(await file.text());
  if (j?.kind !== 'sullyos-noah-local' || !j.data) throw new Error('不是二改数据备份文件');
  return importNoahLocal(j.data);
}

export function noahBackupSummary(): string[] {
  const out: string[] = [];
  for (const [k, label] of NOAH_BACKUP_LABELS) {
    try {
      const v = JSON.parse(localStorage.getItem(k) || 'null');
      if (!v) continue;
      const n = Array.isArray(v) ? v.length
        : k === 'sully_footnote_v1' ? ['cards', 'qa', 'radio', 'capsules'].reduce((s, f) => s + (Array.isArray(v[f]) ? v[f].length : 0), 0)
        : Object.keys(v).length;
      if (n) out.push(`${label} ${n}`);
    } catch { /* ignore */ }
  }
  return out;
}
