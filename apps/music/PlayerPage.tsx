/**
 * 正在播放（LX 歌曲用）：封面屏 / 歌词屏，点击切换（同 LX）
 *   第一屏：大封面 + 歌名 + 当前一句歌词
 *   第二屏：完整滚动歌词（点某句可跳到那里）
 * 点封面进歌词，点歌词屏空白处回封面，点某句歌词跳到那里。底部控制条两屏共用。
 */
import React, { useEffect, useRef, useState } from 'react';
import { useMusic } from '../../context/MusicContext';
import { C, MizuHeader, GlassProgress, PlayControls } from './MusicUI';
import Cover from './Cover';
import SongActionSheet from './SongActionSheet';
import { Heart, Repeat, RepeatOnce, Shuffle, DotsThree } from '@phosphor-icons/react';
import { isInFavorites, toggleFavorite, PLAYLISTS_CHANGED_EVENT } from '../../utils/music/lxList';
import { LX_QUALITY_LABEL, loadLxQualityPref } from '../../utils/music/lxQuality';

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
const SOURCE_LABEL: Record<string, string> = { wy: '网易', kg: '酷狗', kw: '酷我', tx: 'QQ', mg: '咪咕' };

const PlayerPage: React.FC<{
  onBack: () => void;
  toast: (msg: string, type?: 'info' | 'success' | 'error') => void;
  companions?: React.ReactNode;
}> = ({ onBack, toast, companions }) => {
  const {
    current, playing, progress, duration, loadingSong, lyric, tlyric, activeLyricIdx,
    togglePlay, nextSong, prevSong, seek, playMode, setPlayMode,
  } = useMusic();
  const lyricBoxRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(0);
  const [padY, setPadY] = useState(200);
  const [liked, setLiked] = useState(() => (current ? isInFavorites(current.id) : false));
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const h = () => setLiked(current ? isInFavorites(current.id) : false);
    h();
    window.addEventListener(PLAYLISTS_CHANGED_EVENT, h);
    return () => window.removeEventListener(PLAYLISTS_CHANGED_EVENT, h);
  }, [current?.id]);

  // 歌词屏：当前句滚到中间
  useEffect(() => {
    // 歌词屏隐藏时也同步位置，切过去时直接就在当前句
    const box = lyricBoxRef.current; if (!box || activeLyricIdx < 0) return;
    const el = box.querySelector<HTMLDivElement>(`[data-i="${activeLyricIdx}"]`);
    if (!el) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTo({ top: top - box.clientHeight / 2 + el.clientHeight / 2, behavior: page === 1 ? 'smooth' : 'auto' });
  }, [activeLyricIdx, page, padY]);

  const goPage = (p: number) => setPage(p);

  // 歌词上下留白 = 容器高度的一半，让第一句 / 最后一句也能停在正中间（按高度算，宽屏不会偏下）
  useEffect(() => {
    const box = lyricBoxRef.current; if (!box) return;
    const update = () => setPadY(Math.round(box.clientHeight / 2));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(box);
    return () => ro.disconnect();
  }, [page]);

  if (!current) return null;

  const transFor = (t: number) => {
    if (!tlyric.length) return '';
    let best = tlyric[0];
    for (const l of tlyric) if (Math.abs(l.t - t) < Math.abs(best.t - t)) best = l;
    return Math.abs(best.t - t) < 1.5 ? best.text : '';
  };
  const curLine = activeLyricIdx >= 0 ? lyric[activeLyricIdx] : null;

  const cycleMode = () => {
    const order = ['loop', 'single', 'shuffle'] as const;
    const next = order[(order.indexOf(playMode as any) + 1) % 3];
    setPlayMode(next);
    toast(next === 'loop' ? '列表循环' : next === 'single' ? '单曲循环' : '随机播放', 'info');
  };
  const ModeIcon = playMode === 'single' ? RepeatOnce : playMode === 'shuffle' ? Shuffle : Repeat;

  return (
    <div className="flex flex-col h-full relative overflow-hidden" style={{ background: C.bg }}>
      {/* 模糊封面做背景 */}
      {current.albumPic && (
        <img src={current.albumPic.replace(/^http:\/\//i, 'https://')} alt="" referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ filter: 'blur(40px) saturate(1.2)', opacity: 0.35, transform: 'scale(1.3)' }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      )}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0.75))' }} />

      <MizuHeader title={page === 0 ? '正在播放' : '歌词'} onBack={onBack}
        right={<button onClick={() => setMenu(true)} className="p-1.5" style={{ color: C.muted }}><DotsThree size={20} weight="bold" /></button>} />

      {companions}

      {/* 封面屏 / 歌词屏：点击切换（同 LX） */}
      <div className="flex-1 relative z-10 min-h-0">
        {/* 封面屏 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 gap-5 transition-opacity duration-300"
          style={{ opacity: page === 0 ? 1 : 0, pointerEvents: page === 0 ? 'auto' : 'none' }}>
          <button onClick={() => goPage(1)} className="w-full max-w-[300px] aspect-square rounded-3xl overflow-hidden shadow-xl">
            <Cover src={current.albumPic} seed={current.name} className="w-full h-full" iconSize={56} />
          </button>
          <div className="text-center w-full">
            <div className="text-xl font-semibold truncate" style={{ color: C.text }}>{current.name}</div>
            <div className="text-xs mt-1 truncate" style={{ color: C.muted }}>{current.artists}{current.album ? ` · ${current.album}` : ''}</div>
            <div className="mt-3 min-h-[2.5rem]" onClick={() => goPage(1)}>
              <div className="text-sm" style={{ color: C.primary }}>{curLine?.text || (lyric.length ? '' : '暂无歌词')}</div>
              {curLine && <div className="text-[11px] mt-0.5" style={{ color: C.muted }}>{transFor(curLine.t)}</div>}
            </div>
          </div>
        </div>

        {/* 歌词屏 */}
        <div ref={lyricBoxRef} onClick={() => goPage(0)}
          className="absolute inset-0 overflow-y-auto px-6 text-center shizuku-scrollbar transition-opacity duration-300"
          style={{ paddingTop: padY, paddingBottom: padY, opacity: page === 1 ? 1 : 0, pointerEvents: page === 1 ? 'auto' : 'none' }}>
          {lyric.length === 0 && <div className="text-sm" style={{ color: C.faint }}>暂无歌词</div>}
          {lyric.map((l, i) => {
            const active = i === activeLyricIdx;
            const tr = transFor(l.t);
            return (
              <div key={i} data-i={i} className="py-2 transition-all"
                onClick={e => { e.stopPropagation(); if (duration) seek(l.t / duration); }}>
                <div className={active ? 'text-[17px] font-semibold' : 'text-[15px]'}
                  style={{ color: active ? C.primary : C.muted, opacity: active ? 1 : 0.65 }}>{l.text || '·'}</div>
                {tr && <div className="text-[11px] mt-0.5" style={{ color: C.muted, opacity: active ? 0.9 : 0.5 }}>{tr}</div>}
              </div>
            );
          })}
        </div>
      </div>


      {/* 控制条 */}
      <div className="relative z-10 px-6 pb-6 pt-1">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => { const on = toggleFavorite(current); setLiked(on); toast(on ? '已加入我喜欢' : '已取消喜欢', 'success'); }}
            className="p-1.5" style={{ color: liked ? '#f43f5e' : C.muted }}>
            <Heart size={20} weight={liked ? 'fill' : 'regular'} />
          </button>
          <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: C.muted, border: `1px solid ${C.muted}40` }}>
            {current.lxSource ? `${SOURCE_LABEL[current.lxSource] || current.lxSource} · ${LX_QUALITY_LABEL[loadLxQualityPref()]}` : ''}
          </span>
          <button onClick={cycleMode} className="p-1.5" style={{ color: C.muted }}><ModeIcon size={20} /></button>
        </div>
        <GlassProgress progress={progress} duration={duration} fmtTime={fmt} onSeek={seek} />
        <PlayControls playing={playing} loading={loadingSong} onPrev={prevSong} onToggle={togglePlay} onNext={nextSong} />
      </div>

      {menu && <SongActionSheet song={current} onClose={() => setMenu(false)} toast={toast} />}
    </div>
  );
};

export default PlayerPage;
