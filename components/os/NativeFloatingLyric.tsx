/**
 * 系统级悬浮歌词的网页这头（只在安卓 App 壳、且壳里有 FloatingLyric 插件时工作）。
 * 把整首歌的时间轴交给原生，之后只在播放 / 暂停 / 拖进度 / 换歌时同步位置；原生自己按时钟走。
 */
import { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { useMusic } from '../../context/MusicContext';
import { loadDesktopLyricPrefs, saveDesktopLyricPrefs, MUSIC_PREFS_CHANGED_EVENT } from '../../utils/music/musicPrefs';
import { useOS } from '../../context/OSContext';
import { AppID } from '../../types';

interface FloatingLyricApi {
  checkPermission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  setEnabled(o: { enabled: boolean; fontScale?: number; opacity?: number; topPct?: number; locked?: boolean }): Promise<void>;
  addListener(ev: 'control', cb: (e: { action: string; topPct?: number }) => void): Promise<{ remove: () => void }>;
  setLyrics(o: { lines: { t: number; text: string; tr?: string }[]; title: string }): Promise<void>;
  sync(o: { position: number; playing: boolean }): Promise<void>;
}
export const FloatingLyric = registerPlugin<FloatingLyricApi>('FloatingLyric');
export const hasNativeFloatingLyric = (): boolean => {
  try { return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FloatingLyric'); } catch { return false; }
};

const NativeFloatingLyric: React.FC = () => {
  const { current, playing, lyric, tlyric, progress, togglePlay, nextSong, prevSong } = useMusic();
  const { openApp } = useOS() as any;
  const ctl = useRef({ togglePlay, nextSong, prevSong, openApp });
  ctl.current = { togglePlay, nextSong, prevSong, openApp };
  const [prefs, setPrefs] = useState(() => loadDesktopLyricPrefs());
  const ok = hasNativeFloatingLyric();
  const lastSync = useRef({ at: 0, pos: 0 });

  useEffect(() => {
    const h = () => setPrefs(loadDesktopLyricPrefs());
    window.addEventListener(MUSIC_PREFS_CHANGED_EVENT, h);
    return () => window.removeEventListener(MUSIC_PREFS_CHANGED_EVENT, h);
  }, []);

  const on = ok && !!prefs.system;
  useEffect(() => {
    if (!ok) return;
    void FloatingLyric.setEnabled({
      enabled: on, fontScale: prefs.fontScale || 1,
      opacity: typeof prefs.opacity === 'number' ? prefs.opacity : 0.42,
      topPct: prefs.topPct ?? 0.08, locked: !!prefs.locked,
    }).catch(() => {});
  }, [ok, on, prefs.fontScale, prefs.opacity, prefs.topPct, prefs.locked]);

  // 悬浮歌词上的按钮 / 拖动
  useEffect(() => {
    if (!on) return;
    let h: { remove: () => void } | null = null;
    FloatingLyric.addListener('control', e => {
      const c = ctl.current;
      if (e.action === 'toggle') c.togglePlay();
      else if (e.action === 'next') c.nextSong();
      else if (e.action === 'prev') c.prevSong();
      else if (e.action === 'open') c.openApp?.(AppID.Music);
      else if (e.action === 'moved' && typeof e.topPct === 'number') saveDesktopLyricPrefs({ ...loadDesktopLyricPrefs(), topPct: e.topPct });
    }).then(x => { h = x; }).catch(() => {});
    return () => { h?.remove(); };
  }, [on]);

  // 换歌 / 歌词到了：整首交过去
  useEffect(() => {
    if (!on) return;
    const trFor = (t: number) => {
      if (!prefs.showTranslation || !tlyric.length) return '';
      let best = tlyric[0];
      for (const l of tlyric) if (Math.abs(l.t - t) < Math.abs(best.t - t)) best = l;
      return Math.abs(best.t - t) < 1.5 ? best.text : '';
    };
    const lines = lyric.map(l => ({ t: l.t, text: l.text, tr: trFor(l.t) }));
    const title = current ? `${current.name}${current.artists ? ' - ' + current.artists : ''}` : '';
    void FloatingLyric.setLyrics({ lines, title }).catch(() => {});
  }, [on, lyric, tlyric, current?.id, prefs.showTranslation]);

  // 播放状态变了马上同步；位置跳了（拖进度）或者每 10 秒校一次
  useEffect(() => {
    if (!on) return;
    const now = Date.now();
    const expected = lastSync.current.pos + (playing ? (now - lastSync.current.at) / 1000 : 0);
    if (Math.abs(progress - expected) < 1.2 && now - lastSync.current.at < 10000) return;
    lastSync.current = { at: now, pos: progress };
    void FloatingLyric.sync({ position: progress, playing }).catch(() => {});
  }, [on, progress, playing]);
  useEffect(() => {
    if (!on) return;
    lastSync.current = { at: Date.now(), pos: progress };
    void FloatingLyric.sync({ position: progress, playing }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, playing, current?.id]);

  return null;
};

export default NativeFloatingLyric;
