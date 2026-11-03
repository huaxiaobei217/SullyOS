/** 单曲操作菜单：下一首播放 / 我喜欢 / 加到歌单 / 从当前歌单移除 */
import React, { useState } from 'react';
import { useMusic, Song } from '../../context/MusicContext';
import { C } from './MusicUI';
import Cover from './Cover';
import {
  loadPlaylists, addSongToPlaylist, createPlaylist, toggleFavorite, isInFavorites, FAVORITES_NAME,
} from '../../utils/music/lxList';

const SongActionSheet: React.FC<{
  song: Song;
  onClose: () => void;
  toast: (msg: string, type?: 'info' | 'success' | 'error') => void;
  /** 在某个歌单里打开时，提供移除 */
  onRemoveFromPlaylist?: () => void;
}> = ({ song, onClose, toast, onRemoveFromPlaylist }) => {
  const { queue, idx, setQueue, playSong } = useMusic();
  const [picking, setPicking] = useState(false);
  const liked = isInFavorites(song.id);

  const playNext = () => {
    if (!queue.length || idx < 0) { playSong(song); onClose(); return; }
    if (queue[idx]?.id === song.id) { onClose(); return; }
    // 只移除当前曲之后的同一首，保证当前曲的下标不变
    const next = queue.filter((s, i) => !(i > idx && s.id === song.id));
    next.splice(idx + 1, 0, song);
    setQueue(next);
    toast('会在这首之后播放', 'success');
    onClose();
  };

  const Item: React.FC<{ label: string; onClick: () => void; danger?: boolean }> = ({ label, onClick, danger }) => (
    <button onClick={onClick} className="w-full text-left px-4 py-3 text-sm active:bg-black/5"
      style={{ color: danger ? '#e11d48' : C.text }}>{label}</button>
  );

  return (
    <div className="absolute inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full rounded-t-3xl pb-6 pt-2 max-h-[70%] overflow-y-auto"
        style={{ background: 'rgba(255,255,255,0.97)' }} onClick={e => e.stopPropagation()}>
        <div className="mx-auto w-10 h-1 rounded-full bg-black/10 mb-2" />
        <div className="flex items-center gap-3 px-4 pb-3 border-b border-black/5">
          <Cover src={song.albumPic} seed={song.name} className="w-11 h-11 rounded-lg" />
          <div className="min-w-0">
            <div className="text-sm truncate" style={{ color: C.text }}>{song.name}</div>
            <div className="text-[11px] truncate" style={{ color: C.muted }}>{song.artists}</div>
          </div>
        </div>
        {!picking ? (
          <>
            <Item label="下一首播放" onClick={playNext} />
            <Item label={liked ? `从「${FAVORITES_NAME}」移除` : `加到「${FAVORITES_NAME}」`}
              onClick={() => { const on = toggleFavorite(song); toast(on ? '已加入我喜欢' : '已取消喜欢', 'success'); onClose(); }} />
            <Item label="加到歌单…" onClick={() => setPicking(true)} />
            {onRemoveFromPlaylist && <Item label="从这个歌单移除" danger onClick={() => { onRemoveFromPlaylist(); onClose(); }} />}
          </>
        ) : (
          <>
            <Item label="＋ 新建歌单并加入" onClick={() => {
              const name = prompt('新歌单名字')?.trim();
              if (!name) return;
              const pl = createPlaylist(name);
              addSongToPlaylist(pl.id, song);
              toast(`已加入「${name}」`, 'success');
              onClose();
            }} />
            {loadPlaylists().map(pl => (
              <Item key={pl.id} label={`${pl.name}（${pl.songs.length}）`} onClick={() => {
                const added = addSongToPlaylist(pl.id, song);
                toast(added ? `已加入「${pl.name}」` : `「${pl.name}」里已经有这首了`, added ? 'success' : 'info');
                onClose();
              }} />
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default SongActionSheet;
