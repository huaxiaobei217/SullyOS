/** 音乐首页 · 最近听过（本机 + 手机 LX 经 MCP 的记录，带时间） */
import React, { useEffect, useState } from 'react';
import { C } from './MusicUI';
import { getRecentPlays, agoText, playerText, isPlaysInjectOn, setPlaysInjectOn, PLAYS_CHANGED_EVENT, type Play } from '../../utils/music/listenHistory';

const RecentPlaysCard: React.FC = () => {
  const [plays, setPlays] = useState<Play[]>([]);
  const [open, setOpen] = useState(false);
  const [inject, setInject] = useState(isPlaysInjectOn());
  const load = (force = false) => getRecentPlays(force).then(setPlays).catch(() => {});
  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener(PLAYS_CHANGED_EVENT, h);
    return () => window.removeEventListener(PLAYS_CHANGED_EVENT, h);
  }, []);
  const shown = open ? plays : plays.slice(0, 3);
  return (
    <div className="rounded-2xl p-3.5 shizuku-glass">
      <div className="flex items-center justify-between">
        <div className="text-[10px] tracking-wider" style={{ color: C.muted }}>最近听过</div>
        <div className="flex items-center gap-2">
          <button onClick={() => load(true)} className="text-[10px]" style={{ color: C.primary }}>刷新</button>
          {plays.length > 3 && <button onClick={() => setOpen(v => !v)} className="text-[10px]" style={{ color: C.primary }}>{open ? '收起' : `全部 ${plays.length}`}</button>}
        </div>
      </div>
      {!plays.length ? (
        <div className="text-[11px] mt-1.5" style={{ color: C.faint }}>还没有记录。在这里放歌，或者手机 LX 经 MacroDroid 同步到 MCP 后会出现在这</div>
      ) : (
        <div className="mt-1.5 space-y-1">
          {shown.map((p, i) => (
            <div key={`${p.at}_${i}`} className="flex items-baseline gap-2 text-[11.5px]">
              <span className="w-16 shrink-0 text-[10px]" style={{ color: C.muted }}>{agoText(p.at)}</span>
              <span className="flex-1 min-w-0 truncate" style={{ color: C.text }}>{p.music}</span>
              <span className="shrink-0 text-[9.5px]" style={{ color: C.faint }}>{playerText(p.player)}</span>
            </div>
          ))}
        </div>
      )}
      <label className="flex items-center justify-between mt-2 pt-2 border-t border-white/40 text-[10.5px]" style={{ color: C.muted }}>
        <span>聊天时让角色看到最近 24 小时的记录</span>
        <input type="checkbox" checked={inject} onChange={e => { setInject(e.target.checked); setPlaysInjectOn(e.target.checked); }} />
      </label>
    </div>
  );
};

export default RecentPlaysCard;
