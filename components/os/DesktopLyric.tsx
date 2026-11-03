/**
 * 桌面歌词：放歌时在小手机最上层显示当前这一句（音乐 App 里不显示）。
 * 上下拖动改位置；在音乐 App 的设置里开关。
 */
import React, { useEffect, useRef, useState } from 'react';
import { useMusic } from '../../context/MusicContext';
import { useOS } from '../../context/OSContext';
import { AppID } from '../../types';
import { loadDesktopLyricPrefs, saveDesktopLyricPrefs, MUSIC_PREFS_CHANGED_EVENT } from '../../utils/music/musicPrefs';

const DesktopLyric: React.FC = () => {
  const { activeApp } = useOS();
  const { current, playing, lyric, tlyric, activeLyricIdx } = useMusic();
  const [prefs, setPrefs] = useState(() => loadDesktopLyricPrefs());
  const drag = useRef<{ startY: number; startTop: number; parentH: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const h = () => setPrefs(loadDesktopLyricPrefs());
    window.addEventListener(MUSIC_PREFS_CHANGED_EVENT, h);
    return () => window.removeEventListener(MUSIC_PREFS_CHANGED_EVENT, h);
  }, []);

  if (!prefs.enabled || !current || !playing || activeApp === AppID.Music) return null;
  const line = activeLyricIdx >= 0 ? lyric[activeLyricIdx] : null;
  if (!line?.text) return null;
  // 翻译按时间对齐：取时间最接近的一行
  const trans = prefs.showTranslation && tlyric.length
    ? tlyric.reduce((best, l) => (Math.abs(l.t - line.t) < Math.abs(best.t - line.t) ? l : best), tlyric[0])
    : null;
  const transText = trans && Math.abs(trans.t - line.t) < 1.5 ? trans.text : '';

  const onDown = (e: React.PointerEvent) => {
    const parent = boxRef.current?.parentElement;
    if (!parent || !boxRef.current) return;
    drag.current = { startY: e.clientY, startTop: boxRef.current.offsetTop, parentH: parent.clientHeight };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || !boxRef.current) return;
    const top = Math.max(24, Math.min(d.parentH - 80, d.startTop + e.clientY - d.startY));
    boxRef.current.style.top = `${top}px`;
  };
  const onUp = () => {
    if (!drag.current || !boxRef.current) return;
    drag.current = null;
    saveDesktopLyricPrefs({ ...prefs, top: boxRef.current.offsetTop });
  };

  return (
    <div
      ref={boxRef}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      className="absolute left-3 right-3 z-[54] select-none touch-none text-center px-3 py-1.5 rounded-2xl"
      style={{
        top: prefs.top ?? 72,
        background: 'rgba(15, 23, 42, 0.38)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        color: 'white', textShadow: '0 1px 3px rgba(0,0,0,0.45)',
      }}
    >
      <div key={line.t} className="text-[13px] font-semibold leading-snug truncate" style={{ animation: 'fadeIn .25s ease' }}>{line.text}</div>
      {transText && <div className="text-[10px] opacity-80 truncate">{transText}</div>}
    </div>
  );
};

export default DesktopLyric;
