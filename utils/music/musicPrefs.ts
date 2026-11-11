/** 音乐的小开关：桌面歌词、正在听同步到外部（如角色的 MCP） */

const LS_DESKTOP_LYRIC = 'sully_music_desktop_lyric_v1';
const LS_NP_SYNC = 'sully_music_np_sync_v1';
export const MUSIC_PREFS_CHANGED_EVENT = 'sully:music-prefs-changed';

export interface DesktopLyricPrefs {
  enabled: boolean; showTranslation: boolean;
  /** 旧版按像素存的位置，新版用 topPct */
  top: number | null;
  /** 上下位置：0 = 最上，1 = 最下 */
  topPct?: number | null;
  /** 系统悬浮歌词（安卓壳）自己的位置，0 = 紧贴状态栏下面；和 App 里那条分开存 */
  nativeTopPct?: number | null;
  /** 锁定：不能拖、点了穿透到下面（解锁回音乐设置） */
  locked?: boolean;
  /** 底色不透明度 0–1 */
  opacity?: number;
  /** 字号倍数 */
  fontScale?: number;
  /** 安卓 App：切到别的 App 时在系统最上层显示（需要悬浮窗权限） */
  system?: boolean;
}
export interface NowPlayingSyncPrefs { url: string; token: string; }

const read = <T,>(key: string, def: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? { ...def, ...JSON.parse(raw) } : def; } catch { return def; }
};
const write = (key: string, v: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
  try { window.dispatchEvent(new Event(MUSIC_PREFS_CHANGED_EVENT)); } catch {}
};

export const loadDesktopLyricPrefs = () => read<DesktopLyricPrefs>(LS_DESKTOP_LYRIC, { enabled: true, showTranslation: true, top: null, topPct: null, locked: false, opacity: 0.42, fontScale: 1 });
export const saveDesktopLyricPrefs = (p: DesktopLyricPrefs) => write(LS_DESKTOP_LYRIC, p);

export const loadNowPlayingSyncPrefs = () => read<NowPlayingSyncPrefs>(LS_NP_SYNC, { url: '', token: '' });
export const saveNowPlayingSyncPrefs = (p: NowPlayingSyncPrefs) => write(LS_NP_SYNC, p);
