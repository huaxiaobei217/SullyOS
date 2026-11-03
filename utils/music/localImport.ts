/** 从手机选音乐文件导入：音频存进本地数据库，生成可播放的 Song */
import { DB } from '../db';
import type { Song } from '../../context/MusicContext';
import { lxNumericId } from './lxList';

const readDuration = (blob: Blob): Promise<number> => new Promise(resolve => {
  const url = URL.createObjectURL(blob);
  const a = new Audio();
  const done = (d: number) => { URL.revokeObjectURL(url); resolve(isFinite(d) ? d : 0); };
  a.preload = 'metadata';
  a.onloadedmetadata = () => done(a.duration);
  a.onerror = () => done(0);
  window.setTimeout(() => done(0), 8000);
  a.src = url;
});

/** 「歌手 - 歌名.mp3」→ { name, artists }；没有分隔符就整个当歌名 */
export const parseFileName = (fileName: string) => {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artists: m[1].trim(), name: m[2].trim() } : { artists: '', name: base };
};

const ivFromSec = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export const importAudioFiles = async (files: FileList | File[]): Promise<Song[]> => {
  const out: Song[] = [];
  for (const f of Array.from(files)) {
    if (!/^audio\//.test(f.type) && !/\.(mp3|flac|m4a|aac|ogg|wav|opus)$/i.test(f.name)) continue;
    const key = `music_local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await DB.saveAssetRaw(key, { blob: f, mimeType: f.type || 'audio/mpeg' });
    const dur = await readDuration(f);
    const { name, artists } = parseFileName(f.name);
    out.push({
      id: lxNumericId('local', key),
      name, artists, album: '', albumPic: '',
      duration: dur, fee: 0,
      interval: dur ? ivFromSec(dur) : '',
      local: true, localAssetKey: key, localMimeType: f.type || 'audio/mpeg',
      localImported: true,
    });
  }
  return out;
};
