/**
 * 换歌时把「正在听」推给外部（比如角色的 MCP 的 /update），替代手机上的 MacroDroid。
 * 只推歌名、歌手、来源；没配地址就什么都不做。
 */
import React, { useEffect, useRef } from 'react';
import { useMusic } from '../../context/MusicContext';
import { loadNowPlayingSyncPrefs } from '../../utils/music/musicPrefs';

export const pushNowPlaying = async (music: string, opts?: { url?: string; token?: string }) => {
  const prefs = loadNowPlayingSyncPrefs();
  const url = (opts?.url ?? prefs.url).trim();
  if (!url) throw new Error('没有填同步地址');
  const token = (opts?.token ?? prefs.token).trim();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ music, player: 'SullyOS' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
};

const NowPlayingSync: React.FC = () => {
  const { current, playing } = useMusic();
  const lastSent = useRef<number | null>(null);
  useEffect(() => {
    if (!current || !playing || lastSent.current === current.id) return;
    if (!loadNowPlayingSyncPrefs().url.trim()) return;
    lastSent.current = current.id;
    const label = current.artists ? `${current.name} - ${current.artists}` : current.name;
    pushNowPlaying(label).catch(() => { lastSent.current = null; });
  }, [current, playing]);
  return null;
};

export default NowPlayingSync;
