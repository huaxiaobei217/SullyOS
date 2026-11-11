/**
 * 角色的音乐主页（个人二改，整页重做）
 *
 * 以前是仿网易云「拜访小号」：一张卡 + 歌单/喜欢/最近听三个数字 + AI 生成的三个概念歌单（大多是空的）。
 * 现在按真实发生的事来排：
 *  - 顶上：他是谁、此刻在听什么、你们一起听了多久、他推过几首、直接放过几首
 *  - 他的歌单：你给他攒的那个（默认名字带 N.C / 他名字的，和推歌、放歌用的是同一个歌池）+ 他自己收进来的
 *  - 他推给你的 / 他直接放的：一条时间线，点一下就放
 *  - 写过的话、设置（用哪几个歌单当他的歌、能不能看你的网易云、重新生成音乐人格）收在最下面
 * 没生成过音乐人格的角色还是显示「敲敲门」。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { useMusic, Song } from '../../context/MusicContext';
import { CharPlaylist } from '../../types';
import { CharMusicPersona } from '../../utils/charMusicPersona';
import { computeCurrentListening } from '../../utils/charMusicSchedule';
import { C, Sparkle, MizuHeader, BokehBg, MiniPlayer } from './MusicUI';
import { MusicNote, Play, Shuffle, CaretDown, CaretUp, Trash } from '@phosphor-icons/react';
import { getDailyScheduleForChar } from '../../utils/dailySchedule';
import TokenImg from '../../components/os/TokenImg';
import { isBlobRef } from '../../utils/blobRef';
import { useLocalDateKey } from '../../hooks/useLocalDateKey';
import { resolveCharTimeZone } from '../../utils/timezone';
import { trackEvent } from '../../utils/analytics';
import { getPickLog, getPickPlaylistIds, setPickPlaylistIds, getUserPlaylistsFull, listUserPlaylists, playInvitedSong, PICKS_EVENT, type PoolSong } from '../../utils/charSongPicks';
import { getCtrlLog, MUSIC_CTRL_LOG_EVENT } from '../../utils/charMusicControl';
import { summarize, fmtDur, MUSIC_STATS_EVENT } from '../../utils/music/musicStats';

interface Props { charId: string; onBack: () => void; onOpenPlayer: () => void }

const ago = (t: number) => {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 60) return m <= 1 ? '刚刚' : `${m} 分钟前`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24); return d === 1 ? '昨天' : d < 7 ? `${d} 天前` : `${Math.floor(d / 7)} 周前`;
};

/** 2×2 拼图封面 */
const Mosaic: React.FC<{ songs: { albumPic?: string }[]; size: number }> = ({ songs, size }) => {
  const pics = Array.from(new Set(songs.map(s => s.albumPic).filter(Boolean) as string[])).slice(0, 4);
  return (
    <div className="shrink-0 rounded-2xl overflow-hidden grid grid-cols-2" style={{ width: size, height: size, background: `linear-gradient(135deg, ${C.lavender}, ${C.sakura})`, boxShadow: `0 6px 18px ${C.glow}40` }}>
      {pics.length >= 4 ? pics.map((p, i) => <TokenImg key={i} value={p} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />)
        : pics[0] ? <TokenImg value={pics[0]} alt="" className="w-full h-full object-cover col-span-2 row-span-2" referrerPolicy="no-referrer" />
        : <div className="col-span-2 row-span-2 flex items-center justify-center text-white"><MusicNote size={size / 3} weight="bold" /></div>}
    </div>
  );
};

const SongLine: React.FC<{ s: PoolSong; i: number; onPlay: () => void; active?: boolean }> = ({ s, i, onPlay, active }) => (
  <button onClick={onPlay} className="w-full flex items-center gap-2.5 py-1.5 px-1.5 rounded-xl text-left active:bg-white/50">
    <span className="w-5 text-center text-[10px] shrink-0" style={{ color: active ? C.primary : C.faint }}>{active ? '♪' : i + 1}</span>
    {s.albumPic ? <TokenImg value={s.albumPic} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" referrerPolicy="no-referrer" />
      : <div className="w-8 h-8 rounded-lg shrink-0" style={{ background: `linear-gradient(135deg, ${C.accent}, ${C.sakura})` }} />}
    <div className="flex-1 min-w-0">
      <div className="text-[12px] truncate" style={{ color: active ? C.primary : C.text, fontWeight: active ? 600 : 400 }}>{s.name}</div>
      <div className="text-[10px] truncate" style={{ color: C.muted }}>{s.artists}</div>
    </div>
    {s.fee === 1 && <span className="text-[8px] px-1 rounded shrink-0" style={{ color: C.vip, border: `1px solid ${C.vip}50` }}>VIP</span>}
  </button>
);

const Section: React.FC<{ title: string; right?: React.ReactNode; children: React.ReactNode }> = ({ title, right, children }) => (
  <div className="mx-4 mt-5">
    <div className="flex items-center gap-2 mb-2 px-1">
      <div className="w-1 h-3.5 rounded-full" style={{ background: `linear-gradient(180deg, ${C.primary}, ${C.accent})` }} />
      <span className="text-[12px] font-semibold flex-1" style={{ color: C.text, fontFamily: `'Noto Serif', serif` }}>{title}</span>
      {right}
    </div>
    {children}
  </div>
);

const CharVisitPage: React.FC<Props> = ({ charId, onBack, onOpenPlayer }) => {
  const { characters, updateCharacter, userProfile, apiConfig, addToast } = useOS();
  const { playSong, current, playing, togglePlay, nextSong, prevSong } = useMusic();
  const char = useMemo(() => characters.find(c => c.id === charId), [characters, charId]);
  const charDateKey = useLocalDateKey(resolveCharTimeZone(char));
  const short = (char?.name || '').split(/[·・\s]/)[0] || 'ta';
  const profile = char?.musicProfile;
  const initialized = !!(char && CharMusicPersona.isInitialized(char));

  const [initializing, setInitializing] = useState(false);
  const [openList, setOpenList] = useState<string | null>('main');
  const [showAllMain, setShowAllMain] = useState(false);
  const [showAllLog, setShowAllLog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick(t => t + 1);
    for (const ev of [PICKS_EVENT, MUSIC_CTRL_LOG_EVENT, MUSIC_STATS_EVENT, 'sully:music-playlists-changed']) window.addEventListener(ev, h);
    return () => { for (const ev of [PICKS_EVENT, MUSIC_CTRL_LOG_EVENT, MUSIC_STATS_EVENT, 'sully:music-playlists-changed']) window.removeEventListener(ev, h); };
  }, []);

  // 此刻在听（按他今天的日程算，零网络）
  useEffect(() => {
    if (!char || !initialized || !char.musicProfile) return;
    let cancelled = false;
    (async () => {
      try {
        const schedule = await getDailyScheduleForChar(char);
        if (cancelled) return;
        const cur = computeCurrentListening(char, schedule);
        const prev = char.musicProfile!.currentListening;
        if (prev?.songId !== cur?.songId || prev?.startedAt !== cur?.startedAt) {
          updateCharacter(char.id, { musicProfile: { ...char.musicProfile!, playlists: (char.musicProfile!.playlists || []).filter(p => p.songs.length > 0), currentListening: cur || undefined, updatedAt: Date.now() } });
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [char?.id, initialized, charDateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 当初 AI 生成、一首都没有的概念歌单：清掉（他以后收歌会自己建）
  useEffect(() => {
    if (!char || !profile?.playlists?.length) return;
    const kept = profile.playlists.filter(p => p.songs.length > 0);
    if (kept.length !== profile.playlists.length) updateCharacter(char.id, { musicProfile: { ...profile, playlists: kept, updatedAt: Date.now() } });
  }, [char?.id, profile?.playlists?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const mainIds = char ? getPickPlaylistIds(char) : [];
  const userLists = useMemo(() => getUserPlaylistsFull(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const mainLists = userLists.filter(p => mainIds.includes(p.id));
  const mainSongs = useMemo(() => {
    const seen = new Set<string>(); const out: PoolSong[] = [];
    for (const p of mainLists) for (const s of p.songs) { const k = `${s.name}|${s.artists}`; if (!seen.has(k)) { seen.add(k); out.push(s); } }
    return out;
  }, [mainLists.map(p => `${p.id}:${p.songs.length}`).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const ownLists: CharPlaylist[] = (profile?.playlists || []).filter(p => p.songs.length > 0);

  const sm = useMemo(() => summarize(charId), [charId, tick]);
  const picks = useMemo(() => getPickLog(charId), [charId, tick]);
  const ctrls = useMemo(() => getCtrlLog(charId).filter(c => c.action === 'play' && c.song), [charId, tick]);
  const timeline = useMemo(() => [
    ...picks.map(p => ({ at: p.at, name: p.name, artists: p.artists, albumPic: p.albumPic, song: p.song as PoolSong | undefined, kind: 'pick' as const, played: !!p.played, line: p.line })),
    ...ctrls.map(c => ({ at: c.at, name: c.name || '', artists: c.artists || '', albumPic: c.albumPic, song: c.song as PoolSong | undefined, kind: 'ctrl' as const, played: true, line: undefined as string | undefined })),
  ].sort((a, b) => b.at - a.at), [picks, ctrls]);

  const playQueue = (songs: PoolSong[], start = 0, shuffle = false) => {
    if (!songs.length) return;
    let q = songs.map(s => ({ ...s }) as Song);
    if (shuffle) { q = q.slice(); for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; } start = 0; }
    playSong(q[start], { replaceQueue: q, startIdx: start });
    onOpenPlayer();
    trackEvent('播放角色歌单里的一首歌');
  };

  const doInitialize = useCallback(async (again = false) => {
    if (!char || initializing) return;
    if (again && !window.confirm(`重新生成 ${char.name} 的音乐简介和曲风？（你给他攒的歌单不受影响）`)) return;
    setInitializing(true);
    try {
      const fresh = await CharMusicPersona.initialize(char, userProfile, apiConfig);
      // 重新生成只换简介 / 曲风 / 艺人；他自己收的歌单留着
      const keepLists = (char.musicProfile?.playlists || []).filter(p => p.songs.length > 0);
      updateCharacter(char.id, { musicProfile: { ...fresh, playlists: again ? keepLists : fresh.playlists.filter(p => p.songs.length > 0) } });
      addToast(again ? '已重新生成' : `${char.name} 的音乐主页开好了`, 'success');
      trackEvent(again ? '重新生成角色的音乐人格' : '生成角色的音乐人格');
    } catch (e: any) { addToast(`生成失败：${e.message || '未知错误'}`, 'error'); }
    finally { setInitializing(false); }
  }, [char, initializing, userProfile, apiConfig, updateCharacter, addToast]);

  const removeOwnList = (pl: CharPlaylist) => {
    if (!char || !profile || !window.confirm(`删掉${short}的歌单《${pl.title}》？`)) return;
    updateCharacter(char.id, { musicProfile: { ...profile, playlists: profile.playlists.filter(p => p.id !== pl.id), updatedAt: Date.now() } });
  };

  if (!char) return (
    <div className="flex flex-col h-full" style={{ background: C.bg }}>
      <MizuHeader title="音乐主页" onBack={onBack} />
      <div className="flex-1 flex items-center justify-center text-sm" style={{ color: C.muted }}>找不到这个角色。</div>
    </div>
  );

  const avatarIsImg = !!char.avatar && (char.avatar.startsWith('data:') || char.avatar.startsWith('http') || isBlobRef(char.avatar));
  const cl = profile?.currentListening;
  const isCur = (s: { name: string; artists: string }) => !!current && current.name === s.name && current.artists === s.artists;
  const mainShown = showAllMain ? mainSongs : mainSongs.slice(0, 12);
  const logShown = showAllLog ? timeline : timeline.slice(0, 8);

  return (
    <div className="flex flex-col h-full relative" style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 45%, ${C.bgDeep} 100%)` }}>
      <BokehBg />
      <MizuHeader title={`${short}的音乐`} onBack={onBack} />

      <div className="flex-1 overflow-y-auto relative z-10 shizuku-scrollbar pb-24">
        {/* 他 */}
        <div className="mx-4 mt-2 rounded-3xl p-4 shizuku-glass-strong" style={{ boxShadow: `0 10px 36px ${C.glow}20` }}>
          <div className="flex items-center gap-3.5">
            <div className="relative shrink-0">
              {avatarIsImg ? <TokenImg value={char.avatar!} alt="" className="w-[72px] h-[72px] rounded-full object-cover" style={{ border: `2.5px solid white`, boxShadow: `0 4px 18px ${C.glow}50` }} />
                : <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center text-2xl text-white" style={{ background: `linear-gradient(135deg, ${C.lavender}, ${C.primary})` }}>{char.avatar || short.slice(0, 1)}</div>}
              {cl && <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full flex items-center justify-center bg-white text-[11px]" style={{ boxShadow: `0 2px 8px ${C.glow}60`, color: C.primary }}>♪</div>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[17px] font-semibold truncate" style={{ color: C.text, fontFamily: `'Noto Serif', serif` }}>{char.name}</div>
              {profile?.bio && <div className="text-[11px] mt-0.5 leading-snug line-clamp-2" style={{ color: C.muted }}>{profile.bio}</div>}
              {!!profile?.genreTags?.length && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {profile.genreTags.slice(0, 4).map(t => <span key={t} className="text-[9.5px] px-1.5 py-0.5 rounded-full" style={{ background: `${C.accent}22`, color: C.primary }}>{t}</span>)}
                </div>
              )}
            </div>
          </div>

          {cl && (
            <div className="mt-3 flex items-center gap-2.5 rounded-2xl px-2.5 py-2" style={{ background: 'rgba(255,255,255,0.55)' }}>
              {cl.albumPic ? <TokenImg value={cl.albumPic} alt="" className="w-9 h-9 rounded-lg object-cover" referrerPolicy="no-referrer" /> : <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white" style={{ background: `linear-gradient(135deg, ${C.accent}, ${C.glow})` }}><MusicNote size={16} weight="bold" /></div>}
              <div className="flex-1 min-w-0">
                <div className="text-[9.5px] tracking-widest" style={{ color: C.faint }}>他此刻在听</div>
                <div className="text-[12px] truncate" style={{ color: C.text }}>{cl.songName}<span className="text-[10px] ml-1.5" style={{ color: C.muted }}>{cl.artists}</span></div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 mt-3 text-center">
            {[[fmtDur(sm.togetherSec), '和你一起听'], [`${picks.length}`, '推给你'], [`${ctrls.length}`, '直接帮你放']].map(([v, k]) => (
              <div key={k}><div className="text-[14px] font-semibold" style={{ color: C.primary, fontFamily: `'Noto Serif', serif` }}>{v}</div><div className="text-[9.5px] mt-0.5" style={{ color: C.muted }}>{k}</div></div>
            ))}
          </div>
        </div>

        {!initialized && (
          <div className="mx-4 mt-4 rounded-2xl p-4 shizuku-glass text-center">
            <div className="text-[11px] mb-3" style={{ color: C.muted }}>还没有 {short} 的音乐简介。生成一次：曲风、喜欢的歌手、一句自我介绍。</div>
            <button onClick={() => doInitialize(false)} disabled={initializing} className="w-full py-2.5 rounded-xl text-xs text-white disabled:opacity-60"
              style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})` }}>{initializing ? '生成中…' : '生成音乐简介'}</button>
          </div>
        )}

        {/* 他的歌单：你给他攒的 */}
        <Section title="他的歌单" right={<span className="text-[10px]" style={{ color: C.faint }}>{mainSongs.length + ownLists.reduce((a, p) => a + p.songs.length, 0)} 首</span>}>
          {mainLists.length ? (
            <div className="rounded-3xl shizuku-glass overflow-hidden">
              <div className="flex items-center gap-3 p-3">
                <Mosaic songs={mainSongs} size={68} />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold truncate" style={{ color: C.text }}>{mainLists.map(p => p.name).join(' · ')}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: C.muted }}>你给他攒的 · {mainSongs.length} 首</div>
                  <div className="text-[9.5px] mt-0.5" style={{ color: C.faint }}>他推歌、帮你放歌都从这里挑</div>
                </div>
              </div>
              <div className="flex gap-2 px-3 pb-3">
                <button onClick={() => playQueue(mainSongs)} className="flex-1 py-2 rounded-xl text-[11.5px] text-white flex items-center justify-center gap-1.5 active:scale-[0.98]" style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})` }}><Play size={13} weight="fill" />播放全部</button>
                <button onClick={() => playQueue(mainSongs, 0, true)} className="flex-1 py-2 rounded-xl text-[11.5px] flex items-center justify-center gap-1.5 active:scale-[0.98]" style={{ background: 'rgba(255,255,255,0.6)', color: C.primary }}><Shuffle size={13} weight="bold" />随机</button>
                <button onClick={() => setOpenList(o => o === 'main' ? null : 'main')} className="px-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.6)', color: C.muted }}>{openList === 'main' ? <CaretUp size={14} /> : <CaretDown size={14} />}</button>
              </div>
              {openList === 'main' && (
                <div className="px-2 pb-2 border-t" style={{ borderColor: `${C.faint}40` }}>
                  {mainShown.map((s, i) => <SongLine key={`${s.id}-${i}`} s={s} i={i} active={isCur(s)} onPlay={() => playQueue(mainSongs, i)} />)}
                  {mainSongs.length > 12 && <button onClick={() => setShowAllMain(v => !v)} className="w-full py-1.5 text-[10.5px]" style={{ color: C.primary }}>{showAllMain ? '收起' : `全部 ${mainSongs.length} 首`}</button>}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl shizuku-glass p-3 text-[11px]" style={{ color: C.muted }}>
              还没给他攒歌单。在「我的」里建一个名字带「{short}」或「N.C」的歌单，或者在下面设置里选一个。
            </div>
          )}

          {ownLists.map(pl => (
            <div key={pl.id} className="rounded-2xl shizuku-glass overflow-hidden mt-2">
              <button onClick={() => setOpenList(o => o === pl.id ? null : pl.id)} className="w-full flex items-center gap-3 p-2.5 text-left">
                <Mosaic songs={pl.songs} size={46} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium truncate" style={{ color: C.text }}>{pl.title}</div>
                  <div className="text-[10px] truncate" style={{ color: C.muted }}>他自己收的 · {pl.songs.length} 首{pl.description ? ` · ${pl.description}` : ''}</div>
                </div>
                {openList === pl.id ? <CaretUp size={13} color={C.muted} /> : <CaretDown size={13} color={C.muted} />}
              </button>
              {openList === pl.id && (
                <div className="px-2 pb-2 border-t" style={{ borderColor: `${C.faint}40` }}>
                  {pl.songs.map((s, i) => <SongLine key={`${s.id}-${i}`} s={s as PoolSong} i={i} active={isCur(s)} onPlay={() => playQueue(pl.songs as PoolSong[], i)} />)}
                  <button onClick={() => removeOwnList(pl)} className="mt-1 ml-1 text-[10px] flex items-center gap-1" style={{ color: C.faint }}><Trash size={11} />删掉这个歌单</button>
                </div>
              )}
            </div>
          ))}
        </Section>

        {/* 他推给你 / 帮你放的 */}
        <Section title="他推给你的 · 帮你放的">
          {timeline.length ? (
            <div className="rounded-2xl shizuku-glass p-1.5">
              {logShown.map((l, i) => (
                <button key={`${l.at}-${i}`} onClick={() => l.song && playInvitedSong(charId, l.song)} className="w-full flex items-center gap-2.5 px-1.5 py-1.5 rounded-xl text-left active:bg-white/50">
                  {l.albumPic ? <TokenImg value={l.albumPic} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" referrerPolicy="no-referrer" />
                    : <div className="w-9 h-9 rounded-lg shrink-0" style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.faint})` }} />}
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] truncate" style={{ color: C.text }}>{l.name}<span className="text-[10px] ml-1.5" style={{ color: C.muted }}>{l.artists}</span></div>
                    <div className="text-[10px] truncate" style={{ color: C.muted }}>{l.line ? `「${l.line}」` : l.kind === 'ctrl' ? '他直接帮你放的' : ''}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[9.5px]" style={{ color: C.faint }}>{ago(l.at)}</div>
                    <div className="text-[9.5px]" style={{ color: l.kind === 'ctrl' ? C.primary : l.played ? C.primary : C.faint }}>{l.kind === 'ctrl' ? '▶ 他放的' : l.played ? '听了' : '没点开'}</div>
                  </div>
                </button>
              ))}
              {timeline.length > 8 && <button onClick={() => setShowAllLog(v => !v)} className="w-full py-1 text-[10.5px]" style={{ color: C.primary }}>{showAllLog ? '收起' : `全部 ${timeline.length} 条`}</button>}
            </div>
          ) : <div className="text-[11px] px-1" style={{ color: C.faint }}>{short}还没推过歌，也没帮你放过。聊到歌的时候，或者你叫他放一首。</div>}
        </Section>

        {(profile?.reviews?.length || 0) > 0 && (
          <Section title="写过的话">
            <div className="space-y-2">
              {profile!.reviews!.slice(0, 6).map(rv => (
                <div key={rv.id} className="rounded-2xl shizuku-glass p-3">
                  <div className="text-[10px] mb-1" style={{ color: C.muted }}>对《{rv.targetTitle}》</div>
                  <div className="text-[12px] leading-relaxed" style={{ color: C.text, fontFamily: `'Noto Serif', serif` }}>{rv.content}</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 设置 */}
        <div className="mx-4 mt-6">
          <button onClick={() => setShowSettings(v => !v)} className="w-full text-[10.5px] flex items-center justify-center gap-1" style={{ color: C.faint }}>
            <Sparkle size={7} color={C.sakura} delay={0} />{showSettings ? '收起设置' : '设置'}
          </button>
          {showSettings && (
            <div className="mt-2 rounded-2xl shizuku-glass p-3 space-y-3">
              <div>
                <div className="text-[10.5px] mb-1.5" style={{ color: C.muted }}>哪几个歌单算他的（推歌、帮你放歌从这里挑）</div>
                <div className="flex flex-wrap gap-1.5">
                  {listUserPlaylists().map(p => {
                    const on = mainIds.includes(p.id);
                    return <button key={p.id} onClick={() => { setPickPlaylistIds(char.id, on ? mainIds.filter(x => x !== p.id) : [...mainIds, p.id]); setTick(t => t + 1); }}
                      className="text-[10.5px] px-2 py-1 rounded-full" style={on ? { background: C.primary, color: 'white' } : { background: 'rgba(255,255,255,0.6)', color: C.muted }}>{p.name} · {p.count}</button>;
                  })}
                </div>
              </div>
              {initialized && (
                <label className="flex items-center gap-2 text-[10.5px]" style={{ color: C.muted }}>
                  <input type="checkbox" checked={profile?.canReadUserMusic ?? true} className="w-3 h-3"
                    onChange={e => profile && updateCharacter(char.id, { musicProfile: { ...profile, canReadUserMusic: e.target.checked, updatedAt: Date.now() } })} />
                  允许{short}看你在网易云听什么、建了哪些歌单
                </label>
              )}
              {initialized && <button onClick={() => doInitialize(true)} disabled={initializing} className="text-[10.5px] px-3 py-1 rounded-full disabled:opacity-50" style={{ color: C.primary, background: `${C.sakura}20` }}>{initializing ? '生成中…' : '重新生成简介和曲风'}</button>}
            </div>
          )}
        </div>
      </div>

      {current && (
        <MiniPlayer name={current.name} artists={current.artists} albumPic={current.albumPic} playing={playing}
          onTap={onOpenPlayer} onPrev={prevSong} onToggle={togglePlay} onNext={nextSong} />
      )}
    </div>
  );
};

export default CharVisitPage;
