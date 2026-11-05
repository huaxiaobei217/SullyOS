/**
 * 歌曲音频缓存（个人二改）：听过的歌存在本机（Cache Storage），下次点开直接从本地放，不用再取链接、再缓冲。
 * - 只缓存能跨域读到的音频（取不到就算了，照常在线放）
 * - 最多留 MAX_SONGS 首，超了删最久没听的
 * - 另外记住刚取到的播放链接 15 分钟，短时间内重播也快
 */
const CACHE_NAME = 'sully-music-audio-v1';
const INDEX_KEY = 'sully_music_audio_cache_index_v1';
const MAX_SONGS = 80;
const MAX_BYTES_PER_SONG = 30 * 1024 * 1024;
const URL_TTL_MS = 15 * 60 * 1000;

type Index = Record<string, number>; // key -> lastPlayedAt
const readIndex = (): Index => { try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '{}') || {}; } catch { return {}; } };
const writeIndex = (i: Index) => { try { localStorage.setItem(INDEX_KEY, JSON.stringify(i)); } catch { /* ignore */ } };
const reqFor = (key: string) => new Request(`https://sully-music-cache.local/${encodeURIComponent(key)}`);
const supported = () => typeof caches !== 'undefined';

export const songCacheKey = (song: { id: number | string; lxSource?: string; lxSongmid?: string; lxHash?: string; local?: boolean }): string | null => {
  if (song.local) return null;
  if (song.lxSource && (song.lxSongmid || song.lxHash)) return `lx:${song.lxSource}:${song.lxSongmid || song.lxHash}`;
  return `wy:${song.id}`;
};

/** 本地有就返回一个可以直接放的 blob 地址 */
export async function getCachedSongUrl(key: string | null): Promise<string | null> {
  if (!key || !supported()) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(reqFor(key));
    if (!res) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    const idx = readIndex(); idx[key] = Date.now(); writeIndex(idx);
    return URL.createObjectURL(blob);
  } catch { return null; }
}

const inflight = new Set<string>();
/** 后台把这首歌存下来（不挡播放）；跨域读不到就放弃 */
export function cacheSongInBackground(key: string | null, url: string) {
  if (!key || !supported() || inflight.has(key) || /^blob:/.test(url)) return;
  inflight.add(key);
  (async () => {
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return;
      const len = Number(res.headers.get('content-length') || 0);
      if (len && len > MAX_BYTES_PER_SONG) return;
      const blob = await res.blob();
      if (!blob.size || blob.size > MAX_BYTES_PER_SONG) return;
      const cache = await caches.open(CACHE_NAME);
      await cache.put(reqFor(key), new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg' } }));
      const idx = readIndex(); idx[key] = Date.now();
      const keys = Object.keys(idx).sort((a, b) => idx[a] - idx[b]);
      while (keys.length > MAX_SONGS) { const old = keys.shift()!; delete idx[old]; await cache.delete(reqFor(old)); }
      writeIndex(idx);
    } catch { /* CORS / 网络问题：这首就不缓存 */ }
    finally { inflight.delete(key); }
  })();
}

/* 刚取到的播放链接记 15 分钟 */
const urlMemo = new Map<string, { url: string; at: number }>();
export const getMemoUrl = (key: string | null) => { if (!key) return null; const m = urlMemo.get(key); return m && Date.now() - m.at < URL_TTL_MS ? m.url : null; };
export const setMemoUrl = (key: string | null, url: string) => { if (key) urlMemo.set(key, { url, at: Date.now() }); };

export async function musicCacheStats(): Promise<{ count: number }> { return { count: Object.keys(readIndex()).length }; }
export async function clearMusicCache() { try { await caches.delete(CACHE_NAME); } catch { /* ignore */ } writeIndex({}); }
