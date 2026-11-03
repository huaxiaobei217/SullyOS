/**
 * 音乐 · 我的歌单（替代原网易云个人页）
 * - 音源：导入 LX 音源脚本（文件或粘贴），选音质
 * - 歌单：导入 LX 导出的 .lxmc / 浏览 / 播放
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMusic, Song } from '../../context/MusicContext';
import { C, MizuHeader, SongRow, BokehBg } from './MusicUI';
import { Gear, MagnifyingGlass, Plus, Trash, CaretLeft, Play, FileArrowUp } from '@phosphor-icons/react';
import {
  MusicPlaylist, loadPlaylists, savePlaylists, parseLxFile, mergeImported, PLAYLISTS_CHANGED_EVENT,
} from '../../utils/music/lxList';
import {
  loadSavedLxScript, saveLxScript, parseLxScriptInfo, getLxRuntime,
} from '../../utils/music/lxRuntime';
import { LX_QUALITY_ORDER, LX_QUALITY_LABEL, loadLxQualityPref, saveLxQualityPref, LxQualityPref } from '../../utils/music/lxQuality';

const SOURCE_LABEL: Record<string, string> = { wy: '网易', kg: '酷狗', kw: '酷我', tx: 'QQ', mg: '咪咕' };

const fmt = (s: number) => {
  if (!isFinite(s) || s <= 0) return '';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

const usePlaylists = (): [MusicPlaylist[], (next: MusicPlaylist[]) => void] => {
  const [lists, setLists] = useState<MusicPlaylist[]>(() => loadPlaylists());
  useEffect(() => {
    const h = () => setLists(loadPlaylists());
    window.addEventListener(PLAYLISTS_CHANGED_EVENT, h);
    return () => window.removeEventListener(PLAYLISTS_CHANGED_EVENT, h);
  }, []);
  return [lists, (next) => { savePlaylists(next); setLists(next); }];
};

const LibraryPage: React.FC<{
  onClose: () => void;
  onOpenSearch: () => void;
  onOpenPlayer: () => void;
  toast: (msg: string, type?: 'info' | 'success' | 'error') => void;
}> = ({ onClose, onOpenSearch, onOpenPlayer, toast }) => {
  const { current, playSong } = useMusic();
  const [lists, setLists] = usePlaylists();
  const [openId, setOpenId] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scriptFileRef = useRef<HTMLInputElement | null>(null);
  const [script, setScript] = useState(() => loadSavedLxScript());
  const scriptInfo = useMemo(() => (script ? parseLxScriptInfo(script) : null), [script]);
  const [quality, setQuality] = useState<LxQualityPref>(() => loadLxQualityPref());
  const [testing, setTesting] = useState(false);

  const open = lists.find(l => l.id === openId) || null;

  const importLx = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      let all: MusicPlaylist[] = [];
      let skipped = 0;
      for (const f of Array.from(files)) {
        const r = await parseLxFile(f);
        all = all.concat(r.playlists);
        skipped += r.skippedLocal.length;
      }
      setLists(mergeImported(lists, all));
      const n = all.reduce((a, p) => a + p.songs.length, 0);
      toast(`导入了 ${all.length} 个歌单、${n} 首歌${skipped ? `；${skipped} 首本地文件需要另外导入` : ''}`, 'success');
    } catch (e: any) {
      toast(`导入失败：${e?.message || e}`, 'error');
    }
  };

  const applyScript = async (text: string) => {
    const t = text.trim();
    if (!t.includes('lx') || !t.includes('EVENT_NAMES')) { toast('这看起来不是 LX 音源脚本', 'error'); return; }
    saveLxScript(t);
    setScript(t);
    setTesting(true);
    try {
      const rt = await getLxRuntime();
      const names = Object.keys(rt.sources).map(s => SOURCE_LABEL[s] || s).join('、');
      toast(`音源已启用：${rt.info.name}（${names || '无平台'}）`, 'success');
    } catch (e: any) {
      toast(`音源启动失败：${e?.message || e}`, 'error');
    } finally { setTesting(false); }
  };

  const removePlaylist = (id: string) => {
    if (!confirm('删除这个歌单？')) return;
    setLists(lists.filter(l => l.id !== id));
    setOpenId(null);
  };

  const removeSong = (pl: MusicPlaylist, song: Song) => {
    setLists(lists.map(l => l.id === pl.id ? { ...l, songs: l.songs.filter(s => s.id !== song.id), updatedAt: Date.now() } : l));
  };

  const newPlaylist = () => {
    const name = prompt('新歌单名字')?.trim();
    if (!name) return;
    const now = Date.now();
    setLists([...lists, { id: `pl_${now.toString(36)}`, name, songs: [], createdAt: now, updatedAt: now }]);
  };

  const bg = { background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 50%, ${C.bgDeep} 100%)` };

  /* ───── 歌单详情 ───── */
  if (open) {
    return (
      <div className="flex flex-col h-full relative" style={bg}>
        <BokehBg />
        <MizuHeader title={open.name} onBack={() => setOpenId(null)}
          right={<button onClick={() => removePlaylist(open.id)} className="p-1.5" style={{ color: C.muted }}><Trash size={16} /></button>} />
        <div className="px-4 pb-2 flex items-center gap-2 relative z-10">
          <button
            disabled={!open.songs.length}
            onClick={() => { playSong(open.songs[0], { replaceQueue: open.songs, startIdx: 0 }); onOpenPlayer(); }}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs text-white"
            style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})` }}>
            <Play size={12} weight="fill" /> 播放全部
          </button>
          <span className="text-[11px]" style={{ color: C.muted }}>{open.songs.length} 首 · 长按歌曲可移除</span>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-24 relative z-10 shizuku-scrollbar">
          {open.songs.map((s, i) => (
            <div key={s.id} className="relative"
              onContextMenu={(e) => { e.preventDefault(); if (confirm(`从歌单移除「${s.name}」？`)) removeSong(open, s); }}>
              <SongRow
                name={s.name}
                artists={`${s.lxSource ? `[${SOURCE_LABEL[s.lxSource] || s.lxSource}] ` : ''}${s.artists}`}
                album={s.album}
                albumPic={s.albumPic}
                duration={s.interval || fmt(s.duration)}
                isVip={false}
                isActive={current?.id === s.id}
                onClick={() => playSong(s, { replaceQueue: open.songs, startIdx: i })}
              />
            </div>
          ))}
          {!open.songs.length && <div className="text-center text-xs mt-16" style={{ color: C.faint }}>歌单还是空的</div>}
        </div>
      </div>
    );
  }

  /* ───── 首页：音源 + 歌单列表 ───── */
  return (
    <div className="flex flex-col h-full relative" style={bg}>
      <BokehBg />
      <MizuHeader title="我的音乐" onClose={onClose}
        right={
          <div className="flex items-center gap-1">
            <button onClick={onOpenSearch} className="p-1.5" style={{ color: C.primary }} title="搜索"><MagnifyingGlass size={16} weight="bold" /></button>
            <button onClick={() => setShowSource(v => !v)} className="p-1.5" style={{ color: C.primary }} title="音源设置"><Gear size={16} weight="bold" /></button>
          </div>
        } />

      <div className="flex-1 overflow-y-auto px-4 pb-24 space-y-3 relative z-10 shizuku-scrollbar">
        {/* 音源卡片 */}
        <div className="rounded-2xl p-3.5 shizuku-glass">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-[10px] tracking-wider" style={{ color: C.muted }}>音源</div>
              <div className="text-sm truncate" style={{ color: C.text }}>
                {scriptInfo ? `${scriptInfo.name}${scriptInfo.version ? ' · ' + scriptInfo.version : ''}` : '还没有导入音源脚本'}
              </div>
            </div>
            <button onClick={() => setShowSource(v => !v)} className="text-[11px] px-3 py-1 rounded-full shrink-0"
              style={{ color: C.primary, border: `1px solid ${C.primary}40` }}>
              {scriptInfo ? '设置' : '导入'}
            </button>
          </div>
          {showSource && (
            <div className="mt-3 space-y-3">
              <div className="flex gap-2">
                <button onClick={() => scriptFileRef.current?.click()} disabled={testing}
                  className="flex-1 py-2 rounded-xl text-[11px] text-white"
                  style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})` }}>
                  {testing ? '启动中…' : '选择 .js 音源文件'}
                </button>
                {script && (
                  <button onClick={() => { if (confirm('移除当前音源？')) { saveLxScript(''); setScript(''); } }}
                    className="px-3 py-2 rounded-xl text-[11px] shizuku-glass" style={{ color: C.muted }}>移除</button>
                )}
              </div>
              <input ref={scriptFileRef} type="file" accept=".js,text/javascript,text/plain" className="hidden"
                onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) applyScript(await f.text()); }} />
              <div>
                <div className="text-[10px] mb-1.5" style={{ color: C.muted }}>音质（取音源和歌曲都支持的、不超过这一档的最高音质）</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {LX_QUALITY_ORDER.map(q => (
                    <button key={q} onClick={() => { setQuality(q); saveLxQualityPref(q); }}
                      className="py-1.5 rounded-xl text-[10px]"
                      style={{
                        background: quality === q ? `linear-gradient(135deg, ${C.primary}, ${C.accent})` : C.glass,
                        color: quality === q ? 'white' : C.muted,
                      }}>{LX_QUALITY_LABEL[q]}</button>
                  ))}
                </div>
              </div>
              <div className="text-[9px] leading-relaxed" style={{ color: C.faint }}>
                脚本和里面的密钥只存在这台设备上。脚本的网络请求经「设置 → 网络代理」里你自己的 Worker 转发。
              </div>
            </div>
          )}
        </div>

        {/* 歌单 */}
        <div className="flex items-center justify-between pt-1">
          <div className="text-[11px] tracking-wider" style={{ color: C.muted }}>我的歌单</div>
          <div className="flex items-center gap-1">
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full"
              style={{ color: C.primary, border: `1px solid ${C.primary}40` }}>
              <FileArrowUp size={12} /> 导入 LX 歌单
            </button>
            <button onClick={newPlaylist} className="p-1.5" style={{ color: C.primary }} title="新建歌单"><Plus size={14} weight="bold" /></button>
          </div>
          <input ref={fileRef} type="file" multiple accept=".lxmc,.json,application/octet-stream" className="hidden"
            onChange={e => { const fs = e.target.files; importLx(fs).finally(() => { e.target.value = ''; }); }} />
        </div>

        {lists.length === 0 && (
          <div className="text-center text-xs mt-10 leading-relaxed" style={{ color: C.faint }}>
            在 LX 里「设置 → 备份与恢复 → 导出列表」，<br />再点上面的「导入 LX 歌单」选那个 .lxmc 文件
          </div>
        )}
        {lists.map(l => {
          const cover = l.songs.find(s => s.albumPic)?.albumPic;
          return (
            <button key={l.id} onClick={() => setOpenId(l.id)}
              className="w-full flex items-center gap-3 p-2 rounded-2xl shizuku-glass text-left">
              <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0" style={{ background: C.bgDeep }}>
                {cover && <img src={cover} alt="" className="w-full h-full object-cover" loading="lazy" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate" style={{ color: C.text }}>{l.name}</div>
                <div className="text-[10px]" style={{ color: C.muted }}>{l.songs.length} 首{l.origin ? ` · ${l.origin}` : ''}</div>
              </div>
              <CaretLeft size={12} className="rotate-180" style={{ color: C.faint }} />
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default LibraryPage;
