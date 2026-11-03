/**
 * LX Music 歌单导入 + 本 App 的「我的歌单」存储。
 *
 * LX 导出的 .lxmc 是 gzip 压缩的 JSON（不是加密），格式：
 *   { type: 'playListPart_v2' | 'playList_v2' | 'allData_v2' ..., data: list | list[] | { playList } }
 *   每个 list：{ id, name, list: [{ id, name, singer, source, interval, meta: { songId, albumName, picUrl, hash?, strMediaMid?, copyrightId?, qualitys } }] }
 */

import type { Song } from '../../context/MusicContext';
import type { LxSource } from './lxRuntime';

export interface MusicPlaylist {
  id: string;
  name: string;
  songs: Song[];
  createdAt: number;
  updatedAt: number;
  /** 导入来源说明，比如「LX 导入」 */
  origin?: string;
}

const LX_SOURCES: LxSource[] = ['wy', 'kg', 'kw', 'tx', 'mg'];

/** 把平台 + ID 稳定地映射成数字 id（全 App 的 Song.id 都是 number） */
export const lxNumericId = (source: string, songmid: string): number => {
  // FNV-1a 53 位变体，取正数，并加一个大偏移，避免和网易云 / 本地歌的 id 撞上
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const s = `${source}:${songmid}`;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  const n = (h2 >>> 0) * 2 ** 21 + ((h1 >>> 0) & 0x1fffff);
  return 9e15 - (n % 4e15);
};

const intervalToSec = (iv?: string): number => {
  if (!iv) return 0;
  const parts = iv.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};

/** LX 单曲 → 本 App 的 Song；本地文件（source=local）返回 null */
export const lxItemToSong = (it: any): Song | null => {
  const source = it?.source as LxSource;
  if (!LX_SOURCES.includes(source)) return null;
  const meta = it.meta || {};
  const songmid = String(meta.songId ?? it.songmid ?? '').trim();
  if (!songmid) return null;
  return {
    id: lxNumericId(source, songmid),
    name: String(it.name || ''),
    artists: String(it.singer || ''),
    album: String(meta.albumName || ''),
    albumPic: String(meta.picUrl || '').replace(/^http:\/\//i, 'https://'),
    duration: intervalToSec(it.interval),
    fee: 0,
    interval: it.interval || '',
    lxSource: source,
    lxSongmid: songmid,
    lxHash: meta.hash || undefined,
    lxStrMediaMid: meta.strMediaMid || undefined,
    lxCopyrightId: meta.copyrightId || undefined,
    lxQualitys: Array.isArray(meta.qualitys) ? meta.qualitys.map((q: any) => q?.type).filter(Boolean) : undefined,
  };
};

export interface LxImportResult {
  playlists: MusicPlaylist[];
  /** 本地文件歌曲：浏览器读不到原路径，需要用户手动导入文件 */
  skippedLocal: { name: string; singer: string }[];
}

const gunzipToText = async (buf: ArrayBuffer): Promise<string> => {
  const bytes = new Uint8Array(buf);
  // 未压缩的 JSON 直接读
  if (bytes[0] === 0x7b || bytes[0] === 0x5b) return new TextDecoder().decode(bytes);
  const ds = new (window as any).DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return await new Response(stream).text();
};

const collectLists = (data: any): any[] => {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.playList)) return data.playList;
  if (Array.isArray(data.list) && data.name) return [data];
  return [];
};

/** 解析一个 .lxmc / .json 文件 */
export const parseLxFile = async (file: Blob): Promise<LxImportResult> => {
  const text = await gunzipToText(await file.arrayBuffer());
  const j = JSON.parse(text);
  const lists = collectLists(j?.data ?? j);
  const now = Date.now();
  const skippedLocal: LxImportResult['skippedLocal'] = [];
  const playlists: MusicPlaylist[] = lists.map((l: any) => {
    const songs: Song[] = [];
    for (const it of l.list || []) {
      if (it?.source === 'local') { skippedLocal.push({ name: it.name, singer: it.singer }); continue; }
      const s = lxItemToSong(it);
      if (s) songs.push(s);
    }
    return {
      id: `pl_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name: String(l.name || '未命名歌单').replace(/^分享.*?「(.+?)」.*$/, '$1'),
      songs, createdAt: now, updatedAt: now, origin: 'LX 导入',
    };
  });
  return { playlists, skippedLocal };
};

/* ───────── 我的歌单存储（localStorage，体积小） ───────── */

export const LS_PLAYLISTS_KEY = 'sully_music_playlists_v2';
export const PLAYLISTS_CHANGED_EVENT = 'sully:music-playlists-changed';

export const loadPlaylists = (): MusicPlaylist[] => {
  try {
    const raw = localStorage.getItem(LS_PLAYLISTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};

export const savePlaylists = (lists: MusicPlaylist[]) => {
  try { localStorage.setItem(LS_PLAYLISTS_KEY, JSON.stringify(lists)); } catch {}
  try { window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT)); } catch {}
};

/** 同名歌单合并（按歌曲 id 去重），新歌单追加 */
export const mergeImported = (existing: MusicPlaylist[], incoming: MusicPlaylist[]): MusicPlaylist[] => {
  const out = existing.map(p => ({ ...p, songs: [...p.songs] }));
  for (const inc of incoming) {
    const same = out.find(p => p.name === inc.name);
    if (!same) { out.push(inc); continue; }
    const ids = new Set(same.songs.map(s => s.id));
    for (const s of inc.songs) if (!ids.has(s.id)) same.songs.push(s);
    same.updatedAt = Date.now();
  }
  return out;
};
