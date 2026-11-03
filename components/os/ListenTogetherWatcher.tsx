/**
 * 一起听时，每首新歌放满 20 秒后，自动让陪你听的角色真的听一遍、写听歌日记（每首只听一次）。
 * 需要在音乐 App 的音源设置里填「听歌模型」，并开着「一起听时自动听」。
 */
import React, { useEffect, useRef } from 'react';
import { useMusic } from '../../context/MusicContext';
import { useOS } from '../../context/OSContext';
import { isListenApiReady, loadListenApiConfig, listenToSong, findDiary } from '../../utils/music/songListen';

const ListenTogetherWatcher: React.FC = () => {
  const { current, playing, listeningTogetherWith } = useMusic();
  const { characters, addToast } = useOS();
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    if (!current || !playing || !listeningTogetherWith.length) return;
    const cfg = loadListenApiConfig();
    if (!cfg.autoTogether || !isListenApiReady(cfg)) return;
    const song = current;
    const partners = [...listeningTogetherWith];
    timerRef.current = window.setTimeout(() => {
      for (const charId of partners) {
        if (findDiary(charId, song)) continue;
        const name = characters.find(c => c.id === charId)?.name || 'TA';
        listenToSong(charId, song, 'together').then(r => {
          if (r.status === 'listened') addToast(`${name}听完了《${song.name}》，写了听歌日记`, 'success');
          else if (r.status === 'failed') addToast(`${name}没听成《${song.name}》：${r.error}`, 'error');
        });
      }
    }, 20000);
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, playing, listeningTogetherWith.join(',')]);

  return null;
};

export default ListenTogetherWatcher;
