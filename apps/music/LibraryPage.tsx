/**
 * 音乐 · 我的歌单（替代原网易云个人页）
 * - 音源：导入 LX 音源脚本（文件或粘贴），选音质
 * - 歌单：导入 LX 导出的 .lxmc / 浏览 / 播放
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMusic, Song } from '../../context/MusicContext';
import { C, MizuHeader, SongRow, BokehBg } from './MusicUI';
import SongActionSheet from './SongActionSheet';
import Cover from './Cover';
import { Gear, MagnifyingGlass, Plus, Trash, CaretLeft, Play, FileArrowUp, PencilSimple, List, X, ArrowsDownUp, ArrowUp, ArrowDown, DotsThreeVertical, MusicNoteSimple } from '@phosphor-icons/react';
import {
  MusicPlaylist, loadPlaylists, savePlaylists, parseLxFile, mergeImported, PLAYLISTS_CHANGED_EVENT, moveItem,
} from '../../utils/music/lxList';
import { importAudioFiles } from '../../utils/music/localImport';
import {
  loadSavedLxScript, saveLxScript, parseLxScriptInfo, getLxRuntime,
} from '../../utils/music/lxRuntime';
import { loadDesktopLyricPrefs, saveDesktopLyricPrefs, loadNowPlayingSyncPrefs, saveNowPlayingSyncPrefs } from '../../utils/music/musicPrefs';
import { pushNowPlaying } from '../../components/os/NowPlayingSync';
import { loadListenApiConfig, saveListenApiConfig } from '../../utils/music/songListen';
import { LX_QUALITY_ORDER, LX_QUALITY_LABEL, loadLxQualityPref, saveLxQualityPref, LxQualityPref } from '../../utils/music/lxQuality';

const LS_LAST_PLAYLIST = 'sully_music_last_playlist_v1';
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
  // 打开音乐 App 直接进上次看的歌单（没有就第一个）；歌单列表放进左侧抽屉
  const [openId, setOpenIdRaw] = useState<string | null>(() => {
    const ls = loadPlaylists();
    let last: string | null = null;
    try { last = localStorage.getItem(LS_LAST_PLAYLIST); } catch {}
    return (last && ls.some(l => l.id === last)) ? last : (ls[0]?.id ?? null);
  });
  const setOpenId = (id: string | null) => {
    setOpenIdRaw(id);
    try { if (id) localStorage.setItem(LS_LAST_PLAYLIST, id); } catch {}
  };
  const [drawer, setDrawer] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scriptFileRef = useRef<HTMLInputElement | null>(null);
  const [script, setScript] = useState(() => loadSavedLxScript());
  const scriptInfo = useMemo(() => (script ? parseLxScriptInfo(script) : null), [script]);
  const [quality, setQuality] = useState<LxQualityPref>(() => loadLxQualityPref());
  const [testing, setTesting] = useState(false);
  const [sheetSong, setSheetSong] = useState<Song | null>(null);
  const [lyricPrefs, setLyricPrefs] = useState(() => loadDesktopLyricPrefs());
  const [syncPrefs, setSyncPrefs] = useState(() => loadNowPlayingSyncPrefs());
  const [listenCfg, setListenCfg] = useState(() => loadListenApiConfig());
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const fetchModels = async () => {
    if (!listenCfg.baseUrl.trim() || !listenCfg.apiKey.trim()) { toast('先填 Base URL 和 API Key', 'info'); return; }
    setFetchingModels(true);
    try {
      const res = await fetch(`${listenCfg.baseUrl.trim().replace(/\/+$/, '')}/models`, { headers: { Authorization: `Bearer ${listenCfg.apiKey.trim()}` } });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message || `HTTP ${res.status}`);
      const ids: string[] = (j?.data || j?.models || []).map((m: any) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean);
      setModels(ids);
      toast(ids.length ? `拉到 ${ids.length} 个模型` : '没拉到模型', ids.length ? 'success' : 'info');
    } catch (e: any) { toast(`拉取失败：${e?.message || e}`, 'error'); }
    finally { setFetchingModels(false); }
  };
  const setListen = (patch: Partial<typeof listenCfg>) => { const n = { ...listenCfg, ...patch }; setListenCfg(n); saveListenApiConfig(n); };
  const [sorting, setSorting] = useState(false);
  const [importingLocal, setImportingLocal] = useState(false);
  const localFileRef = useRef<HTMLInputElement | null>(null);

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
      const merged = mergeImported(lists, all);
      setLists(merged);
      if (!openId && merged[0]) setOpenId(merged[0].id);
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
    const rest = lists.filter(l => l.id !== id);
    setLists(rest);
    setOpenIdRaw(rest[0]?.id ?? null);
  };

  const removeSong = (pl: MusicPlaylist, song: Song) => {
    setLists(lists.map(l => l.id === pl.id ? { ...l, songs: l.songs.filter(s => s.id !== song.id), updatedAt: Date.now() } : l));
  };

  const renameOpen = () => {
    if (!open) return;
    const name = prompt('歌单名字', open.name)?.trim();
    if (!name || name === open.name) return;
    setLists(lists.map(l => l.id === open.id ? { ...l, name, updatedAt: Date.now() } : l));
  };

  const moveSong = (from: number, to: number) => {
    if (!open) return;
    setLists(lists.map(l => l.id === open.id ? { ...l, songs: moveItem(l.songs, from, to), updatedAt: Date.now() } : l));
  };

  const movePlaylist = (from: number, to: number) => setLists(moveItem(lists, from, to));

  const importLocal = async (files: FileList | null) => {
    if (!open || !files?.length) return;
    setImportingLocal(true);
    try {
      const songs = await importAudioFiles(files);
      if (!songs.length) { toast('没有可导入的音频文件', 'info'); return; }
      setLists(loadPlaylists().map(l => l.id === open.id ? { ...l, songs: [...l.songs, ...songs], updatedAt: Date.now() } : l));
      toast(`导入了 ${songs.length} 首本地音乐`, 'success');
    } catch (e: any) {
      toast(`导入失败：${e?.message || e}（手机空间可能不够）`, 'error');
    } finally { setImportingLocal(false); }
  };

  const newPlaylist = () => {
    const name = prompt('新歌单名字')?.trim();
    if (!name) return;
    const now = Date.now();
    setLists([...lists, { id: `pl_${now.toString(36)}`, name, songs: [], createdAt: now, updatedAt: now }]);
  };

  const bg = { background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 50%, ${C.bgDeep} 100%)` };

  /* 音源 + 歌单列表：没有选中歌单时是整页，选中后放进左侧抽屉 */
  const homeBody = (
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
              <div className="pt-2 border-t border-white/40 space-y-2">
                <label className="flex items-center justify-between text-[11px]" style={{ color: C.text }}>
                  <span>桌面歌词（离开音乐 App 后显示，可上下拖动）</span>
                  <input type="checkbox" checked={lyricPrefs.enabled}
                    onChange={e => { const p = { ...lyricPrefs, enabled: e.target.checked }; setLyricPrefs(p); saveDesktopLyricPrefs(p); }} />
                </label>
                <label className="flex items-center justify-between text-[11px]" style={{ color: C.text }}>
                  <span>桌面歌词显示翻译</span>
                  <input type="checkbox" checked={lyricPrefs.showTranslation}
                    onChange={e => { const p = { ...lyricPrefs, showTranslation: e.target.checked }; setLyricPrefs(p); saveDesktopLyricPrefs(p); }} />
                </label>
              </div>
              <div className="pt-2 border-t border-white/40 space-y-1.5">
                <div className="text-[10px]" style={{ color: C.muted }}>换歌时同步「正在听」到（比如你的 MCP 的 /update 地址，留空就不同步）</div>
                <input className="w-full rounded-xl px-3 py-1.5 outline-none text-[11px] shizuku-glass" style={{ color: C.text }}
                  placeholder="https://mcp.xxx/update" value={syncPrefs.url}
                  onChange={e => { const p = { ...syncPrefs, url: e.target.value }; setSyncPrefs(p); saveNowPlayingSyncPrefs(p); }} />
                <input className="w-full rounded-xl px-3 py-1.5 outline-none text-[11px] shizuku-glass" style={{ color: C.text }}
                  placeholder="通行密钥（MCP 加了校验才需要，可留空）" value={syncPrefs.token}
                  onChange={e => { const p = { ...syncPrefs, token: e.target.value }; setSyncPrefs(p); saveNowPlayingSyncPrefs(p); }} />
                <button className="text-[10px] underline" style={{ color: C.primary }}
                  onClick={() => pushNowPlaying(current ? `${current.name} - ${current.artists}` : '测试 - SullyOS')
                    .then(() => toast('已发送', 'success')).catch(e => toast(`发送失败：${e.message}`, 'error'))}>
                  发送一次试试
                </button>
              </div>
              <div className="pt-2 border-t border-white/40 space-y-1.5">
                <div className="text-[10px] leading-relaxed" style={{ color: C.muted }}>
                  听歌模型：让角色真的听歌、写听歌日记。需要能听音频的模型（OpenAI 兼容格式，比如 Gemini 系列）
                </div>
                <input className="w-full rounded-xl px-3 py-1.5 outline-none text-[11px] shizuku-glass" style={{ color: C.text }}
                  placeholder="Base URL（例如 https://xxx/v1）" value={listenCfg.baseUrl} onChange={e => setListen({ baseUrl: e.target.value })} />
                <input className="w-full rounded-xl px-3 py-1.5 outline-none text-[11px] shizuku-glass" style={{ color: C.text }} type="password"
                  placeholder="API Key" value={listenCfg.apiKey} onChange={e => setListen({ apiKey: e.target.value })} />
                <div className="flex gap-1.5">
                  <input className="flex-1 min-w-0 rounded-xl px-3 py-1.5 outline-none text-[11px] shizuku-glass" style={{ color: C.text }}
                    placeholder="模型名（例如 gemini-2.5-flash）" value={listenCfg.model} onChange={e => setListen({ model: e.target.value })} />
                  <button onClick={fetchModels} disabled={fetchingModels} className="shrink-0 px-2.5 rounded-xl text-[11px]"
                    style={{ color: C.primary, border: `1px solid ${C.primary}40` }}>{fetchingModels ? '拉取中…' : '拉取模型'}</button>
                </div>
                {models.length > 0 && (
                  <select className="w-full rounded-xl px-2 py-1.5 outline-none text-[11px] shizuku-glass" style={{ color: C.text }}
                    value={models.includes(listenCfg.model) ? listenCfg.model : ''} onChange={e => setListen({ model: e.target.value })}>
                    <option value="" disabled>从列表里选一个（要能听音频的）</option>
                    {models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
                <label className="flex items-center justify-between text-[11px]" style={{ color: C.text }}>
                  <span>一起听时，每首新歌自动让 TA 听（放满 20 秒才算）</span>
                  <input type="checkbox" checked={listenCfg.autoTogether} onChange={e => setListen({ autoTogether: e.target.checked })} />
                </label>
                <label className="flex items-center justify-between text-[11px]" style={{ color: C.text }}>
                  <span>没人陪听时，放新歌也自动生成歌曲解读</span>
                  <input type="checkbox" checked={listenCfg.autoAnalyze} onChange={e => setListen({ autoAnalyze: e.target.checked })} />
                </label>
                <div className="text-[9px] leading-relaxed" style={{ color: C.faint }}>
                  歌曲解读每首只听一次音频，存档后所有角色共用；听歌日记是每个角色自己的，读解读来写，不再重复听。
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
            {lists.length > 1 && (
              <button onClick={() => setSorting(v => !v)} className="p-1.5" style={{ color: sorting ? C.accent : C.primary }} title="调整顺序"><ArrowsDownUp size={14} weight="bold" /></button>
            )}
          </div>
          <input ref={fileRef} type="file" multiple accept=".lxmc,.json,application/octet-stream" className="hidden"
            onChange={e => { const fs = e.target.files; importLx(fs).finally(() => { e.target.value = ''; }); }} />
        </div>

        {lists.length === 0 && (
          <div className="text-center text-xs mt-10 leading-relaxed" style={{ color: C.faint }}>
            在 LX 里「设置 → 备份与恢复 → 导出列表」，<br />再点上面的「导入 LX 歌单」选那个 .lxmc 文件
          </div>
        )}
        {lists.map((l, li) => {
          const cover = l.songs.find(s => s.albumPic)?.albumPic;
          return (
            <div key={l.id} className="relative">
            <button onClick={() => { if (!sorting) { setOpenId(l.id); setDrawer(false); } }}
              className="w-full flex items-center gap-3 p-2 rounded-2xl shizuku-glass text-left">
              <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0" style={{ background: C.bgDeep }}>
                <Cover src={cover} seed={l.name} className="w-full h-full" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate" style={{ color: C.text }}>{l.name}</div>
                <div className="text-[10px]" style={{ color: C.muted }}>{l.songs.length} 首{l.origin ? ` · ${l.origin}` : ''}</div>
              </div>
              {sorting ? (
                <span className="flex items-center" style={{ color: C.muted }}>
                  <span role="button" onClick={e => { e.stopPropagation(); movePlaylist(li, li - 1); }} className={`p-1.5 ${li === 0 ? 'opacity-20' : ''}`}><ArrowUp size={14} /></span>
                  <span role="button" onClick={e => { e.stopPropagation(); movePlaylist(li, li + 1); }} className={`p-1.5 ${li === lists.length - 1 ? 'opacity-20' : ''}`}><ArrowDown size={14} /></span>
                </span>
              ) : <CaretLeft size={12} className="rotate-180" style={{ color: C.faint }} />}
            </button>
            </div>
          );
        })}
      </div>
  );

  /* ───── 歌单详情 ───── */
  if (open) {
    return (
      <div className="flex flex-col h-full relative" style={bg}>
        <BokehBg />
        <div className="flex items-center gap-1 px-2 h-12 shrink-0 shizuku-glass-strong relative z-20"
          style={{ paddingTop: 'calc(var(--safe-top) + 10px)', boxSizing: 'content-box' }}>
          <button onClick={() => { setDrawer(true); setSorting(false); }} className="p-2" style={{ color: C.primary }} title="歌单列表"><List size={18} weight="bold" /></button>
          <div className="flex-1 min-w-0 text-sm font-semibold truncate" style={{ color: C.text }}>{open.name}</div>
          <button onClick={onOpenSearch} className="p-1.5" style={{ color: C.primary }} title="搜索"><MagnifyingGlass size={16} weight="bold" /></button>
          <button onClick={renameOpen} className="p-1.5" style={{ color: C.muted }} title="改名"><PencilSimple size={16} /></button>
          <button onClick={() => removePlaylist(open.id)} className="p-1.5" style={{ color: C.muted }} title="删除歌单"><Trash size={16} /></button>
          <button onClick={onClose} className="p-1.5" style={{ color: C.muted }} title="关闭"><X size={16} /></button>
        </div>
        <div className="px-4 pb-2 flex items-center gap-2 relative z-10">
          <button
            disabled={!open.songs.length}
            onClick={() => { playSong(open.songs[0], { replaceQueue: open.songs, startIdx: 0 }); onOpenPlayer(); }}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs text-white"
            style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})` }}>
            <Play size={12} weight="fill" /> 播放全部
          </button>
          <span className="text-[11px] flex-1" style={{ color: C.muted }}>{open.songs.length} 首</span>
          <button onClick={() => localFileRef.current?.click()} disabled={importingLocal}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full" style={{ color: C.primary, border: `1px solid ${C.primary}40` }}>
            <MusicNoteSimple size={12} /> {importingLocal ? '导入中…' : '本地文件'}
          </button>
          <button onClick={() => setSorting(v => !v)}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full"
            style={{ color: sorting ? 'white' : C.primary, background: sorting ? C.primary : 'transparent', border: `1px solid ${C.primary}40` }}>
            <ArrowsDownUp size={12} /> {sorting ? '完成' : '排序'}
          </button>
          <input ref={localFileRef} type="file" multiple accept="audio/*,.mp3,.flac,.m4a,.ogg,.wav" className="hidden"
            onChange={e => { const fs = e.target.files; importLocal(fs).finally(() => { e.target.value = ''; }); }} />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-24 relative z-10 shizuku-scrollbar">
          {open.songs.map((s, i) => (
            <div key={s.id} className={`relative ${sorting ? 'pr-16' : 'pr-7'}`}
              onContextMenu={(e) => { e.preventDefault(); if (!sorting) setSheetSong(s); }}>
              <SongRow
                name={s.name}
                artists={`${s.lxSource ? `[${SOURCE_LABEL[s.lxSource] || s.lxSource}] ` : ''}${s.artists}`}
                album={s.album}
                albumPic={s.albumPic}
                duration={s.interval || fmt(s.duration)}
                isVip={false}
                isActive={current?.id === s.id}
                onClick={() => { if (!sorting) playSong(s, { replaceQueue: open.songs, startIdx: i }); }}
              />
              {sorting ? (
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center" style={{ color: C.muted }}>
                  <button onClick={() => moveSong(i, i - 1)} disabled={i === 0} className="p-1.5 disabled:opacity-20"><ArrowUp size={14} /></button>
                  <button onClick={() => moveSong(i, i + 1)} disabled={i === open.songs.length - 1} className="p-1.5 disabled:opacity-20"><ArrowDown size={14} /></button>
                </div>
              ) : (
                <button onClick={() => setSheetSong(s)} aria-label="更多"
                  className="absolute right-0 top-1/2 -translate-y-1/2 p-2" style={{ color: C.faint }}>
                  <DotsThreeVertical size={16} weight="bold" />
                </button>
              )}
            </div>
          ))}
          {!open.songs.length && <div className="text-center text-xs mt-16" style={{ color: C.faint }}>歌单还是空的</div>}
        </div>
        {sheetSong && (
          <SongActionSheet song={sheetSong} toast={toast} onClose={() => setSheetSong(null)}
            onRemoveFromPlaylist={() => removeSong(open, sheetSong)} />
        )}
        {drawer && (
          <div className="absolute inset-0 z-40 flex" onClick={() => setDrawer(false)}>
            <style>{'@keyframes slideInLeft{from{transform:translateX(-100%)}to{transform:none}}'}</style>
            <div className="h-full w-[82%] max-w-[360px] flex flex-col shadow-2xl"
              style={{ ...bg, animation: 'slideInLeft .2s ease-out' }} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 h-12 shrink-0" style={{ paddingTop: 'calc(var(--safe-top) + 10px)', boxSizing: 'content-box' }}>
                <span className="text-sm font-semibold" style={{ color: C.text }}>我的音乐</span>
                <button onClick={() => setDrawer(false)} className="p-1.5" style={{ color: C.muted }}><X size={16} /></button>
              </div>
              {homeBody}
            </div>
            <div className="flex-1 bg-black/25" />
          </div>
        )}
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
      {homeBody}
    </div>
  );
};

export default LibraryPage;