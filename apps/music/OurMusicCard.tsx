/**
 * 音乐首页 ·「我们的歌」（个人二改）
 * 这周 / 这个月听了多久、循环最多的那首、听得最多的歌和歌手；
 * 和他一起听了多久、一起听最多的；他拉你一起听过的歌（带他当时那句话，点一下就放）。
 */
import React, { useEffect, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { C } from './MusicUI';
import TokenImg from '../../components/os/TokenImg';
import { summarize, fmtDur, MUSIC_STATS_EVENT } from '../../utils/music/musicStats';
import { getPickLog, playInvitedSong, PICKS_EVENT } from '../../utils/charSongPicks';
import { getCtrlLog, ctrlVerb, MUSIC_CTRL_LOG_EVENT } from '../../utils/charMusicControl';

const ago = (t: number) => { const d = Math.floor((Date.now() - t) / 86400000); return d <= 0 ? '今天' : d === 1 ? '昨天' : d < 7 ? `${d} 天前` : `${Math.floor(d / 7)} 周前`; };

/** 他推给你的歌（音乐首页和他的主页共用） */
export const PickLogList: React.FC<{ charId: string; charName: string; limit?: number; compact?: boolean }> = ({ charId, charName, limit = 6, compact }) => {
  const [log, setLog] = useState(() => getPickLog(charId));
  const [all, setAll] = useState(false);
  useEffect(() => { const h = () => setLog(getPickLog(charId)); window.addEventListener(PICKS_EVENT, h); return () => window.removeEventListener(PICKS_EVENT, h); }, [charId]);
  if (!log.length) return compact ? null : <div className="text-[11px]" style={{ color: C.faint }}>{charName}还没拉你一起听过歌。聊到歌的时候他可能会推一首。</div>;
  const shown = all ? log : log.slice(0, limit);
  return (
    <div className="space-y-1.5">
      {shown.map((l, i) => (
        <button key={`${l.at}_${i}`} onClick={() => l.song && playInvitedSong(charId, l.song)} className="w-full flex items-center gap-2.5 text-left">
          <div className="w-9 h-9 rounded-lg shrink-0 overflow-hidden" style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.faint})` }}>
            {l.albumPic && <img src={l.albumPic} className="w-full h-full object-cover" referrerPolicy="no-referrer" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] truncate" style={{ color: C.text }}>{l.name}<span className="text-[10px] ml-1.5" style={{ color: C.muted }}>{l.artists}</span></div>
            {l.line && <div className="text-[10.5px] truncate" style={{ color: C.muted }}>「{l.line}」</div>}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[9.5px]" style={{ color: C.faint }}>{ago(l.at)}</div>
            <div className="text-[9.5px]" style={{ color: l.played ? C.primary : C.faint }}>{l.played ? '听了' : '没点开'}</div>
          </div>
        </button>
      ))}
      {log.length > limit && <button onClick={() => setAll(v => !v)} className="text-[10.5px]" style={{ color: C.primary }}>{all ? '收起' : `全部 ${log.length} 首`}</button>}
    </div>
  );
};

const OurMusicCard: React.FC = () => {
  const { characters } = useOS() as any;
  const him = characters.find((c: any) => /诺亚|Noah/i.test(c.name)) || characters.find((c: any) => getPickLog(c.id).length) || characters[0];
  const [sm, setSm] = useState(() => summarize(him?.id));
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    const h = () => { setSm(summarize(him?.id)); setTick(t => t + 1); };
    for (const ev of [MUSIC_STATS_EVENT, PICKS_EVENT, MUSIC_CTRL_LOG_EVENT]) window.addEventListener(ev, h);
    return () => { for (const ev of [MUSIC_STATS_EVENT, PICKS_EVENT, MUSIC_CTRL_LOG_EVENT]) window.removeEventListener(ev, h); };
  }, [him?.id]);
  if (!him) return null;
  const short = him.name.split(/[·・\s]/)[0];
  const picks = getPickLog(him.id);
  const lastCtrl = getCtrlLog(him.id)[0];
  const lastPick = picks[0];
  const latest = lastCtrl && (!lastPick || lastCtrl.at > lastPick.at)
    ? { text: `${ctrlVerb(lastCtrl.action)}${lastCtrl.name ? `《${lastCtrl.name}》` : ''}`, at: lastCtrl.at, song: lastCtrl.song }
    : lastPick ? { text: `推给你《${lastPick.name}》`, at: lastPick.at, song: lastPick.song } : null;
  const cl = him.musicProfile?.currentListening;
  const maxTop = Math.max(1, ...sm.top.map(x => x.plays));
  const goVisit = () => window.dispatchEvent(new CustomEvent('sully:music-visit-char', { detail: him.id }));
  return (
    <div className="rounded-2xl p-3.5 shizuku-glass">
      {/* 他：头像、此刻在听、刚才做了什么 */}
      <button onClick={goVisit} className="w-full flex items-center gap-3 text-left">
        <TokenImg value={him.avatar} className="w-11 h-11 rounded-full object-cover shrink-0" style={{ border: '2px solid white' }} />
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold" style={{ color: C.text }}>{short}</div>
          <div className="text-[10.5px] truncate" style={{ color: C.muted }}>{cl ? `♪ 在听《${cl.songName}》— ${cl.artists}` : '这会儿没在听歌'}</div>
          {latest && <div className="text-[10px] truncate" style={{ color: C.primary }}>{ago(latest.at)}{latest.text}</div>}
        </div>
        <span className="text-[10.5px] shrink-0" style={{ color: C.primary }}>他的歌单 ›</span>
      </button>
      {latest?.song && <button onClick={() => playInvitedSong(him.id, latest.song as any)} className="mt-2 w-full text-[10.5px] py-1.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.5)', color: C.primary }}>▶ 放他刚才那首</button>}
      {(sm.totalSec >= 60 || picks.length > 0) && (
      <>
      <div className="mt-3 pt-2.5 border-t flex items-center justify-between" style={{ borderColor: 'rgba(255,255,255,0.6)' }}>
        <div className="text-[10px] tracking-wider" style={{ color: C.muted }}>我们的歌</div>
        <button onClick={() => setOpen(v => !v)} className="text-[10px]" style={{ color: C.primary }}>{open ? '收起' : '展开'}</button>
      </div>
      <div className="flex mt-2 text-center">
        {[['这周', fmtDur(sm.weekSec)], ['这个月', fmtDur(sm.monthSec)], [`和${short}`, fmtDur(sm.togetherSec)]].map(([k, v]) => (
          <div key={k} className="flex-1"><div className="text-[13px] font-semibold" style={{ color: C.text }}>{v}</div><div className="text-[9.5px]" style={{ color: C.faint }}>{k}</div></div>
        ))}
      </div>
      {sm.looping && (
        <div className="mt-2.5 text-[11px] px-2.5 py-1.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.45)', color: C.text }}>
          🔁 这周《{sm.looping.song.name}》放了 {sm.looping.times} 遍
        </div>
      )}
      {open && (
        <div className="mt-3 space-y-3">
          {sm.top.length > 0 && (
            <div>
              <div className="text-[10px] mb-1.5" style={{ color: C.muted }}>听得最多</div>
              <div className="space-y-1">
                {sm.top.slice(0, 5).map((x, i) => (
                  <div key={x.key} className="flex items-center gap-2 text-[11.5px]">
                    <span className="w-3 text-[10px]" style={{ color: C.faint }}>{i + 1}</span>
                    <span className="w-28 truncate" style={{ color: C.text }}>{x.name}</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.5)' }}><div className="h-full" style={{ width: `${(x.plays / maxTop) * 100}%`, background: C.primary }} /></div>
                    <span className="text-[10px] w-9 text-right" style={{ color: C.muted }}>{x.plays} 遍</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {sm.topArtists.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[10px]" style={{ color: C.muted }}>常听</span>
              {sm.topArtists.map(a => <span key={a.name} className="text-[10.5px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.5)', color: C.text }}>{a.name}</span>)}
            </div>
          )}
          {sm.togetherTop.length > 0 && (
            <div>
              <div className="text-[10px] mb-1" style={{ color: C.muted }}>和{him.name}一起听得最多</div>
              <div className="text-[11.5px]" style={{ color: C.text }}>{sm.togetherTop.slice(0, 3).map(x => `《${x.name}》`).join(' ')}</div>
            </div>
          )}
          <div>
            <div className="flex items-center gap-1.5 text-[10px] mb-1.5" style={{ color: C.muted }}>
              <TokenImg value={him.avatar} className="w-4 h-4 rounded-full object-cover" /><span className="flex-1">{him.name}拉你一起听的</span>
              <button onClick={() => window.dispatchEvent(new CustomEvent('sully:music-visit-char', { detail: him.id }))} style={{ color: C.primary }}>去他的主页 ›</button>
            </div>
            <PickLogList charId={him.id} charName={him.name} />
          </div>
          <div className="text-[9px]" style={{ color: C.faint }}>只算在这里放的歌（听满 30 秒算一遍）。{him.name}知道你最近在循环什么，偶尔会提一句。</div>
        </div>
      )}
      </>
      )}
    </div>
  );
};

export default OurMusicCard;
