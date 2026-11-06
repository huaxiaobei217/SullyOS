/**
 * 「我们的歌」（个人二改）：在这台手机上放歌的统计——
 * 每首听了几遍、多久；哪些是和角色一起听的；每天听了多久。
 * 只记 SullyOS 里放的（手机 LX 那边的只有歌名没有时长，不算进来）。
 */
const LS = 'sully_music_stats_v1';
export const MUSIC_STATS_EVENT = 'sully:music-stats-changed';

export interface SongStat {
  key: string; id?: number | string; name: string; artists: string; albumPic?: string;
  plays: number; sec: number; firstAt: number; lastAt: number;
  /** 最近 20 次播放的时间（看「这周循环了几遍」） */
  recent: number[];
  /** 和哪个角色一起听了多久 */
  together: Record<string, number>;
}
export interface MusicStats { songs: Record<string, SongStat>; days: Record<string, number>; togetherDays: Record<string, Record<string, number>> }

const empty = (): MusicStats => ({ songs: {}, days: {}, togetherDays: {} });
export const loadMusicStats = (): MusicStats => {
  try { const v = JSON.parse(localStorage.getItem(LS) || 'null'); if (v?.songs) return { songs: v.songs, days: v.days || {}, togetherDays: v.togetherDays || {} }; } catch { /* ignore */ }
  return empty();
};
let pending: MusicStats | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const save = (s: MusicStats) => {
  pending = s;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try { if (pending) localStorage.setItem(LS, JSON.stringify(pending)); } catch { /* ignore */ }
    pending = null;
    try { window.dispatchEvent(new Event(MUSIC_STATS_EVENT)); } catch { /* ignore */ }
  }, 1500);
};
const current = () => pending || loadMusicStats();

const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const songKeyOf = (s: { name: string; artists: string }) => `${String(s.name).trim().toLowerCase()}|${String(s.artists).trim().toLowerCase()}`;

interface SongLike { id?: number | string; name: string; artists: string; albumPic?: string }
const touch = (s: MusicStats, song: SongLike): SongStat => {
  const key = songKeyOf(song);
  const now = Date.now();
  const st = s.songs[key] ||= { key, id: song.id, name: song.name, artists: song.artists, albumPic: song.albumPic, plays: 0, sec: 0, firstAt: now, lastAt: now, recent: [], together: {} };
  if (song.albumPic && !st.albumPic) st.albumPic = song.albumPic;
  if (song.id && !st.id) st.id = song.id;
  return st;
};

/** 放着歌时每隔几秒记一次 */
export function tickListening(song: SongLike, sec: number, partners: string[]) {
  const s = current();
  const st = touch(s, song);
  st.sec += sec; st.lastAt = Date.now();
  const k = dayKey();
  s.days[k] = (s.days[k] || 0) + sec;
  for (const id of partners) {
    st.together[id] = (st.together[id] || 0) + sec;
    const td = (s.togetherDays[k] ||= {}); td[id] = (td[id] || 0) + sec;
  }
  save(s);
}

/** 一首听满 30 秒算一遍 */
export function countPlay(song: SongLike) {
  const s = current();
  const st = touch(s, song);
  st.plays += 1; st.lastAt = Date.now();
  st.recent = [Date.now(), ...st.recent].slice(0, 20);
  save(s);
}

const DAY = 86400000;
export interface MusicSummary {
  totalSec: number; monthSec: number; weekSec: number;
  top: SongStat[]; topArtists: { name: string; sec: number }[];
  looping?: { song: SongStat; times: number };
  togetherSec: number; togetherTop: SongStat[];
}
export function summarize(charId?: string, now = Date.now()): MusicSummary {
  const s = loadMusicStats();
  const songs = Object.values(s.songs);
  const sumDays = (from: number) => Object.entries(s.days).filter(([k]) => new Date(k + 'T00:00:00').getTime() >= from).reduce((a, [, v]) => a + v, 0);
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const artists = new Map<string, number>();
  for (const x of songs) for (const a of x.artists.split(/\s*[/、,&]\s*/).filter(Boolean)) artists.set(a, (artists.get(a) || 0) + x.sec);
  const week = songs.map(x => ({ x, n: x.recent.filter(t => now - t < 7 * DAY).length })).sort((a, b) => b.n - a.n)[0];
  const tg = charId ? songs.filter(x => (x.together[charId] || 0) > 0) : [];
  return {
    totalSec: songs.reduce((a, x) => a + x.sec, 0),
    monthSec: sumDays(monthStart),
    weekSec: sumDays(now - 7 * DAY),
    top: songs.slice().sort((a, b) => b.plays - a.plays || b.sec - a.sec).slice(0, 8),
    topArtists: [...artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, sec]) => ({ name, sec })),
    looping: week && week.n >= 5 ? { song: week.x, times: week.n } : undefined,
    togetherSec: charId ? tg.reduce((a, x) => a + (x.together[charId] || 0), 0) : 0,
    togetherTop: tg.sort((a, b) => (b.together[charId!] || 0) - (a.together[charId!] || 0)).slice(0, 5),
  };
}

export const fmtDur = (sec: number) => { const m = Math.round(sec / 60); return m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}`; };

/** 给角色看的一小段：他知道你最近在循环什么、你们一起听了多久（偶尔才会提） */
export function buildOurMusicBlock(charId: string, userName: string): string {
  const sm = summarize(charId);
  if (sm.totalSec < 600) return '';
  const lines: string[] = [];
  if (sm.looping) lines.push(`${userName}这周把《${sm.looping.song.name}》（${sm.looping.song.artists}）放了 ${sm.looping.times} 遍`);
  if (sm.top[0] && sm.top[0] !== sm.looping?.song) lines.push(`她听得最多的是《${sm.top[0].name}》`);
  if (sm.togetherSec >= 600) lines.push(`你们一起听歌加起来 ${fmtDur(sm.togetherSec)}${sm.togetherTop[0] ? `，一起听得最多的是《${sm.togetherTop[0].name}》` : ''}`);
  if (!lines.length) return '';
  return `### 你们的歌（背景，偶尔顺口提一句就好，别报数据）\n${lines.join('；')}。`;
}
