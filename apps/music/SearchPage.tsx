/** 搜索：网易 / 酷狗 / 酷我 分平台搜，点播放、长按或点 ⋯ 打开操作菜单（加到歌单等） */
import React, { useState } from 'react';
import { useMusic, Song } from '../../context/MusicContext';
import { C, MizuHeader, SongRow, BokehBg } from './MusicUI';
import SongActionSheet from './SongActionSheet';
import { searchSongs, SEARCH_SOURCES, SearchSource } from '../../utils/music/search';
import { MagnifyingGlass, DotsThreeVertical } from '@phosphor-icons/react';

const SearchPage: React.FC<{
  onBack: () => void;
  toast: (msg: string, type?: 'info' | 'success' | 'error') => void;
}> = ({ onBack, toast }) => {
  const { current, playSong } = useMusic();
  const [source, setSource] = useState<SearchSource>('wy');
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState('');
  const [sheetSong, setSheetSong] = useState<Song | null>(null);

  const run = async (src: SearchSource, kw: string, p = 1) => {
    if (!kw.trim()) return;
    setLoading(true);
    try {
      const list = await searchSongs(src, kw, p);
      setResults(prev => (p === 1 ? list : [...prev, ...list.filter(s => !prev.some(x => x.id === s.id))]));
      setPage(p);
      setSearched(kw);
      if (p === 1 && !list.length) toast('没搜到，换个平台试试', 'info');
    } catch (e: any) {
      toast(`搜索失败：${e?.message || e}`, 'error');
    } finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col h-full relative" style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 50%, ${C.bgDeep} 100%)` }}>
      <BokehBg />
      <MizuHeader title="搜索" onBack={onBack} />
      <div className="px-4 pt-2 relative z-10">
        <form onSubmit={e => { e.preventDefault(); run(source, keyword, 1); }}
          className="flex items-center gap-2 rounded-2xl px-3 py-2 shizuku-glass">
          <MagnifyingGlass size={15} style={{ color: C.muted }} />
          <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="歌名 / 歌手"
            className="flex-1 bg-transparent outline-none text-sm" style={{ color: C.text }} enterKeyHint="search" />
          <button type="submit" className="text-xs px-2" style={{ color: C.primary }}>{loading ? '…' : '搜索'}</button>
        </form>
        <div className="flex gap-1.5 mt-2">
          {SEARCH_SOURCES.map(s => (
            <button key={s.id}
              onClick={() => { setSource(s.id); if (searched) run(s.id, searched, 1); }}
              className="px-3 py-1 rounded-full text-[11px]"
              style={{
                background: source === s.id ? `linear-gradient(135deg, ${C.primary}, ${C.accent})` : C.glass,
                color: source === s.id ? 'white' : C.muted,
              }}>{s.label}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pt-2 pb-24 relative z-10 shizuku-scrollbar">
        {results.map((s, i) => (
          <div key={s.id} className="relative pr-7" onContextMenu={e => { e.preventDefault(); setSheetSong(s); }}>
            <SongRow name={s.name} artists={s.artists} album={s.album} albumPic={s.albumPic}
              duration={s.interval || ''} isVip={false} isActive={current?.id === s.id}
              onClick={() => playSong(s, { replaceQueue: results, startIdx: i })} />
            <button onClick={() => setSheetSong(s)} aria-label="更多"
              className="absolute right-0 top-1/2 -translate-y-1/2 p-2" style={{ color: C.faint }}>
              <DotsThreeVertical size={16} weight="bold" />
            </button>
          </div>
        ))}
        {results.length > 0 && (
          <button onClick={() => run(source, searched, page + 1)} disabled={loading}
            className="w-full py-3 text-xs" style={{ color: C.muted }}>{loading ? '加载中…' : '加载更多'}</button>
        )}
        {!results.length && !loading && (
          <div className="text-center text-xs mt-16" style={{ color: C.faint }}>搜一首想听的歌吧</div>
        )}
      </div>

      {sheetSong && <SongActionSheet song={sheetSong} toast={toast} onClose={() => setSheetSong(null)} />}
    </div>
  );
};

export default SearchPage;
