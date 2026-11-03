/** 听歌日记存储 + 注入聊天的文本块（无 React 依赖，聊天提示词也能直接引用） */
import type { Song } from '../../context/MusicContext';

const LS_DIARY = 'sully_music_listen_diary_v1';
export const LISTEN_DIARY_CHANGED_EVENT = 'sully:music-listen-diary-changed';
const LS_ANALYSIS = 'sully_music_song_analysis_v1';

/* ───────── 歌曲解读（客观，所有角色共用，每首歌一份存档） ───────── */

export interface SongAnalysis {
  songKey: string;
  songName: string;
  artists: string;
  text: string;
  lyrics: string;
  createdAt: number;
}

const loadAnalyses = (): Record<string, SongAnalysis> => {
  try { const o = JSON.parse(localStorage.getItem(LS_ANALYSIS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
};
export const getAnalysis = (songKey: string): SongAnalysis | undefined => loadAnalyses()[songKey];
export const listAnalyses = (): SongAnalysis[] => Object.values(loadAnalyses()).sort((a, b) => b.createdAt - a.createdAt);
export const saveAnalysis = (a: SongAnalysis) => {
  const all = loadAnalyses();
  all[a.songKey] = a;
  // 最多留 300 首，太旧的先丢
  const keep = Object.values(all).sort((x, y) => y.createdAt - x.createdAt).slice(0, 300);
  try { localStorage.setItem(LS_ANALYSIS, JSON.stringify(Object.fromEntries(keep.map(x => [x.songKey, x])))); } catch {}
  try { window.dispatchEvent(new Event(LISTEN_DIARY_CHANGED_EVENT)); } catch {}
};
export const deleteAnalysis = (songKey: string) => {
  const all = loadAnalyses();
  delete all[songKey];
  try { localStorage.setItem(LS_ANALYSIS, JSON.stringify(all)); } catch {}
  try { window.dispatchEvent(new Event(LISTEN_DIARY_CHANGED_EVENT)); } catch {}
};

/** 去掉 Markdown 标记（###、**），给人看和给模型看都更干净 */
export const plainAnalysis = (t: string) => t.replace(/^#{1,6}\s*/gm, '').replace(/\*\*/g, '').trim();

/**
 * 聊天里：用户正在放的这首歌如果有解读，告诉角色它听起来是什么样（按歌名 + 歌手匹配）。
 * 一起听时额外带上完整歌词，方便角色引用任何一句。
 */
export function buildSongAnalysisBlock(songName: string, artists: string, opts: { withLyrics?: boolean } = {}): string {
  if (!songName) return '';
  const all = Object.values(loadAnalyses());
  const hit = all.find(a => a.songName === songName && a.artists === artists) || all.find(a => a.songName === songName);
  if (!hit) return '';
  const lyrics = opts.withLyrics && hit.lyrics ? `\n【完整歌词】\n${hit.lyrics.slice(0, 2000)}\n` : '';
  return `### 【正在放的这首歌听起来是什么样】
《${hit.songName}》— ${hit.artists}
${plainAnalysis(hit.text)}
${lyrics}（这是这首歌的客观解读，帮你知道它听起来是什么样；聊起它时以此为准，不要编造这里没有的细节。）`;
}

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
