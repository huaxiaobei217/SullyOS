/**
 * 多平台搜歌 + 换源匹配。
 * 网易走已有的 /netease/search；酷狗 / 酷我走代理 Worker 的 /music2/search。
 */
import { musicApi, resolveMusicWorkerUrl, loadMusicCfgStandalone, type MusicCfg, type Song } from '../../context/MusicContext';
import { lxItemToSong } from './lxList';

export type SearchSource = 'wy' | 'kg' | 'kw';
export const SEARCH_SOURCES: { id: SearchSource; label: string }[] = [
  { id: 'wy', label: '网易' },
  { id: 'kg', label: '酷狗' },
  { id: 'kw', label: '酷我' },
];

const ivFromSec = (sec: number) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const searchSongs = async (source: SearchSource, keyword: string, page = 1, cfg: MusicCfg = loadMusicCfgStandalone()): Promise<Song[]> => {
  const kw = keyword.trim();
  if (!kw) return [];
  if (source === 'wy') {
    const r = await musicApi.call(cfg, '/search', { keyword: kw, limit: 30, offset: (page - 1) * 30, type: 1 });
    return (r?.result?.songs || []).map((s: any) => lxItemToSong({
      source: 'wy',
      name: s.name,
      singer: (s.ar || s.artists || []).map((a: any) => a.name).join('、'),
      interval: ivFromSec((s.dt || s.duration || 0) / 1000),
      meta: { songId: s.id, albumName: s.al?.name || s.album?.name || '', picUrl: s.al?.picUrl || s.album?.picUrl || '' },
    })).filter(Boolean) as Song[];
  }
  const res = await fetch(`${resolveMusicWorkerUrl(cfg)}/music2/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, keyword: kw, page }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j) {
    const hint = (res.status === 404 || res.status === 405) ? '（代理 Worker 需要更新到最新的 worker/index.js）' : '';
    throw new Error((j?.error || `HTTP ${res.status}`) + hint);
  }
  return (j.list || []).map((s: any) => lxItemToSong({
    source: s.source, name: s.name, singer: s.singer, interval: s.interval,
    meta: { songId: s.songmid, hash: s.hash, albumName: s.albumName, picUrl: s.picUrl },
  })).filter(Boolean) as Song[];
};

const norm = (t: string) => (t || '').toLowerCase().replace(/[\s()（）\[\]【】\-_.·'"’]/g, '');
const firstArtist = (s: string) => (s || '').split(/[、,，/&]/)[0].trim();

/** 给一首歌打分：歌名、歌手、时长越接近越高 */
export const matchScore = (target: Song, cand: Song): number => {
  let score = 0;
  const a = norm(target.name), b = norm(cand.name);
  if (a === b) score += 4; else if (a && b && (a.includes(b) || b.includes(a))) score += 2;
  const ta = norm(firstArtist(target.artists)), ca = norm(cand.artists);
  if (ta && ca.includes(ta)) score += 3;
  if (target.duration && cand.duration) score += Math.max(0, 3 - Math.abs(target.duration - cand.duration) / 3);
  return score;
};

/** 在其他平台找同一首歌的候选（换源用），按匹配度排序 */
export const findAlternatives = async (song: Song, sources: SearchSource[] = ['wy', 'kg', 'kw']): Promise<{ song: Song; score: number }[]> => {
  const kw = `${song.name} ${firstArtist(song.artists)}`;
  const results = await Promise.all(sources.map(src => searchSongs(src, kw).catch(() => [] as Song[])));
  return results.flatMap(list => list.slice(0, 6))
    .filter(c => !(c.lxSource === song.lxSource && c.lxSongmid === song.lxSongmid))
    .map(c => ({ song: c, score: matchScore(song, c) }))
    .sort((x, y) => y.score - x.score);
};
