/** 听歌日记存储 + 注入聊天的文本块（无 React 依赖，聊天提示词也能直接引用） */
import type { Song } from '../../context/MusicContext';

const LS_DIARY = 'sully_music_listen_diary_v1';
export const LISTEN_DIARY_CHANGED_EVENT = 'sully:music-listen-diary-changed';


export interface ListenDiary {
  id: string;
  charId: string;
  songKey: string;
  songName: string;
  artists: string;
  mode: 'together' | 'alone';
  content: string;
  createdAt: number;
}

export const songKeyOf = (s: Song) => (s.lxSource && s.lxSongmid ? `${s.lxSource}:${s.lxSongmid}` : `id:${s.id}`);

export const loadDiaries = (): ListenDiary[] => {
  try { const a = JSON.parse(localStorage.getItem(LS_DIARY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
};
export const saveDiaries = (list: ListenDiary[]) => {
  try { localStorage.setItem(LS_DIARY, JSON.stringify(list.slice(0, 300))); } catch {}
  try { window.dispatchEvent(new Event(LISTEN_DIARY_CHANGED_EVENT)); } catch {}
};
export const findDiary = (charId: string, song: Song) => loadDiaries().find(d => d.charId === charId && d.songKey === songKeyOf(song));
export const deleteDiary = (id: string) => saveDiaries(loadDiaries().filter(d => d.id !== id));


/* ───────── 注入聊天 ───────── */

const RECENT_MS = 90 * 60 * 1000;

/** 下一轮聊天时告诉角色：你刚刚真的听过这些歌、当时写下了什么 */
export function buildRecentListenBlock(charId: string, userName: string, now = Date.now()): string {
  const recent = loadDiaries().filter(d => d.charId === charId && now - d.createdAt <= RECENT_MS).slice(0, 2);
  if (!recent.length) return '';
  const lines = ['### 【你刚刚真的听过的歌】'];
  for (const d of recent) {
    const how = d.mode === 'together' ? `和 ${userName || '对方'} 一起` : '自己一个人';
    lines.push(`你${how}从头到尾听完了《${d.songName}》（${d.artists}）。听完后你在听歌日记里写下：`);
    lines.push(d.content.split('\n').map(l => `  ${l}`).join('\n'));
  }
  lines.push('（这是你亲耳听到后的真实感受，聊起这首歌时以此为准，不要编造没听到的细节。想说就自然地说，不想说也不必特意提起，更不要每轮重复。）');
  return lines.join('\n');
}
