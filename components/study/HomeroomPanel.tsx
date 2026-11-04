/** 自习室书架页顶部：班主任模式开关、今天学了多少、和班主任一起专注计时 */
import React, { useEffect, useState } from 'react';
import type { CharacterProfile, APIConfig } from '../../types';
import {
  isHomeroomOn, setHomeroomOn, todayStudySummary, studyStreak, loadFocus, saveFocus, focusLines, focusReply, midTimes, logStudy,
  STUDY_LOG_EVENT, type FocusState, type FocusChat,
} from '../../utils/studyHomeroom';
import TokenImg from '../os/TokenImg';

const fmt = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

const HomeroomPanel: React.FC<{ char: CharacterProfile | null; api: APIConfig; userName: string; onToggle?: (on: boolean) => void }> = ({ char, api, userName, onToggle }) => {
  const [on, setOn] = useState(isHomeroomOn());
  const [focus, setFocus] = useState<FocusState | null>(loadFocus());
  const [now, setNow] = useState(Date.now());
  const [minutes, setMinutes] = useState(25);
  const [label, setLabel] = useState('');
  const [bubble, setBubble] = useState('');
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState('');
  const [replying, setReplying] = useState(false);
  const [, bump] = useState(0);
  const chatEnd = React.useRef<HTMLDivElement>(null);

  const pushChat = (f: FocusState, c: FocusChat): FocusState => {
    const next = { ...f, chat: [...(f.chat || []), c].slice(-40) };
    saveFocus(next); setFocus(next);
    return next;
  };
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }); }, [focus?.chat?.length]);

  // 中途的话：到点就冒出来一句（离开 App 回来也补上，按时间顺序）
  useEffect(() => {
    if (!focus?.lines?.mids?.length) return;
    const times = midTimes(focus.minutes);
    const passed = now - focus.startAt;
    const shown = (focus.chat || []).filter(c => c.role === 'him' && (c as any).mid !== undefined).length;
    const due = times.filter(t => t <= passed).length;
    if (due > shown && focus.lines.mids[shown]) {
      const c = { role: 'him', text: focus.lines.mids[shown], at: focus.startAt + times[shown], mid: shown } as FocusChat;
      pushChat(focus, c);
      try { navigator.vibrate?.(60); } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, focus]);

  useEffect(() => {
    const h = () => bump(x => x + 1);
    window.addEventListener(STUDY_LOG_EVENT, h);
    return () => window.removeEventListener(STUDY_LOG_EVENT, h);
  }, []);

  useEffect(() => {
    if (!focus) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [focus]);

  const left = focus ? focus.startAt + focus.minutes * 60000 - now : 0;
  useEffect(() => {
    if (!focus || left > 0) return;
    if (char) logStudy({ charId: char.id, kind: 'focus', title: focus.label, minutes: focus.minutes });
    setBubble(focus.lines?.end || '时间到了。');
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignore */ }
    saveFocus(null); setFocus(null);
  }, [left, focus, char]);

  const start = async () => {
    if (!char) return;
    setBusy(true);
    let lines: FocusState['lines'];
    try { lines = await focusLines(char, api, userName, minutes, label.trim()); } catch { lines = undefined; }
    const f: FocusState = { startAt: Date.now(), minutes, label: label.trim(), lines, chat: lines?.start ? [{ role: 'him', text: lines.start, at: Date.now() }] : [] };
    saveFocus(f); setFocus(f); setNow(Date.now()); setBubble('');
    setBusy(false);
  };
  const send = async () => {
    if (!focus || !char || !say.trim() || replying) return;
    const text = say.trim(); setSay('');
    let f = pushChat(focus, { role: 'me', text, at: Date.now() });
    setReplying(true);
    try { const r = await focusReply(char, api, userName, f, text); f = pushChat(loadFocus() || f, { role: 'him', text: r, at: Date.now() }); }
    catch { pushChat(loadFocus() || f, { role: 'him', text: '（他没听清，再说一遍？）', at: Date.now() }); }
    setReplying(false);
  };
  const quit = () => {
    if (!focus) return;
    const done = Math.floor((Date.now() - focus.startAt) / 60000);
    if (char && done >= 5) logStudy({ charId: char.id, kind: 'focus', title: `${focus.label || ''}（提前结束）`.trim(), minutes: done });
    setBubble(focus.lines?.quit || '');
    saveFocus(null); setFocus(null);
  };

  const sum = todayStudySummary(char?.id);
  const streak = studyStreak();

  return (
    <div className="mb-6 rounded-2xl bg-white border border-[#ece6da] p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-slate-500 tracking-widest">班主任模式</div>
        <label className="flex items-center gap-2 text-[11px] text-slate-500">
          {on ? '开' : '关'}
          <input type="checkbox" checked={on} onChange={e => { setOn(e.target.checked); setHomeroomOn(e.target.checked); onToggle?.(e.target.checked); }} />
        </label>
      </div>
      <div className="text-[10.5px] text-slate-400 mt-1 leading-relaxed">
        {on ? `讲课、答疑、出题、批改交给「老师」（自习室 API，没配就用主 API，不带人设）；${char?.name || '选中的角色'}当班主任：开课打招呼、批改后点评、陪你专注，你学了什么他在聊天里也知道。`
            : '关掉后和原版一样：选中的角色亲自讲课。'}
      </div>

      <div className="flex gap-3 mt-3 text-center">
        {[['今天专注', `${sum.focus} 分`], ['今天上课', `${sum.lessons} 节`], ['今天测验', `${sum.quizzes} 次`], ['连续', `${streak} 天`]].map(([k, v]) => (
          <div key={k} className="flex-1 rounded-xl bg-[#faf7f1] py-2">
            <div className="text-sm font-bold text-slate-700">{v}</div>
            <div className="text-[9.5px] text-slate-400">{k}</div>
          </div>
        ))}
      </div>

      {char && (
        <div className="mt-3 pt-3 border-t border-[#f0ebe1]">
          {bubble && (
            <div className="flex items-start gap-2 mb-2.5">
              <TokenImg value={char.avatar} className="w-7 h-7 rounded-full object-cover shrink-0" />
              <div className="text-[12px] text-slate-700 bg-[#f5f1e8] rounded-2xl rounded-tl-sm px-3 py-2 leading-relaxed flex-1">{bubble}</div>
              <button onClick={() => setBubble('')} className="text-slate-300 text-xs px-1">×</button>
            </div>
          )}
          {focus ? (
            <div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-2xl font-mono font-bold text-emerald-700 tracking-wider">{fmt(left)}</div>
                  <div className="text-[10px] text-slate-400">{focus.label || '专注中'} · {char.name}陪着你</div>
                </div>
                <button onClick={quit} className="px-3 py-2 rounded-xl text-xs text-slate-500 bg-slate-100">提前结束</button>
              </div>
              <div className="mt-2.5 max-h-56 overflow-y-auto space-y-1.5 pr-1">
                {(focus.chat || []).map((c, i) => c.role === 'him' ? (
                  <div key={i} className="flex items-start gap-2">
                    <TokenImg value={char.avatar} className="w-6 h-6 rounded-full object-cover shrink-0" />
                    <div className="text-[12px] text-slate-700 bg-[#f5f1e8] rounded-2xl rounded-tl-sm px-3 py-1.5 leading-relaxed">{c.text}</div>
                  </div>
                ) : (
                  <div key={i} className="flex justify-end">
                    <div className="text-[12px] text-white bg-emerald-600 rounded-2xl rounded-tr-sm px-3 py-1.5 leading-relaxed max-w-[80%]">{c.text}</div>
                  </div>
                ))}
                {replying && <div className="text-[10.5px] text-slate-400 pl-8">…</div>}
                <div ref={chatEnd} />
              </div>
              <div className="flex gap-2 mt-2">
                <input value={say} onChange={e => setSay(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }}
                  placeholder="小声跟他说一句（吐槽、走神、卡题）" className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs outline-none" />
                <button onClick={send} disabled={!say.trim() || replying} className="px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white disabled:opacity-40">说</button>
              </div>
              <div className="text-[9.5px] text-slate-300 mt-1">他每隔一阵子会自己冒一句（已经写好了，不额外花 token）；你说话他才会现回。</div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-1.5">
                {[25, 45, 60, 90].map(m => (
                  <button key={m} onClick={() => setMinutes(m)} className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold ${minutes === m ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{m} 分</button>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder="这次学什么（可不填）" className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs outline-none" />
                <button onClick={start} disabled={busy} className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white disabled:opacity-50">{busy ? '…' : `和${char.name}一起专注`}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default HomeroomPanel;
