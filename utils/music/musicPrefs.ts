/** 音乐的小开关：桌面歌词、正在听同步到外部（如角色的 MCP） */

const LS_DESKTOP_LYRIC = 'sully_music_desktop_lyric_v1';
const LS_NP_SYNC = 'sully_music_np_sync_v1';
export const MUSIC_PREFS_CHANGED_EVENT = 'sully:music-prefs-changed';

export interface DesktopLyricPrefs { enabled: boolean; showTranslation: boolean; top: number | null; }
export interface NowPlayingSyncPrefs { url: string; token: string; }

const read = <T,>(key: string, def: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? { ...def, ...JSON.parse(raw) } : def; } catch { return def; }
};
const write = (key: string, v: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
  try { window.dispatchEvent(new Event(MUSIC_PREFS_CHANGED_EVENT)); } catch {}
};

export const loadDesktopLyricPrefs = () => read<DesktopLyricPrefs>(LS_DESKTOP_LYRIC, { enabled: true, showTranslation: true, top: null });
export const saveDesktopLyricPrefs = (p: DesktopLyricPrefs) => write(LS_DESKTOP_LYRIC, p);

export const loadNowPlayingSyncPrefs = () => read<NowPlayingSyncPrefs>(LS_NP_SYNC, { url: '', token: '' });
export const saveNowPlayingSyncPrefs = (p: NowPlayingSyncPrefs) => write(LS_NP_SYNC, p);
