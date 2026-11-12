/**
 * 考公陪练 · 刷题器（个人二改）：代码出的图推题 + 题库题（LogiQA / 自己导入的 PDF）。
 * 一题一屏：选 → 马上对答案；图推题直接给解法，题库题点「讲这道」才问模型；做错的进错题本。
 */
import React, { useEffect, useState } from 'react';
import TokenImg from '../os/TokenImg';
import { MODULE_NAMES, MODULE_COLORS } from '../../utils/examCards';
import { makeFigPuzzle, puzzleSvg, type FigKind, type FigPuzzle } from '../../utils/figureGen';
import { cropQuestion, markDone, getBanks, type BankQ } from '../../utils/examBank';
import { addWrong, explainBankQ, markDay } from '../../utils/examCoach';
import { pointById } from '../../utils/examSyllabus';
import type { APIConfig } from '../../types';

const C = { bg: '#f4f2ec', card: '#fff', ink: '#22231f', muted: '#83817a', faint: '#bfbcb2', line: '#e7e3d8', accent: '#2f6f5e', soft: '#e6f0ec', warn: '#c2603d' };
export type RunItem = { kind: 'fig'; fig: FigPuzzle } | { kind: 'bank'; q: BankQ };
export type RunSpec = { title: string } & ({ source: 'fig'; figKind: FigKind; n: number } | { source: 'bank'; items: BankQ[] });

const svgUrl = (s: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
const Svg: React.FC<{ s: string; className?: string }> = ({ s, className }) => <img src={svgUrl(s)} className={className} alt="" draggable={false} />;

const ExamRunner: React.FC<{ spec: RunSpec; api: APIConfig; onClose: () => void; onOpenPoint: (id: string) => void; toast: (m: string, t?: string) => void }> = ({ spec, api, onClose, onOpenPoint, toast }) => {
  const [items] = useState<RunItem[]>(() => spec.source === 'fig'
    ? Array.from({ length: spec.n }, (_, i) => ({ kind: 'fig' as const, fig: makeFigPuzzle(spec.figKind, Date.now() + i * 104729) }))
    : spec.items.map(q => ({ kind: 'bank' as const, q })));
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [explain, setExplain] = useState<Record<number, { type: string; steps: string[]; takeaway: string; why?: string } | 'loading'>>({});
  const [crop, setCrop] = useState<Record<number, string | null>>({});
  const it = items[i];
  const right = Object.entries(picked).filter(([k, v]) => { const x = items[Number(k)]; return x.kind === 'fig' ? x.fig.answer === v : x.q.answer === v; }).length;

  // PDF 题：把那一块截出来
  useEffect(() => {
    if (!it || it.kind !== 'bank' || !it.q.page || crop[i] !== undefined) return;
    const meta = getBanks().find(b => b.id === it.q.bank); if (!meta) return;
    setCrop(c => ({ ...c, [i]: null }));
    cropQuestion(meta, it.q).then(t => setCrop(c => ({ ...c, [i]: t }))).catch(() => setCrop(c => ({ ...c, [i]: null })));
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!it) return null;
  const answer = it.kind === 'fig' ? it.fig.answer : it.q.answer;
  const mine = picked[i];
  const choose = (L: string) => {
    if (mine) return;
    setPicked(p => ({ ...p, [i]: L }));
    if (it.kind === 'bank') markDone(it.q.id, L);
    if (answer && L !== answer) {
      if (it.kind === 'fig') {
        const f = it.fig; const p = pointById(f.pointId);
        addWrong([svgUrl(puzzleSvg(f))], { module: 'pd', type: f.title, stem: `图形推理 · ${f.title}（见图）`, answer: f.answer, mine: L, why: `选了 ${L}，正确是 ${f.answer}`, steps: f.steps, takeaway: f.takeaway, cardId: p?.card });
      } else {
        const q = it.q;
        addWrong(crop[i] ? [crop[i]!] : [], { module: q.module, type: q.type || '题库题', stem: q.stem, options: q.options, answer: q.answer, mine: L, why: `选了 ${L}，正确是 ${q.answer}`, steps: [], takeaway: '' });
      }
    }
    if (Object.keys(picked).length + 1 === items.length) markDay('review');
  };
  const doExplain = async () => {
    if (it.kind !== 'bank') return;
    setExplain(e => ({ ...e, [i]: 'loading' }));
    try { const r = await explainBankQ(api, it.q, mine); setExplain(e => ({ ...e, [i]: r })); }
    catch (err: any) { toast(err?.message || '没讲成', 'error'); setExplain(e => { const n = { ...e }; delete n[i]; return n; }); }
  };
  const ex = explain[i];

  return (
    <div className="absolute inset-0 z-30 flex flex-col" style={{ background: C.bg, color: C.ink }}>
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+10px)] pb-2">
        <button onClick={onClose} className="text-[13px]" style={{ color: C.muted }}>‹ 结束</button>
        <div className="flex gap-1">{items.map((x, k) => { const p = picked[k]; const a = x.kind === 'fig' ? x.fig.answer : x.q.answer;
          return <button key={k} onClick={() => setI(k)} className="w-6 h-6 rounded-full text-[10.5px]" style={{ background: k === i ? C.ink : p ? (p === a ? '#d7ebe3' : '#fbe1d6') : '#e9e5db', color: k === i ? '#fff' : C.ink }}>{k + 1}</button>; })}</div>
        <span className="text-[11px]" style={{ color: C.muted }}>对 {right}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-10 space-y-3">
        <div className="flex items-center gap-1.5">
          {it.kind === 'fig' ? <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${MODULE_COLORS.pd}18`, color: MODULE_COLORS.pd }}>图形推理 · {it.fig.mixed && !mine ? '混着来，先自己认题型' : it.fig.title}</span>
            : <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${MODULE_COLORS[it.q.module]}18`, color: MODULE_COLORS[it.q.module] }}>{MODULE_NAMES[it.q.module]}{it.q.type ? ` · ${it.q.type}` : ''}</span>}
          <span className="text-[10px]" style={{ color: C.faint }}>{spec.title}{it.kind === 'bank' && it.q.no ? ` · 第 ${it.q.no} 题` : ''}</span>
        </div>

        {it.kind === 'fig' ? (
          <div className="rounded-3xl p-3" style={{ background: C.card, border: `1px solid ${C.line}` }}>
            <div className="text-[12.5px] mb-2">从所给的四个选项中，选择最合适的一个填入问号处，使之呈现一定的规律性。</div>
            {it.fig.rows ? it.fig.rows.map((row, ri) => (
              <div key={ri} className="flex gap-1.5 mb-1.5">{row.map((s, k) => <Svg key={k} s={s} className="w-[23%] border rounded" />)}{ri === 1 && <div className="w-[23%] aspect-square flex items-center justify-center text-[28px] border rounded" style={{ color: C.muted }}>?</div>}</div>
            )) : <div className="grid grid-cols-5 gap-1">{it.fig.seq.map((s, k) => <Svg key={k} s={s} className="w-full border rounded" />)}<div className="aspect-square flex items-center justify-center text-[26px] border rounded" style={{ color: C.muted }}>?</div></div>}
          </div>
        ) : (
          <div className="rounded-3xl p-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
            {it.q.page && crop[i] && <TokenImg value={crop[i]!} className="w-full rounded-xl mb-2" />}
            {it.q.page && crop[i] === null && <div className="text-[11px] mb-2" style={{ color: C.faint }}>正在截这道题的原图…</div>}
            {!(it.q.page && crop[i]) && <div className="text-[13.5px] leading-[1.85] whitespace-pre-wrap">{it.q.stem}</div>}
          </div>
        )}

        {it.kind === 'fig' ? (
          <div className="grid grid-cols-4 gap-1.5">{it.fig.options.map((s, k) => { const L = 'ABCD'[k]; const isAns = L === answer, isPick = L === mine;
            return <button key={k} disabled={!!mine} onClick={() => choose(L)} className="rounded-2xl p-1.5" style={{ background: mine ? (isAns ? '#d7ebe3' : isPick ? '#fbe1d6' : C.card) : C.card, border: `1px solid ${C.line}` }}>
              <div className="text-[11px] mb-0.5 text-left pl-1" style={{ color: C.muted }}>{L}</div><Svg s={s} className="w-full" /></button>; })}</div>
        ) : (
          <div className="space-y-1.5">{(it.q.options.length ? it.q.options : ['A', 'B', 'C', 'D']).map((o, k) => { const L = o.trim().charAt(0).toUpperCase() || 'ABCD'[k]; const isAns = L === answer, isPick = L === mine;
            return <button key={k} disabled={!!mine} onClick={() => choose(L)} className="w-full text-left px-4 py-3 rounded-2xl text-[13px]" style={{ background: mine ? (isAns ? '#d7ebe3' : isPick ? '#fbe1d6' : C.card) : C.card, border: `1px solid ${C.line}` }}>{o}</button>; })}</div>
        )}

        {mine && <>
          <div className="px-3 py-2.5 rounded-2xl text-[13px] font-medium" style={{ background: !answer || mine === answer ? C.soft : '#fbf3ee', color: !answer || mine === answer ? C.accent : C.warn }}>
            {!answer ? '这本题库没对上这题的答案。' : mine === answer ? '对了。' : `正确是 ${answer}，已放进错题本。`}{it.kind === 'fig' ? ` ${it.fig.takeaway}` : ''}
          </div>
          {it.kind === 'fig' && <div className="rounded-3xl p-4" style={{ background: C.card, border: `1px solid ${C.line}` }}><div className="text-[10.5px] mb-1.5" style={{ color: C.muted }}>考场上这样做</div><ol className="space-y-1">{it.fig.steps.map((s, k) => <li key={k} className="text-[12.5px] leading-relaxed">{k + 1}. {s}</li>)}</ol></div>}
          {it.kind === 'bank' && (ex && ex !== 'loading' ? (
            <div className="rounded-3xl p-4 space-y-1.5" style={{ background: C.card, border: `1px solid ${C.line}` }}>
              <div className="text-[10.5px]" style={{ color: C.muted }}>{ex.type}</div>
              {ex.why && <div className="text-[12.5px]" style={{ color: C.warn }}>错在：{ex.why}</div>}
              <ol className="space-y-1">{ex.steps.map((s, k) => <li key={k} className="text-[12.5px] leading-relaxed">{k + 1}. {s}</li>)}</ol>
              {ex.takeaway && <div className="text-[12.5px] font-medium" style={{ color: C.accent }}>下次：{ex.takeaway}</div>}
            </div>
          ) : <button onClick={doExplain} disabled={ex === 'loading'} className="w-full py-2.5 rounded-2xl text-[12.5px] disabled:opacity-50" style={{ background: '#f1eee6' }}>{ex === 'loading' ? '在讲…' : '讲这道（问一次模型）'}</button>)}
          <div className="flex gap-2">
            {it.kind === 'fig' && <button onClick={() => onOpenPoint(it.fig.pointId)} className="flex-1 py-2.5 rounded-2xl text-[12px]" style={{ background: '#f1eee6' }}>看这类的卡</button>}
            {i < items.length - 1 ? <button onClick={() => setI(i + 1)} className="flex-1 py-2.5 rounded-2xl text-[12.5px] font-semibold text-white" style={{ background: C.ink }}>下一道</button>
              : <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-[12.5px] font-semibold text-white" style={{ background: C.accent }}>做完了 · 对 {right} / {items.length}</button>}
          </div>
        </>}
      </div>
    </div>
  );
};

export default ExamRunner;
