/**
 * 桌面歌词：离开音乐 App 后浮在小手机最上层。
 * - 平时显示当前这一句（+ 翻译）
 * - 点一下展开：下一句预览 + 上一首 / 播放暂停 / 下一首；再点收起
 * - 暂停时也保留（显示歌名），这样能点回播放
 * - 上下拖动改位置；锁定后点击穿透；位置 / 透明度 / 字号在音乐 App 侧边栏里调
 */
import React, { useEffect, useRef, useState } from 'react';
import { useMusic } from '../../context/MusicContext';
import { useOS } from '../../context/OSContext';
import { AppID } from '../../types';
import { Play, Pause, SkipBack, SkipForward, MusicNotes } from '@phosphor-icons/react';
import { loadDesktopLyricPrefs, saveDesktopLyricPrefs, MUSIC_PREFS_CHANGED_EVENT } from '../../utils/music/musicPrefs';

// 允许一直推到最顶上（用手机自带状态栏、不显示小手机时间时，顶部没有占位）
const TOP_MIN = 0;
const BOTTOM_GAP = 110;

const DesktopLyric: React.FC = () => {
  const { activeApp, openApp } = useOS() as any;
  const { current, playing, lyric, tlyric, activeLyricIdx, togglePlay, nextSong, prevSong } = useMusic();
  const [prefs, setPrefs] = useState(() => loadDesktopLyricPrefs());
  const [expanded, setExpanded] = useState(false);
  const [everPlayed, setEverPlayed] = useState(playing);
  const drag = useRef<{ startY: number; startTop: number; parentH: number; moved: boolean } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const h = () => setPrefs(loadDesktopLyricPrefs());
    window.addEventListener(MUSIC_PREFS_CHANGED_EVENT, h);
    return () => window.removeEventListener(MUSIC_PREFS_CHANGED_EVENT, h);
  }, []);
  useEffect(() => { if (playing) setEverPlayed(true); }, [playing]);

  if (!prefs.enabled || !current || !everPlayed || activeApp === AppID.Music) return null;

  const line = activeLyricIdx >= 0 ? lyric[activeLyricIdx] : null;
  const nextLine = activeLyricIdx >= 0 ? lyric[activeLyricIdx + 1] : lyric[0];
  const trans = (t: number) => {
    if (!prefs.showTranslation || !tlyric.length) return '';
    let best = tlyric[0];
    for (const l of tlyric) if (Math.abs(l.t - t) < Math.abs(best.t - t)) best = l;
    return Math.abs(best.t - t) < 1.5 ? best.text : '';
  };
  const mainText = playing && line?.text ? line.text : `${current.name}${current.artists ? ' - ' + current.artists : ''}`;
  const subText = playing && line ? trans(line.t) : (playing ? '' : '已暂停');

  const locked = !!prefs.locked;
  const bgAlpha = typeof prefs.opacity === 'number' ? prefs.opacity : 0.42;
  const scale = prefs.fontScale || 1;

  const onDown = (e: React.PointerEvent) => {
    const parent = boxRef.current?.parentElement;
    if (!parent || !boxRef.current) return;
    drag.current = { startY: e.clientY, startTop: boxRef.current.offsetTop, parentH: parent.clientHeight, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || !boxRef.current) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < 6) return;
    if (!d.moved) { d.moved = true; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); }
    const top = Math.max(TOP_MIN, Math.min(d.parentH - BOTTOM_GAP, d.startTop + dy));
    boxRef.current.style.top = `${top}px`;
  };
  const onUp = () => {
    const d = drag.current; drag.current = null;
    if (!d || !boxRef.current) return;
    if (d.moved) {
      const span = Math.max(1, d.parentH - BOTTOM_GAP - TOP_MIN);
      saveDesktopLyricPrefs({ ...prefs, topPct: Math.max(0, Math.min(1, (boxRef.current.offsetTop - TOP_MIN) / span)) });
    }
    else setExpanded(v => !v);
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      ref={boxRef}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}
      className="absolute left-3 right-3 z-[54] select-none touch-none text-center px-3 py-1.5 rounded-2xl"
      style={{
        top: prefs.topPct != null
          ? `calc(${TOP_MIN}px + (100% - ${TOP_MIN + BOTTOM_GAP}px) * ${prefs.topPct})`
          : (prefs.top ?? 72),
        pointerEvents: locked ? 'none' : undefined,
        background: `rgba(15, 23, 42, ${bgAlpha})`,
        backdropFilter: bgAlpha > 0.05 ? 'blur(10px)' : undefined, WebkitBackdropFilter: bgAlpha > 0.05 ? 'blur(10px)' : undefined,
        color: 'white', textShadow: '0 1px 3px rgba(0,0,0,0.45)',
      }}
    >
      <div className="font-semibold leading-snug truncate" style={{ fontSize: `${13 * scale}px` }}>{mainText}</div>
      {subText && <div className="opacity-80 truncate" style={{ fontSize: `${10 * scale}px` }}>{subText}</div>}
      {expanded && (
        <>
          {playing && nextLine?.text && <div className="text-[11px] opacity-60 truncate mt-0.5">{nextLine.text}</div>}
          <div className="flex items-center justify-center gap-6 mt-1.5 pb-0.5"
            onPointerDown={stop} onPointerUp={stop}>
            <button aria-label="上一首" onClick={prevSong} className="p-1 active:scale-90"><SkipBack size={18} weight="fill" /></button>
            <button aria-label={playing ? '暂停' : '播放'} onClick={togglePlay}
              className="w-8 h-8 rounded-full flex items-center justify-center active:scale-95" style={{ background: 'rgba(255,255,255,0.9)', color: '#0f172a' }}>
              {playing ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
            </button>
            <button aria-label="下一首" onClick={nextSong} className="p-1 active:scale-90"><SkipForward size={18} weight="fill" /></button>
            {openApp && (
              <button aria-label="打开音乐" onClick={() => openApp(AppID.Music)} className="p-1 active:scale-90 opacity-80"><MusicNotes size={16} /></button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default DesktopLyric;
