/**
 * 角色主动拉你一起听（个人二改）
 * 怕 AI 推歌来来回回就那几首：不让模型自己想歌名，只给他「手边真能放的歌」里随手抽的几首，
 * 必须从里面挑；最近推过的 40 首不再出现。
 * 歌从哪来：你给他攒的歌单（默认名字带 N.C 或他名字的那个）+ 他自己主页的歌单。
 * 不是每轮都给：你聊到歌 / 听 / 音乐时给；否则距上次推歌超过 6 小时、四分之一的概率给一次。
 * 他在消息末尾写 [[SONG_PICK:歌名]]，聊天里出一张「一起听」卡，你点了才放，不会突然响。
 */
import type { CharacterProfile } from '../types';

const LS = 'sully_char_song_picks_v1';
const USER_PLAYLISTS_LS = 'sully_music_playlists_v2';
const RECENT_KEEP = 40;
const SAMPLE = 8;
const IDLE_GAP_MS = 6 * 3600 * 1000;

export interface PoolSong { id: number | string; name: string; artists: string; album?: string; albumPic?: string; duration?: number; fee?: number; [k: string]: any }
interface PickState { recent: string[]; lastAt?: number; playlistIds?: string[]; off?: boolean }

const loadAll = (): Record<string, PickState> => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } };
const load = (charId: string): PickState => { const v: Partial<PickState> = loadAll()[charId] || {}; return { ...v, recent: v.recent || [] }; };
const save = (charId: string, s: PickState) => { try { const all = loadAll(); all[charId] = s; localStorage.setItem(LS, JSON.stringify(all)); } catch { /* ignore */ } };

const songKey = (s: PoolSong) => `${String(s.name).trim().toLowerCase()}|${String(s.artists).trim().toLowerCase()}`;

export interface UserPlaylistLite { id: string; name: string; count: number }
const loadUserPlaylists = (): any[] => { try { const a = JSON.parse(localStorage.getItem(USER_PLAYLISTS_LS) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
export const listUserPlaylists = (): UserPlaylistLite[] => loadUserPlaylists().map(p => ({ id: String(p.id), name: String(p.name || ''), count: Array.isArray(p.songs) ? p.songs.length : 0 }));

/** 默认用哪些歌单：名字带 N.C / 他名字 / 首字母的 */
const defaultPlaylistIds = (char: CharacterProfile): string[] => {
  const name = (char.name || '').split(/[·・\s]/)[0];
  return loadUserPlaylists().filter(p => {
    const n = String(p.name || '');
    return /N\.?\s?C\b/i.test(n) || (name && n.includes(name));
  }).map(p => String(p.id));
};
export const getPickPlaylistIds = (char: CharacterProfile): string[] => load(char.id).playlistIds ?? defaultPlaylistIds(char);
export const setPickPlaylistIds = (charId: string, ids: string[]) => { const s = load(charId); s.playlistIds = ids; save(charId, s); };
export const isSongPickOn = (charId: string) => !load(charId).off;
export const setSongPickOn = (charId: string, on: boolean) => { const s = load(charId); s.off = !on; save(charId, s); };

export function buildSongPool(char: CharacterProfile): PoolSong[] {
  const ids = new Set(getPickPlaylistIds(char));
  const out = new Map<string, PoolSong>();
  for (const p of loadUserPlaylists()) {
    if (!ids.has(String(p.id))) continue;
    for (const s of p.songs || []) if (s?.name) out.set(songKey(s), s);
  }
  for (const p of char.musicProfile?.playlists || []) {
    for (const s of p.songs || []) if (s?.name && !out.has(songKey(s as any))) out.set(songKey(s as any), s as any);
  }
  return [...out.values()];
}

const shuffle = <T,>(a: T[]): T[] => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

const TALKS_MUSIC = /歌|听|音乐|耳机|旋律|music|song|playlist|一起听/i;

/** 聊天 / 主动消息里给他看的那段；不该给的时候返回 '' */
export function buildSongPickBlock(char: CharacterProfile, userName: string, lastUserText: string, userIsListening: boolean): string {
  if (!isSongPickOn(char.id) || userIsListening) return '';
  const st = load(char.id);
  const talks = TALKS_MUSIC.test(lastUserText || '');
  if (!talks) {
    if (st.lastAt && Date.now() - st.lastAt < IDLE_GAP_MS) return '';
    if (Math.random() > 0.25) return '';
  }
  const pool = buildSongPool(char);
  if (pool.length < 5) return '';
  const recent = new Set(st.recent);
  let fresh = pool.filter(s => !recent.has(songKey(s)));
  if (fresh.length < SAMPLE) fresh = pool; // 全推过一轮了，重新来
  const picks = shuffle(fresh).slice(0, SAMPLE);
  const lines = picks.map(s => `- ${s.name} — ${s.artists}`).join('\n');
  return `### 你手边能放的歌（随手翻到的几首）
${lines}
如果此刻真有想拉${userName}一起听的（跟你在做的事、心情、刚聊到的话有关），在那条消息末尾写 [[SONG_PICK:歌名]]，${userName}那边会出一张「一起听」卡，她点了才放。只能从上面这几首里挑，歌名照抄；一次最多一首。没那个心情就不推，大多数时候都不推；推的时候像随手分享，不用解释这首歌多好。`;
}

/** 解析消息里的 [[SONG_PICK:…]]：按歌名在歌池里找，找不到就当没写 */
export const SONG_PICK_RE = /\[\[SONG_PICK:\s*([^\]]+?)\s*\]\]/;
export const SONG_PICK_GLOBAL_RE = /\[\[SONG_PICK:[^\]]*\]\]/g;

export function resolveSongPick(char: CharacterProfile, raw: string): PoolSong | null {
  const want = raw.replace(/\s*[—–-]\s*.*$/, '').trim().toLowerCase();
  if (!want) return null;
  const pool = buildSongPool(char);
  const norm = (x: string) => x.toLowerCase().replace(/[\s'"“”‘’《》()（）]/g, '');
  const w = norm(want);
  return pool.find(s => norm(String(s.name)) === w)
    || pool.find(s => norm(String(s.name)).includes(w) || w.includes(norm(String(s.name))))
    || null;
}

export function markSongPicked(charId: string, s: PoolSong) {
  const st = load(charId);
  st.recent = [songKey(s), ...st.recent.filter(k => k !== songKey(s))].slice(0, RECENT_KEEP);
  st.lastAt = Date.now();
  save(charId, st);
}

/** 卡片上点「一起听」：MusicContext 监听这个事件去放歌 */
export const SONG_INVITE_EVENT = 'sully:char-song-invite';
export const playInvitedSong = (charId: string, song: PoolSong) => {
  window.dispatchEvent(new CustomEvent(SONG_INVITE_EVENT, { detail: { charId, song } }));
};
