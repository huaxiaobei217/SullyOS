/**
 * LX 歌曲的歌词：先找原平台，拿不到就去网易云按「歌名 + 歌手」搜同一首歌兜底（挑时长最接近的）。
 */
import { musicApi, resolveMusicWorkerUrl, type MusicCfg, type Song } from '../../context/MusicContext';

export interface LyricText { lrc: string; tlrc: string; }

const hasTimedLines = (lrc: string) => /\[\d{1,2}:\d{2}/.test(lrc || '');

const fromNeteaseId = async (cfg: MusicCfg, id: number): Promise<LyricText | null> => {
  const r = await musicApi.lyric(cfg, id).catch(() => null);
  const lrc = r?.lrc?.lyric || '';
  return hasTimedLines(lrc) ? { lrc, tlrc: r?.tlyric?.lyric || '' } : null;
};

const fromPlatform = async (cfg: MusicCfg, song: Song): Promise<LyricText | null> => {
  try {
    const res = await fetch(`${resolveMusicWorkerUrl(cfg)}/music2/lyric`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: song.lxSource, songmid: song.lxSongmid, hash: song.lxHash,
        name: song.name, duration: song.duration,
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return hasTimedLines(j?.lrc) ? { lrc: j.lrc, tlrc: j.tlrc || '' } : null;
  } catch { return null; }
};

const firstArtist = (s: string) => (s || '').split(/[、,，/&]/)[0].trim();

const fromNeteaseSearch = async (cfg: MusicCfg, song: Song): Promise<LyricText | null> => {
  const r = await musicApi.search(cfg, `${song.name} ${firstArtist(song.artists)}`).catch(() => null);
  const list: any[] = r?.result?.songs || [];
  if (!list.length) return null;
  const want = song.duration || 0;
  const norm = (t: string) => (t || '').toLowerCase().replace(/[\s()（）\-_.·]/g, '');
  const scored = list.slice(0, 8).map(s => {
    const dur = (s.dt || s.duration || 0) / 1000;
    let score = 0;
    if (norm(s.name) === norm(song.name)) score += 3;
    else if (norm(s.name).includes(norm(song.name)) || norm(song.name).includes(norm(s.name))) score += 1;
    if (want && dur) score += Math.max(0, 3 - Math.abs(dur - want) / 3);
    return { id: s.id as number, score };
  }).sort((a, b) => b.score - a.score);
  if (scored[0].score < 2) return null;
  return fromNeteaseId(cfg, scored[0].id);
};

export const fetchLyricsForLxSong = async (cfg: MusicCfg, song: Song): Promise<LyricText | null> => {
  if (song.lxSource === 'wy' && song.lxSongmid) {
    const r = await fromNeteaseId(cfg, Number(song.lxSongmid));
    if (r) return r;
  } else if (song.lxSource) {
    const r = await fromPlatform(cfg, song);
    if (r) return r;
  }
  return fromNeteaseSearch(cfg, song);
};
