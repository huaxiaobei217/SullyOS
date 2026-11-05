/**
 * 身体 · 手环数据（个人二改）
 * 截荣耀运动健康的图丢进来 / 手动记几个数 → 最近 14 天一眼看完 → 打开「让他知道」，聊天里他心里有数
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import type { CharacterProfile } from '../types';
import {
  loadBody, BODY_EVENT, upsertBodyDay, deleteBodyDay, isBodyInjectOn, setBodyInjectOn, readHealthShot, fileToDataUrl,
  dateKey, shiftDate, fmtDur, describeDay, noahGlance, sendGlanceToChat, type BodyDay,
} from '../utils/bodyLog';

const C = { bg: '#f3f5f1', card: '#ffffff', ink: '#26302a', muted: '#7d877f', faint: '#b8c1ba', line: '#e2e7e1', sleep: '#5b6fa8', step: '#4f8a63', warm: '#c9774f' };

const useBody = () => {
  const [s, set] = useState(loadBody());
  useEffect(() => { const h = () => set(loadBody()); window.addEventListener(BODY_EVENT, h); return () => window.removeEventListener(BODY_EVENT, h); }, []);
  return s;
};

const weekday = (k: string) => { const [y, m, d] = k.split('-').map(Number); return '日一二三四五六'[new Date(y, m - 1, d).getDay()]; };
const short = (k: string) => { const [, m, d] = k.split('-').map(Number); return `${m}/${d}`; };

/* ───────── 手动记 ───────── */
const Lab: React.FC<{ t: string; children: React.ReactNode }> = ({ t, children }) => <label className="block"><div className="text-[11px] mb-1" style={{ color: C.muted }}>{t}</div>{children}</label>;

const Editor: React.FC<{ initial: BodyDay | null; date: string; onClose: () => void }> = ({ initial, date: d0, onClose }) => {
  const [date, setDate] = useState(d0);
  const i = initial || ({} as BodyDay);
  const [sleepH, setSleepH] = useState(i.sleepMin ? String(Math.floor(i.sleepMin / 60)) : '');
  const [sleepM, setSleepM] = useState(i.sleepMin ? String(i.sleepMin % 60) : '');
  const [deep, setDeep] = useState(i.deepMin ? String(i.deepMin) : '');
  const [bed, setBed] = useState(i.bedtime || '');
  const [wake, setWake] = useState(i.wake || '');
  const [steps, setSteps] = useState(i.steps != null ? String(i.steps) : '');
  const [hr, setHr] = useState(i.restingHr ? String(i.restingHr) : '');
  const [stress, setStress] = useState(i.stress ? String(i.stress) : '');
  const [period, setPeriod] = useState(!!i.period);
  const [feel, setFeel] = useState(i.feel || '');
  const n = (s: string) => { const v = Number(s); return s.trim() && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined; };
  const save = () => {
    const sm = (n(sleepH) || 0) * 60 + (n(sleepM) || 0);
    const all = loadBody();
    const cur = all[date];
    // 手动表单是「这一天的完整状态」：清空的格子就删掉
    const next: any = { ...(cur || {}), date };
    const setOrDel = (k: string, v: any) => { if (v === undefined || v === '') delete next[k]; else next[k] = v; };
    setOrDel('sleepMin', sm || undefined); setOrDel('deepMin', n(deep)); setOrDel('bedtime', bed || undefined); setOrDel('wake', wake || undefined);
    setOrDel('steps', n(steps)); setOrDel('restingHr', n(hr)); setOrDel('stress', n(stress)); setOrDel('feel', feel.trim() || undefined);
    if (period) next.period = true; else delete next.period;
    deleteBodyDay(date);
    upsertBodyDay(date, next);
    onClose();
  };
  const inp = 'w-full rounded-lg px-2.5 py-2 text-sm outline-none border';
  const st = { borderColor: C.line, background: '#fafbf9', color: C.ink } as React.CSSProperties;
  return (
    <div className="absolute inset-0 z-40 flex items-end" style={{ background: 'rgba(0,0,0,0.35)' }} onClick={onClose}>
      <div className="w-full rounded-t-2xl p-4 max-h-[85%] overflow-y-auto" style={{ background: C.card, paddingBottom: 'calc(var(--safe-bottom, 0px) + 1rem)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold" style={{ color: C.ink }}>手动记</div>
          <input type="date" value={date} max={dateKey()} onChange={e => e.target.value && setDate(e.target.value)} className="text-sm rounded-lg px-2 py-1 border" style={st} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Lab t="睡眠（小时 / 分）"><div className="flex gap-1.5"><input inputMode="numeric" className={inp} style={st} value={sleepH} onChange={e => setSleepH(e.target.value)} placeholder="7" /><input inputMode="numeric" className={inp} style={st} value={sleepM} onChange={e => setSleepM(e.target.value)} placeholder="30" /></div></Lab>
          <Lab t="深睡（分钟）"><input inputMode="numeric" className={inp} style={st} value={deep} onChange={e => setDeep(e.target.value)} placeholder="90" /></Lab>
          <Lab t="入睡"><input type="time" className={inp} style={st} value={bed} onChange={e => setBed(e.target.value)} /></Lab>
          <Lab t="醒来"><input type="time" className={inp} style={st} value={wake} onChange={e => setWake(e.target.value)} /></Lab>
          <Lab t="步数"><input inputMode="numeric" className={inp} style={st} value={steps} onChange={e => setSteps(e.target.value)} placeholder="6000" /></Lab>
          <Lab t="静息心率"><input inputMode="numeric" className={inp} style={st} value={hr} onChange={e => setHr(e.target.value)} placeholder="65" /></Lab>
          <Lab t="压力（1-99）"><input inputMode="numeric" className={inp} style={st} value={stress} onChange={e => setStress(e.target.value)} placeholder="30" /></Lab>
          <Lab t="生理期"><button onClick={() => setPeriod(p => !p)} className="w-full rounded-lg py-2 text-sm border" style={period ? { background: '#f6e3dc', borderColor: C.warm, color: C.warm } : st}>{period ? '是' : '不是'}</button></Lab>
        </div>
        <div className="mt-3"><Lab t="一句话（可不填，比如：头疼、加班到很晚）"><input className={inp} style={st} value={feel} maxLength={40} onChange={e => setFeel(e.target.value)} /></Lab></div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm" style={{ background: '#eef1ed', color: C.muted }}>取消</button>
          <button onClick={save} className="flex-[2] py-2.5 rounded-xl text-sm font-medium text-white" style={{ background: C.step }}>保存</button>
        </div>
      </div>
    </div>
  );
};

const BodyApp: React.FC = () => {
  const { closeApp, characters, activeCharacterId, apiConfig, userProfile, addToast } = useOS() as any;
  const all = useBody();
  const [inject, setInject] = useState(isBodyInjectOn());
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState<string | null>(null);
  const [glance, setGlance] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const char: CharacterProfile | undefined = (characters || []).find((c: CharacterProfile) => c.id === activeCharacterId) || characters?.[0];
  const userName = userProfile?.name || '我';
  const today = dateKey();
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => shiftDate(today, -13 + i)), [today]);
  const maxSleep = Math.max(9 * 60, ...days.map(k => all[k]?.sleepMin || 0));
  const maxSteps = Math.max(8000, ...days.map(k => all[k]?.steps || 0));
  const week = days.slice(7).map(k => all[k]).filter(Boolean) as BodyDay[];
  const avg = (xs: (number | undefined)[]) => { const v = xs.filter((x): x is number => !!x); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0; };
  const avgSleep = avg(week.map(d => d.sleepMin));
  const avgSteps = avg(week.map(d => d.steps));
  const t = all[today], y = all[shiftDate(today, -1)];

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 6);
    let ok = 0; const errs: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setBusy(`在读第 ${i + 1}/${list.length} 张截图…`);
      try {
        const url = await fileToDataUrl(list[i]);
        const r = await readHealthShot(url, apiConfig);
        const { date, ...rest } = r;
        const fields = Object.values(rest).filter(v => v !== undefined).length;
        if (!fields) { errs.push(`第 ${i + 1} 张没读出数字`); continue; }
        // 截图没写日期就算今天；只有睡眠的截图按今天（醒来那天）记
        upsertBodyDay(date && date <= today ? date : today, rest);
        ok++;
      } catch (e: any) { errs.push(`第 ${i + 1} 张：${e?.message || '失败'}`); }
    }
    setBusy('');
    if (fileRef.current) fileRef.current.value = '';
    if (ok) addToast?.(`读好了 ${ok} 张${errs.length ? `，${errs.length} 张没读出来` : ''}`, 'success');
    else addToast?.(errs[0] || '没读出来', 'error');
  };

  const doGlance = async () => {
    if (!char) { addToast?.('先选一个角色', 'error'); return; }
    setBusy(`${char.name}在看…`);
    try { setGlance(await noahGlance(char, apiConfig, userName)); }
    catch (e: any) { addToast?.(e?.message || '失败了', 'error'); }
    finally { setBusy(''); }
  };

  const Stat: React.FC<{ label: string; value: string; sub?: string; color: string }> = ({ label, value, sub, color }) => (
    <div className="flex-1 rounded-xl px-3 py-2.5" style={{ background: '#f7f9f6' }}>
      <div className="text-[11px]" style={{ color: C.muted }}>{label}</div>
      <div className="text-lg font-semibold leading-tight mt-0.5" style={{ color: value ? color : C.faint }}>{value || '—'}</div>
      {sub && <div className="text-[10.5px] mt-0.5" style={{ color: C.muted }}>{sub}</div>}
    </div>
  );

  const pd = picked ? all[picked] : null;

  return (
    <div className="h-full w-full flex flex-col relative" style={{ background: C.bg, color: C.ink }}>
      <div className="shrink-0 px-5 pb-3 flex items-center justify-between" style={{ paddingTop: 'calc(var(--chrome-top) + 0.5rem)' }}>
        <button onClick={closeApp} className="text-sm" style={{ color: C.muted }}>‹ 返回</button>
        <div className="font-semibold">身体</div>
        <button onClick={() => { const v = !inject; setInject(v); setBodyInjectOn(v); }} className="text-[11px] px-2.5 py-1 rounded-full border"
          style={inject ? { background: '#e3efe6', borderColor: C.step, color: C.step } : { borderColor: C.line, color: C.muted }}>
          {inject ? `${char?.name || '他'}知道` : '不告诉他'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-3">
        {/* 今天 */}
        <div className="rounded-2xl p-4" style={{ background: C.card }}>
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-sm font-semibold">今天 <span className="font-normal text-[11px]" style={{ color: C.muted }}>{short(today)} 周{weekday(today)}</span></div>
            {t?.period && <span className="text-[10.5px] px-2 py-0.5 rounded-full" style={{ background: '#f6e3dc', color: C.warm }}>生理期</span>}
          </div>
          <div className="flex gap-2">
            <Stat label="昨晚睡眠" value={fmtDur(t?.sleepMin)} sub={t?.bedtime || t?.wake ? `${t?.bedtime || '?'} → ${t?.wake || '?'}` : (t?.deepMin ? `深睡 ${fmtDur(t.deepMin)}` : undefined)} color={C.sleep} />
            <Stat label="步数" value={t?.steps != null ? t.steps.toLocaleString('en-US') : ''} sub={y?.steps != null ? `昨天 ${y.steps.toLocaleString('en-US')}` : undefined} color={C.step} />
            <Stat label="静息心率" value={t?.restingHr ? String(t.restingHr) : ''} sub={t?.stress ? `压力 ${t.stress}` : undefined} color={C.warm} />
          </div>
          {t?.feel && <div className="text-[12px] mt-2" style={{ color: C.muted }}>「{t.feel}」</div>}
          <div className="flex gap-2 mt-3">
            <button onClick={() => fileRef.current?.click()} className="flex-[3] py-2.5 rounded-xl text-sm font-medium text-white" style={{ background: C.step }}>截图识别</button>
            <button onClick={() => setEdit(today)} className="flex-[2] py-2.5 rounded-xl text-sm" style={{ background: '#eef1ed', color: C.ink }}>手动记</button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => onFiles(e.target.files)} />
          <div className="text-[10.5px] mt-2 leading-relaxed" style={{ color: C.muted }}>
            在荣耀运动健康里截「睡眠」「步数」「心率」那几页，一次可以选好几张。睡眠记在醒来那天。图只拿去识别，不存。
          </div>
        </div>

        {/* 他看一眼 */}
        {char && (
          <div className="rounded-2xl p-4" style={{ background: C.card }}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">给{char.name}看一眼</div>
              <button onClick={doGlance} disabled={!!busy} className="text-[12px] px-3 py-1.5 rounded-full" style={{ background: '#e8ecf6', color: C.sleep }}>把手机怼过去</button>
            </div>
            {glance ? (
              <div className="mt-3 space-y-1.5">
                {glance.split(/\n+/).filter(Boolean).map((l, i) => <div key={i} className="text-[13px] leading-relaxed px-3 py-2 rounded-2xl rounded-tl-sm inline-block mr-6" style={{ background: '#f0f2f7' }}>{l}</div>)}
                <div className="flex gap-3 pt-1">
                  <button onClick={async () => { await sendGlanceToChat(char.id, glance); addToast?.('放进聊天了', 'success'); setGlance(''); }} className="text-[12px]" style={{ color: C.step }}>放进聊天</button>
                  <button onClick={() => setGlance('')} className="text-[12px]" style={{ color: C.muted }}>算了</button>
                </div>
              </div>
            ) : <div className="text-[11px] mt-1.5" style={{ color: C.muted }}>他看你这一周的数据，挑最显眼的一件说两句。</div>}
          </div>
        )}

        {/* 14 天 */}
        <div className="rounded-2xl p-4" style={{ background: C.card }}>
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-semibold">最近两周</div>
            <div className="text-[11px]" style={{ color: C.muted }}>{avgSleep ? `近 7 天平均睡 ${fmtDur(avgSleep)}` : ''}{avgSleep && avgSteps ? ' · ' : ''}{avgSteps ? `${avgSteps.toLocaleString('en-US')} 步` : ''}</div>
          </div>
          <div className="mt-3 text-[10.5px]" style={{ color: C.sleep }}>睡眠</div>
          <div className="flex items-end gap-1 h-20 mt-1">
            {days.map(k => { const v = all[k]?.sleepMin || 0; return (
              <button key={k} onClick={() => setPicked(k === picked ? null : k)} className="flex-1 h-full flex items-end">
                <div className="w-full rounded-t" style={{ height: `${v ? Math.max(6, (v / maxSleep) * 100) : 3}%`, background: v ? (v < 360 ? '#a8b3d6' : C.sleep) : C.line, opacity: picked && picked !== k ? 0.45 : 1 }} />
              </button>); })}
          </div>
          <div className="mt-3 text-[10.5px]" style={{ color: C.step }}>步数</div>
          <div className="flex items-end gap-1 h-14 mt-1">
            {days.map(k => { const v = all[k]?.steps || 0; return (
              <button key={k} onClick={() => setPicked(k === picked ? null : k)} className="flex-1 h-full flex items-end">
                <div className="w-full rounded-t" style={{ height: `${v ? Math.max(6, (v / maxSteps) * 100) : 3}%`, background: v ? C.step : C.line, opacity: picked && picked !== k ? 0.45 : 1 }} />
              </button>); })}
          </div>
          <div className="flex gap-1 mt-1">
            {days.map(k => <div key={k} className="flex-1 text-center text-[9px]" style={{ color: k === today ? C.ink : C.faint }}>{k === today ? '今' : weekday(k)}</div>)}
          </div>
          {picked && (
            <div className="mt-3 rounded-xl p-3" style={{ background: '#f7f9f6' }}>
              <div className="flex items-center justify-between">
                <div className="text-[12.5px] font-medium">{short(picked)} 周{weekday(picked)}</div>
                <div className="flex gap-3">
                  <button onClick={() => setEdit(picked)} className="text-[12px]" style={{ color: C.step }}>{pd ? '改' : '补记'}</button>
                  {pd && <button onClick={() => { deleteBodyDay(picked); }} className="text-[12px]" style={{ color: C.muted }}>删掉</button>}
                </div>
              </div>
              <div className="text-[12px] mt-1 leading-relaxed" style={{ color: C.muted }}>{pd ? (describeDay(pd).join('；') || '没有数据') : '这天没有记录'}</div>
            </div>
          )}
        </div>

        <div className="text-[10.5px] leading-relaxed px-1" style={{ color: C.faint }}>
          数据只存在这台手机上，会跟着「二改数据」一起备份。打开右上角「{char?.name || '他'}知道」时，今天和昨天的数据会作为背景带进聊天：他心里有数，但不会念数字、不当健康顾问。
        </div>
      </div>

      {busy && <div className="absolute left-1/2 -translate-x-1/2 z-30 text-[11px] px-3 py-1 rounded-full shadow" style={{ top: 'calc(var(--chrome-top) + 3rem)', background: C.ink, color: '#fff' }}>{busy}</div>}
      {edit && <Editor date={edit} initial={all[edit] || null} onClose={() => setEdit(null)} />}
    </div>
  );
};

export default BodyApp;
