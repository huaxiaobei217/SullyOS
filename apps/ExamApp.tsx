/**
 * 考公陪练（个人二改）：给上班族的碎片时间用，补刷题 App 不管的部分。
 *  今天：到期的错题 → 一张技巧卡 → 一道申论小练；连续天数和这周最常错的题型
 *  错题：截图丢进来，拆成「为什么错 / 几步做完 / 下次怎么认」，挂技巧卡，按 1·3·7·15·30 天复习，可以追问
 *  技巧卡：手写的核心方法卡（utils/examCards.ts），不让模型现编
 *  申论：短材料 + 一道题，按采分点批改，给改写和参考答案
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import TokenImg from '../components/os/TokenImg';
import { putImageBlob } from '../utils/blobRef';
import { EXAM_CARDS, MODULE_NAMES, MODULE_COLORS, cardById, type ExamCard, type ExamModule } from '../utils/examCards';
import {
  studyApi, analyzeWrong, addWrong, getWrong, removeWrong, reviewWrong, dueWrong, askAboutWrong, getDrills, makeDrill, gradeDrill, removeDrill,
  DRILL_NAMES, todayLog, streak, cardOfDay, markCardSeen, weakSpots, markDay, EXAM_EVENT, type WrongItem, type Drill, type DrillKind,
  explainPoint, getPointCard, makeQuiz, getQuizzes, answerQuiz, markQuizBad, type QuizSet,
} from '../utils/examCoach';
import { SYLLABUS, pointById } from '../utils/examSyllabus';

const C = { bg: '#f4f2ec', card: '#fff', ink: '#22231f', muted: '#83817a', faint: '#bfbcb2', line: '#e7e3d8', accent: '#2f6f5e', soft: '#e6f0ec', warn: '#c2603d', gold: '#b5852b' };
type Tab = 'today' | 'points' | 'quiz' | 'wrong' | 'shenlun';

/* ───────── 小图 ───────── */
const Figure: React.FC<{ kind: ExamCard['figure'] }> = ({ kind }) => {
  if (kind === 'cross') return (
    <svg viewBox="0 0 260 120" className="w-full max-w-[300px]">
      <text x="20" y="25" fontSize="12" fill={C.ink}>进口 r₁ = 5%</text><text x="20" y="105" fontSize="12" fill={C.ink}>出口 r₂ = 15%</text>
      <text x="120" y="65" fontSize="13" fill={C.accent} fontWeight="bold">整体 r</text>
      <line x1="95" y1="22" x2="190" y2="98" stroke={C.faint} /><line x1="95" y1="98" x2="190" y2="22" stroke={C.faint} />
      <text x="195" y="25" fontSize="12" fill={C.muted}>r₂ − r</text><text x="195" y="105" fontSize="12" fill={C.muted}>r − r₁</text>
      <text x="20" y="62" fontSize="10" fill={C.faint}>差值之比 = 基期量的反比</text>
    </svg>
  );
  if (kind === 'travel') return (
    <svg viewBox="0 0 280 90" className="w-full max-w-[320px]">
      <line x1="20" y1="30" x2="260" y2="30" stroke={C.ink} strokeWidth="2" /><circle cx="20" cy="30" r="4" fill={C.accent} /><circle cx="260" cy="30" r="4" fill={C.warn} />
      <text x="12" y="18" fontSize="11">甲 →</text><text x="232" y="18" fontSize="11">← 乙</text><text x="105" y="52" fontSize="11" fill={C.accent}>相遇：路程和 = (v甲 + v乙) × t</text>
      <line x1="20" y1="72" x2="200" y2="72" stroke={C.faint} strokeDasharray="4 3" /><text x="30" y="86" fontSize="11" fill={C.warn}>追及：路程差 = (v快 − v慢) × t</text>
    </svg>
  );
  if (kind === 'stroke') return (
    <svg viewBox="0 0 200 110" className="w-full max-w-[220px]">
      <rect x="40" y="10" width="70" height="90" fill="none" stroke={C.ink} strokeWidth="2" /><line x1="40" y1="55" x2="110" y2="55" stroke={C.ink} strokeWidth="2" />
      <circle cx="40" cy="55" r="5" fill={C.warn} /><circle cx="110" cy="55" r="5" fill={C.warn} />
      <text x="122" y="50" fontSize="11" fill={C.warn}>奇点 ×2</text><text x="122" y="66" fontSize="11" fill={C.muted}>→ 一笔画</text>
    </svg>
  );
  return null;
};

const Chip: React.FC<{ on?: boolean; color?: string; onClick?: () => void; children: React.ReactNode }> = ({ on, color = C.ink, onClick, children }) => (
  <button onClick={onClick} className="text-[11px] px-2.5 py-1 rounded-full shrink-0" style={on ? { background: color, color: '#fff' } : { background: '#ebe7de', color: C.muted }}>{children}</button>
);
const Box: React.FC<{ children: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ children, className = '', style }) => (
  <div className={`rounded-3xl p-4 ${className}`} style={{ background: C.card, border: `1px solid ${C.line}`, ...style }}>{children}</div>
);
const Tag: React.FC<{ m: ExamModule; children?: React.ReactNode }> = ({ m, children }) => (
  <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${MODULE_COLORS[m]}18`, color: MODULE_COLORS[m] }}>{children || MODULE_NAMES[m]}</span>
);

/* ───────── 技巧卡 ───────── */
const CardView: React.FC<{ card: ExamCard; onClose: () => void }> = ({ card, onClose }) => {
  const [show, setShow] = useState(false);
  useEffect(() => { markCardSeen(card.id); }, [card.id]);
  return (
    <div className="absolute inset-0 z-40 flex flex-col" style={{ background: C.bg }}>
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+10px)] pb-2">
        <button onClick={onClose} className="text-[13px]" style={{ color: C.muted }}>‹ 返回</button><Tag m={card.module} /><span className="w-10" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-10 space-y-3">
        <div>
          <div className="text-[20px] font-bold" style={{ color: C.ink, fontFamily: `'Noto Serif SC', serif` }}>{card.title}</div>
          <div className="mt-2 px-3 py-2 rounded-2xl text-[13px] font-medium leading-relaxed" style={{ background: `${MODULE_COLORS[card.module]}14`, color: MODULE_COLORS[card.module] }}>{card.motto}</div>
        </div>
        <Box><div className="text-[10.5px] mb-1" style={{ color: C.muted }}>怎么认出来</div><div className="text-[13px] leading-relaxed">{card.spot}</div></Box>
        {card.formulas && <Box><div className="text-[10.5px] mb-1.5" style={{ color: C.muted }}>公式 · 规则</div>
          <div className="space-y-1.5">{card.formulas.map((f, i) => <div key={i} className="text-[12.5px] leading-relaxed px-3 py-1.5 rounded-xl font-mono" style={{ background: '#f6f4ee' }}>{f}</div>)}</div>
          {card.figure && <div className="mt-3 flex justify-center"><Figure kind={card.figure} /></div>}
        </Box>}
        <Box><div className="text-[10.5px] mb-1.5" style={{ color: C.muted }}>几步做完</div>
          <ol className="space-y-1.5">{card.steps.map((s, i) => <li key={i} className="flex gap-2 text-[13px] leading-relaxed"><span className="shrink-0 w-5 h-5 rounded-full text-[11px] flex items-center justify-center text-white" style={{ background: C.ink }}>{i + 1}</span><span>{s}</span></li>)}</ol>
        </Box>
        <Box><div className="text-[10.5px] mb-1.5" style={{ color: C.muted }}>例题</div>
          <div className="text-[13px] leading-relaxed">{card.example.q}</div>
          {!show ? <button onClick={() => setShow(true)} className="mt-3 w-full py-2 rounded-xl text-[12px]" style={{ background: C.soft, color: C.accent }}>先自己想一下，再看解法</button> : <>
            <div className="mt-3 space-y-1">{card.example.work.map((w, i) => <div key={i} className="text-[12.5px] font-mono leading-relaxed" style={{ color: C.ink }}>→ {w}</div>)}</div>
            <div className="mt-2 text-[13px] font-semibold" style={{ color: C.accent }}>答：{card.example.a}</div>
          </>}
        </Box>
        {card.traps && <Box style={{ background: '#fbf3ee', borderColor: '#f0dccf' }}><div className="text-[10.5px] mb-1" style={{ color: C.warn }}>常见坑</div>
          <ul className="space-y-1">{card.traps.map((t, i) => <li key={i} className="text-[12.5px] leading-relaxed">· {t}</li>)}</ul></Box>}
      </div>
    </div>
  );
};

/* ───────── 截图压缩 ───────── */
async function shrink(file: Blob, max = 1400): Promise<{ dataUrl: string; blob: Blob }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  const dataUrl = c.toDataURL('image/jpeg', 0.85);
  const blob = await (await fetch(dataUrl)).blob();
  return { dataUrl, blob };
}

const ExamApp: React.FC = () => {
  const { closeApp, apiConfig, addToast } = useOS() as any;
  const api = useMemo(() => studyApi(apiConfig), [apiConfig]);
  const [tab, setTab] = useState<Tab>('today');
  const [, setTick] = useState(0);
  useEffect(() => { const h = () => setTick(t => t + 1); window.addEventListener(EXAM_EVENT, h); return () => window.removeEventListener(EXAM_EVENT, h); }, []);
  const wrong = getWrong(); const due = dueWrong(); const drills = getDrills(); const log = todayLog();
  const [openCard, setOpenCard] = useState<ExamCard | null>(null);
  const [openWrong, setOpenWrong] = useState<WrongItem | null>(null);
  const [reviewing, setReviewing] = useState<WrongItem[] | null>(null);
  const [flip, setFlip] = useState(false);
  const [openDrill, setOpenDrill] = useState<Drill | null>(null);
  const [busy, setBusy] = useState('');
  const [modFilter, setModFilter] = useState<ExamModule | 'all'>('all');
  const [pointMod, setPointMod] = useState<ExamModule>('zl');
  const openPoint = async (pid: string) => {
    const p = pointById(pid); if (!p) return;
    const own = p.card ? cardById(p.card) : null;
    if (own) return setOpenCard(own);
    const cached = getPointCard(pid); if (cached) return setOpenCard(cached);
    setBusy(`在写「${p.name}」…`);
    try { setOpenCard(await explainPoint(api, pid)); } catch (e: any) { addToast(e?.message || '没写成', 'error'); } finally { setBusy(''); }
  };
  const quizzes = getQuizzes();
  const [quiz, setQuiz] = useState<QuizSet | null>(null);
  const [qi, setQi] = useState(0);
  const startQuiz = async (target: { pointIds?: string[]; module?: ExamModule }) => {
    setBusy('在出题…');
    try { const q = await makeQuiz(api, target); setQuiz(q); setQi(0); setTab('quiz'); } catch (e: any) { addToast(e?.message || '没出成', 'error'); } finally { setBusy(''); }
  };
  const weakTarget = () => { const pts = weakSpots(14).flatMap(w => getWrong().filter(x => x.module === w.module && x.type === w.type).map(x => x.cardId)).filter(Boolean) as string[];
    const ids = [...new Set(pts)].map(cid => Object.values(SYLLABUS).flat().flatMap(t => t.points).find(p => p.card === cid)?.id).filter(Boolean) as string[];
    return ids.length ? { pointIds: ids.slice(0, 3) } : { module: (['zl', 'sl', 'pd', 'yy'] as ExamModule[])[Math.floor(Math.random() * 4)] }; };

  /* —— 拆错题 —— */
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ dataUrl: string; blob: Blob }[]>([]);
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files || [])].slice(0, 3); e.target.value = '';
    const out = []; for (const f of files) out.push(await shrink(f));
    setPending(p => [...p, ...out].slice(0, 3)); setAdding(true);
  };
  const analyze = async () => {
    if (!pending.length && !note.trim()) return;
    setBusy('在拆这道题…');
    try {
      const a = await analyzeWrong(api, pending.map(p => p.dataUrl), note.trim());
      const tokens: string[] = []; for (const p of pending) tokens.push(await putImageBlob(p.blob));
      const item = addWrong(tokens, a); markDay('wrong');
      setPending([]); setNote(''); setAdding(false); setOpenWrong(item);
    } catch (e: any) { addToast(e?.message || '没拆成，可能这个模型不支持看图', 'error'); }
    finally { setBusy(''); }
  };

  /* —— 追问 —— */
  const [askText, setAskText] = useState('');
  const ask = async (w: WrongItem) => {
    const q = askText.trim(); if (!q) return; setAskText(''); setBusy('在想…');
    try { await askAboutWrong(api, w, q); setOpenWrong(getWrong().find(x => x.id === w.id) || null); } catch (e: any) { addToast(e?.message || '出错了', 'error'); } finally { setBusy(''); }
  };

  /* —— 申论 —— */
  const [drillAnswer, setDrillAnswer] = useState('');
  const [drillStart, setDrillStart] = useState(0);
  const [showRef, setShowRef] = useState(false);
  const newDrill = async (kind: DrillKind) => {
    setBusy('在出题…');
    try { const d = await makeDrill(api, kind); setOpenDrill(d); setDrillAnswer(''); setDrillStart(Date.now()); setShowRef(false); }
    catch (e: any) { addToast(e?.message || '没出成', 'error'); } finally { setBusy(''); }
  };
  const submit = async () => {
    if (!openDrill || !drillAnswer.trim()) return;
    setBusy('在批改…');
    try { setOpenDrill(await gradeDrill(api, openDrill, drillAnswer.trim())); } catch (e: any) { addToast(e?.message || '没批成', 'error'); } finally { setBusy(''); }
  };
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!openDrill || openDrill.doneAt) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [openDrill]);

  const todayCard = cardById(cardOfDay());
  const weak = weakSpots(7).slice(0, 4);
  const doneToday = (log.review || 0) + (log.card || 0) + (log.drill || 0) + (log.wrong || 0);

  /* ───────── 界面 ───────── */
  const header = (
    <div className="shrink-0 px-4 pt-[calc(env(safe-area-inset-top)+8px)] pb-2" style={{ background: C.bg }}>
      <div className="flex items-center justify-between">
        <button onClick={closeApp} className="text-[13px]" style={{ color: C.muted }}>‹ 返回</button>
        <div className="text-[15px] font-semibold" style={{ fontFamily: `'Noto Serif SC', serif` }}>考公陪练</div>
        <div className="text-[10.5px]" style={{ color: C.gold }}>{streak() ? `连续 ${streak()} 天` : ''}</div>
      </div>
      <div className="flex gap-1 mt-2 p-1 rounded-full" style={{ background: '#e7e3d8' }}>
        {([['today', '今天'], ['points', '知识点'], ['quiz', '刷题'], ['wrong', `错题${wrong.length ? ` ${wrong.length}` : ''}`], ['shenlun', '申论']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className="flex-1 py-1.5 rounded-full text-[12px]" style={tab === k ? { background: C.card, color: C.ink, fontWeight: 600 } : { color: C.muted }}>{l}</button>
        ))}
      </div>
    </div>
  );

  const wrongRow = (w: WrongItem) => (
    <button key={w.id} onClick={() => setOpenWrong(w)} className="w-full text-left flex gap-3 p-3 rounded-2xl" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      {w.images[0] ? <TokenImg value={w.images[0]} className="w-14 h-14 rounded-xl object-cover shrink-0" /> : <div className="w-14 h-14 rounded-xl shrink-0" style={{ background: '#efece4' }} />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5"><Tag m={w.module}>{w.type}</Tag>{w.lapses > 0 && <span className="text-[10px]" style={{ color: C.warn }}>忘过 {w.lapses} 次</span>}</div>
        <div className="text-[12px] mt-1 line-clamp-2 leading-snug">{w.stem}</div>
        <div className="text-[10.5px] mt-0.5" style={{ color: C.accent }}>{w.takeaway}</div>
      </div>
    </button>
  );

  return (
    <div className="h-full w-full flex flex-col relative overflow-hidden" style={{ background: C.bg, color: C.ink }}>
      {header}
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />

      {tab === 'today' && (
        <div className="flex-1 overflow-y-auto px-4 pb-10 space-y-3">
          <Box>
            <div className="flex items-end justify-between">
              <div><div className="text-[11px]" style={{ color: C.muted }}>今天</div><div className="text-[22px] font-bold" style={{ fontFamily: `'Noto Serif SC', serif` }}>{doneToday ? `做了 ${doneToday} 件` : '还没开始'}</div></div>
              <div className="text-right text-[10.5px] leading-relaxed" style={{ color: C.muted }}>复习 {log.review || 0} · 卡片 {log.card || 0}<br />申论 {log.drill || 0} · 新错题 {log.wrong || 0}</div>
            </div>
            <button onClick={() => fileRef.current?.click()} className="mt-3 w-full py-3 rounded-2xl text-[13px] font-semibold text-white" style={{ background: C.accent }}>＋ 拆一道错题（截图）</button>
            <button onClick={() => setAdding(true)} className="mt-1.5 w-full text-[11px]" style={{ color: C.muted }}>没截图？打字描述也行</button>
          </Box>

          <Box>
            <div className="flex items-center justify-between"><div className="text-[13px] font-semibold">① 到期的错题</div><div className="text-[11px]" style={{ color: C.muted }}>{due.length} 道</div></div>
            {due.length ? <>
              <div className="text-[11.5px] mt-1" style={{ color: C.muted }}>看题 → 想用什么方法 → 翻面对一下。一道 1 分钟。</div>
              <button onClick={() => { setReviewing(due.slice(0, 10)); setFlip(false); }} className="mt-2 w-full py-2.5 rounded-2xl text-[12.5px]" style={{ background: C.soft, color: C.accent }}>开始复习（{Math.min(10, due.length)} 道）</button>
            </> : <div className="text-[11.5px] mt-1" style={{ color: C.faint }}>{wrong.length ? '今天没有到期的，明天再来。' : '还没有错题。在粉笔里做错的截图丢进来就行。'}</div>}
          </Box>

          {todayCard && <Box>
            <div className="flex items-center justify-between"><div className="text-[13px] font-semibold">② 今天这张卡</div><Tag m={todayCard.module} /></div>
            <button onClick={() => setOpenCard(todayCard)} className="mt-2 w-full text-left p-3 rounded-2xl" style={{ background: `${MODULE_COLORS[todayCard.module]}10` }}>
              <div className="text-[14px] font-semibold">{todayCard.title}</div>
              <div className="text-[12px] mt-0.5" style={{ color: MODULE_COLORS[todayCard.module] }}>{todayCard.motto}</div>
            </button>
          </Box>}

          <Box>
            <div className="text-[13px] font-semibold">③ 申论小练 <span className="text-[11px] font-normal" style={{ color: C.muted }}>· 10 分钟，可跳过</span></div>
            <div className="flex gap-1.5 mt-2">{(Object.keys(DRILL_NAMES) as DrillKind[]).map(k => <button key={k} disabled={!!busy} onClick={() => { setTab('shenlun'); void newDrill(k); }} className="flex-1 py-2 rounded-xl text-[12px] disabled:opacity-40" style={{ background: '#f4efe2', color: C.gold }}>{DRILL_NAMES[k]}</button>)}</div>
          </Box>

          <Box>
            <div className="text-[13px] font-semibold">④ 刷 5 道 <span className="text-[11px] font-normal" style={{ color: C.muted }}>· 5 分钟，错的自动进错题本</span></div>
            <div className="flex gap-1.5 mt-2">
              <button disabled={!!busy} onClick={() => startQuiz(weakTarget())} className="flex-1 py-2 rounded-xl text-[12px] disabled:opacity-40" style={{ background: C.soft, color: C.accent }}>{weak.length ? '按薄弱点' : '随机一组'}</button>
              {(['zl', 'sl', 'pd', 'yy'] as ExamModule[]).map(m => <button key={m} disabled={!!busy} onClick={() => startQuiz({ module: m })} className="px-2.5 py-2 rounded-xl text-[11px] disabled:opacity-40" style={{ background: `${MODULE_COLORS[m]}14`, color: MODULE_COLORS[m] }}>{MODULE_NAMES[m].slice(0, 2)}</button>)}
            </div>
          </Box>

          {weak.length > 0 && <Box>
            <div className="text-[13px] font-semibold">这周最常错</div>
            <div className="mt-2 space-y-2">{weak.map(w => (
              <div key={`${w.module}${w.type}`} className="flex items-center gap-2">
                <Tag m={w.module}>{w.type}</Tag>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#efece4' }}><div className="h-full" style={{ width: `${Math.min(100, w.count / weak[0].count * 100)}%`, background: MODULE_COLORS[w.module] }} /></div>
                <span className="text-[10.5px] w-8 text-right" style={{ color: C.muted }}>{w.count}</span>
                {w.cards[0] && <button onClick={() => setOpenCard(cardById(w.cards[0]) || null)} className="text-[10.5px]" style={{ color: C.accent }}>看卡 ›</button>}
              </div>
            ))}</div>
          </Box>}
        </div>
      )}

      {tab === 'wrong' && (
        <div className="flex-1 overflow-y-auto px-4 pb-10">
          <div className="flex gap-1.5 overflow-x-auto pb-2">
            <Chip on={modFilter === 'all'} onClick={() => setModFilter('all')}>全部</Chip>
            {(Object.keys(MODULE_NAMES) as ExamModule[]).map(m => <Chip key={m} on={modFilter === m} color={MODULE_COLORS[m]} onClick={() => setModFilter(m)}>{MODULE_NAMES[m]}</Chip>)}
          </div>
          <button onClick={() => fileRef.current?.click()} className="w-full py-2.5 rounded-2xl text-[12.5px] mb-2" style={{ background: C.soft, color: C.accent }}>＋ 拆一道错题</button>
          <div className="space-y-2">{wrong.filter(w => modFilter === 'all' || w.module === modFilter).map(wrongRow)}</div>
          {!wrong.length && <div className="text-[12px] text-center mt-8" style={{ color: C.faint }}>还没有错题。</div>}
        </div>
      )}

      {tab === 'points' && (
        <div className="flex-1 overflow-y-auto px-4 pb-10">
          <div className="flex gap-1.5 overflow-x-auto pb-2">
            {(Object.keys(MODULE_NAMES) as ExamModule[]).map(m => <Chip key={m} on={pointMod === m} color={MODULE_COLORS[m]} onClick={() => setPointMod(m)}>{MODULE_NAMES[m]}</Chip>)}
          </div>
          <div className="space-y-3">
            {SYLLABUS[pointMod].map(t => (
              <Box key={t.name} className="!p-3">
                <div className="flex items-center justify-between mb-1.5 px-1">
                  <div className="text-[13px] font-semibold">{t.name}</div>
                  {pointMod !== 'sh' && <button disabled={!!busy} onClick={() => startQuiz({ pointIds: t.points.map(p => p.id).slice(0, 3) })} className="text-[10.5px] disabled:opacity-40" style={{ color: MODULE_COLORS[pointMod] }}>刷这一块 ›</button>}
                </div>
                {t.points.map(p => {
                  const has = !!p.card || !!getPointCard(p.id);
                  return (
                    <div key={p.id} className="flex items-center gap-2 px-1 py-1.5 border-t first:border-t-0" style={{ borderColor: C.line }}>
                      <button onClick={() => openPoint(p.id)} disabled={!!busy} className="flex-1 text-left text-[12.5px] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: has ? MODULE_COLORS[pointMod] : C.faint }} />{p.name}
                        {p.card && <span className="text-[9px] px-1.5 rounded-full" style={{ background: '#f4efe2', color: C.gold }}>精讲</span>}
                      </button>
                      {pointMod !== 'sh' && <button disabled={!!busy} onClick={() => startQuiz({ pointIds: [p.id] })} className="text-[10.5px] px-2 py-0.5 rounded-full disabled:opacity-40" style={{ background: '#f1eee6', color: C.muted }}>刷 5 道</button>}
                    </div>
                  );
                })}
              </Box>
            ))}
          </div>
          <div className="text-[10.5px] mt-3 text-center" style={{ color: C.faint }}>带「精讲」的是手写的卡；其余第一次点开时现写一张，之后就存着。</div>
        </div>
      )}

      {tab === 'quiz' && !quiz && (
        <div className="flex-1 overflow-y-auto px-4 pb-10 space-y-3">
          <Box>
            <div className="text-[13px] font-semibold">来一组（5 道）</div>
            <div className="text-[11.5px] mt-0.5" style={{ color: C.muted }}>按真题风格出的原创题，每道做完马上看解法。也可以去「知识点」里点某个考点单刷。</div>
            <div className="grid grid-cols-3 gap-1.5 mt-2">
              <button disabled={!!busy} onClick={() => startQuiz(weakTarget())} className="py-2.5 rounded-xl text-[12px] disabled:opacity-40" style={{ background: C.soft, color: C.accent }}>按薄弱点</button>
              {(['yy', 'sl', 'pd', 'zl', 'cs'] as ExamModule[]).map(m => <button key={m} disabled={!!busy} onClick={() => startQuiz({ module: m })} className="py-2.5 rounded-xl text-[12px] disabled:opacity-40" style={{ background: `${MODULE_COLORS[m]}14`, color: MODULE_COLORS[m] }}>{MODULE_NAMES[m]}</button>)}
            </div>
          </Box>
          {quizzes.map(q => { const done = q.qs.filter(x => x.picked); const right = done.filter(x => x.picked === x.answer).length; return (
            <button key={q.id} onClick={() => { setQuiz(q); setQi(Math.max(0, q.qs.findIndex(x => !x.picked && !x.bad))); }} className="w-full text-left p-3 rounded-2xl flex items-center gap-3" style={{ background: C.card, border: `1px solid ${C.line}` }}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-[13px] font-bold shrink-0" style={{ background: '#efece4', color: C.ink }}>{done.length ? `${right}/${done.length}` : '—'}</div>
              <div className="flex-1 min-w-0"><div className="text-[12.5px] font-medium truncate">{q.title}</div><div className="text-[10.5px]" style={{ color: C.muted }}>{new Date(q.at).toLocaleDateString()} · {q.doneAt ? '做完了' : `做到第 ${done.length + 1} 道`}</div></div>
            </button>
          ); })}
        </div>
      )}

      {tab === 'quiz' && quiz && (() => {
        const fresh = getQuizzes().find(x => x.id === quiz.id) || quiz; const q = fresh.qs[qi];
        if (!q) return null;
        const picked = q.picked; const right = fresh.qs.filter(x => x.picked && x.picked === x.answer).length;
        return (
          <div className="flex-1 overflow-y-auto px-4 pb-10 space-y-3">
            <div className="flex items-center justify-between">
              <button onClick={() => setQuiz(null)} className="text-[12px]" style={{ color: C.muted }}>‹ 列表</button>
              <div className="flex gap-1">{fresh.qs.map((x, i) => <button key={i} onClick={() => setQi(i)} className="w-6 h-6 rounded-full text-[10.5px]" style={{ background: i === qi ? C.ink : x.bad ? '#e7e3d8' : x.picked ? (x.picked === x.answer ? '#d7ebe3' : '#fbe1d6') : '#efece4', color: i === qi ? '#fff' : C.ink }}>{i + 1}</button>)}</div>
              <span className="text-[11px]" style={{ color: C.muted }}>对 {right}</span>
            </div>
            <Box>
              <div className="flex items-center gap-1.5 mb-2"><Tag m={q.module}>{q.type}</Tag></div>
              <div className="text-[13.5px] leading-[1.8] whitespace-pre-wrap">{q.stem}</div>
            </Box>
            <div className="space-y-1.5">{q.options.map(o => { const L = o.trim().charAt(0).toUpperCase(); const isAns = L === q.answer, isPick = L === picked;
              return <button key={o} disabled={!!picked || q.bad} onClick={() => { answerQuiz(fresh.id, qi, L); setTick(t => t + 1); }} className="w-full text-left px-4 py-3 rounded-2xl text-[13px]"
                style={{ background: picked ? (isAns ? '#d7ebe3' : isPick ? '#fbe1d6' : C.card) : C.card, border: `1px solid ${picked && (isAns || isPick) ? 'transparent' : C.line}` }}>{o}</button>; })}</div>
            {picked && <>
              <div className="px-3 py-2.5 rounded-2xl text-[13px] font-medium" style={{ background: picked === q.answer ? C.soft : '#fbf3ee', color: picked === q.answer ? C.accent : C.warn }}>{picked === q.answer ? '对了。' : `正确是 ${q.answer}，已放进错题本。`} {q.takeaway}</div>
              <Box><div className="text-[10.5px] mb-1.5" style={{ color: C.muted }}>考场上这样做</div><ol className="space-y-1">{q.steps.map((s, i) => <li key={i} className="text-[12.5px] leading-relaxed">{i + 1}. {s}</li>)}</ol></Box>
              <div className="flex gap-2">
                {q.pointId && <button onClick={() => openPoint(q.pointId!)} className="flex-1 py-2.5 rounded-2xl text-[12px]" style={{ background: '#f1eee6' }}>看这个知识点</button>}
                {qi < fresh.qs.length - 1 ? <button onClick={() => setQi(qi + 1)} className="flex-1 py-2.5 rounded-2xl text-[12.5px] font-semibold text-white" style={{ background: C.ink }}>下一道</button>
                  : <button onClick={() => setQuiz(null)} className="flex-1 py-2.5 rounded-2xl text-[12.5px] font-semibold text-white" style={{ background: C.accent }}>做完了 · 对 {right} 道</button>}
              </div>
            </>}
            {!q.bad && <button onClick={() => { if (window.confirm('这道题有问题（条件不对、答案算错）？删掉它。')) { markQuizBad(fresh.id, qi); setTick(t => t + 1); if (qi < fresh.qs.length - 1) setQi(qi + 1); } }} className="block mx-auto text-[10.5px]" style={{ color: C.faint }}>这道题有问题</button>}
            {q.bad && <div className="text-center text-[11px]" style={{ color: C.faint }}>这道已标为有问题，不计分。</div>}
          </div>
        );
      })()}

      {tab === 'shenlun' && !openDrill && (
        <div className="flex-1 overflow-y-auto px-4 pb-10 space-y-3">
          <Box>
            <div className="text-[13px] font-semibold">来一道</div>
            <div className="text-[11.5px] mt-0.5" style={{ color: C.muted }}>一段 400 字左右的材料，10 分钟写完，按采分点批改。</div>
            <div className="flex gap-1.5 mt-2">{(Object.keys(DRILL_NAMES) as DrillKind[]).map(k => <button key={k} disabled={!!busy} onClick={() => newDrill(k)} className="flex-1 py-2.5 rounded-xl text-[12px] disabled:opacity-40" style={{ background: '#f4efe2', color: C.gold }}>{DRILL_NAMES[k]}</button>)}</div>
            {busy && <div className="text-[11px] mt-2" style={{ color: C.muted }}>{busy}</div>}
          </Box>
          {drills.map(d => (
            <button key={d.id} onClick={() => { setOpenDrill(d); setDrillAnswer(d.answer || ''); setDrillStart(Date.now()); setShowRef(false); }} className="w-full text-left p-3 rounded-2xl flex items-center gap-3" style={{ background: C.card, border: `1px solid ${C.line}` }}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-[14px] font-bold shrink-0" style={{ background: d.score !== undefined ? '#f4efe2' : '#efece4', color: d.score !== undefined ? C.gold : C.faint }}>{d.score !== undefined ? d.score : '—'}</div>
              <div className="flex-1 min-w-0"><div className="text-[12.5px] font-medium">{DRILL_NAMES[d.kind]} · {d.topic}</div><div className="text-[11px] truncate" style={{ color: C.muted }}>{d.question}</div></div>
            </button>
          ))}
        </div>
      )}

      {tab === 'shenlun' && openDrill && (
        <div className="flex-1 overflow-y-auto px-4 pb-10 space-y-3">
          <div className="flex items-center justify-between">
            <button onClick={() => setOpenDrill(null)} className="text-[12px]" style={{ color: C.muted }}>‹ 列表</button>
            {!openDrill.doneAt && <span className="text-[12px] font-mono" style={{ color: now - drillStart > 600000 ? C.warn : C.muted }}>{Math.floor((now - drillStart) / 60000)}:{String(Math.floor((now - drillStart) / 1000) % 60).padStart(2, '0')}</span>}
            <button onClick={() => { if (window.confirm('删掉这道？')) { removeDrill(openDrill.id); setOpenDrill(null); } }} className="text-[11px]" style={{ color: C.faint }}>删除</button>
          </div>
          <Box><div className="text-[10.5px] mb-1" style={{ color: C.muted }}>给定资料 · {openDrill.topic}</div><div className="text-[13px] leading-[1.85] whitespace-pre-wrap" style={{ fontFamily: `'Noto Serif SC', serif` }}>{openDrill.material}</div></Box>
          <Box style={{ background: '#fbf7ea', borderColor: '#eee3c5' }}><div className="text-[13px] font-semibold leading-relaxed">{openDrill.question}</div><div className="text-[11px] mt-1" style={{ color: C.muted }}>{openDrill.limit} 字以内</div></Box>
          {!openDrill.doneAt ? <>
            <textarea value={drillAnswer} onChange={e => setDrillAnswer(e.target.value)} rows={9} placeholder="分条写：一是……；二是……" className="w-full rounded-2xl p-3 text-[13px] leading-relaxed outline-none" style={{ background: C.card, border: `1px solid ${C.line}` }} />
            <div className="flex items-center justify-between">
              <span className="text-[11px]" style={{ color: [...drillAnswer].length > openDrill.limit ? C.warn : C.muted }}>{[...drillAnswer.replace(/\s/g, '')].length} / {openDrill.limit} 字</span>
              <button onClick={submit} disabled={!!busy || !drillAnswer.trim()} className="px-5 py-2 rounded-full text-[13px] text-white disabled:opacity-40" style={{ background: C.ink }}>{busy || '交卷'}</button>
            </div>
          </> : <>
            <Box>
              <div className="flex items-end gap-2"><div className="text-[32px] font-bold leading-none" style={{ color: C.gold }}>{openDrill.score}</div><div className="text-[12px] pb-1" style={{ color: C.muted }}>/ 20</div></div>
              {openDrill.comment && <div className="text-[12.5px] leading-relaxed mt-2">{openDrill.comment}</div>}
            </Box>
            {!!openDrill.hits?.length && <Box><div className="text-[10.5px] mb-1" style={{ color: C.accent }}>拿到的分</div>{openDrill.hits.map((h, i) => <div key={i} className="text-[12.5px] leading-relaxed">✓ {h}</div>)}</Box>}
            {!!openDrill.misses?.length && <Box style={{ background: '#fbf3ee', borderColor: '#f0dccf' }}><div className="text-[10.5px] mb-1" style={{ color: C.warn }}>丢的分</div>{openDrill.misses.map((h, i) => <div key={i} className="text-[12.5px] leading-relaxed">✗ {h}</div>)}</Box>}
            <Box><div className="text-[10.5px] mb-1" style={{ color: C.muted }}>你写的</div><div className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{openDrill.answer}</div></Box>
            {openDrill.rewrite && <Box><div className="text-[10.5px] mb-1" style={{ color: C.accent }}>改成高分版</div><div className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{openDrill.rewrite}</div></Box>}
            <Box>
              <button onClick={() => setShowRef(v => !v)} className="text-[12px] w-full text-left" style={{ color: C.muted }}>{showRef ? '收起' : '看采分点和参考答案'} ›</button>
              {showRef && <>
                <div className="mt-2 space-y-1">{openDrill.points.map((p, i) => <div key={i} className="text-[12px]">{i + 1}. {p}</div>)}</div>
                <div className="mt-3 text-[12.5px] leading-relaxed whitespace-pre-wrap p-3 rounded-2xl" style={{ background: '#f6f4ee' }}>{openDrill.reference}</div>
              </>}
            </Box>
          </>}
        </div>
      )}

      {/* ───── 拆错题（输入） ───── */}
      {adding && (
        <div className="absolute inset-0 z-40 flex flex-col justify-end" style={{ background: 'rgba(20,20,18,0.35)' }} onClick={() => !busy && setAdding(false)}>
          <div className="rounded-t-3xl p-4 space-y-3" style={{ background: C.card }} onClick={e => e.stopPropagation()}>
            <div className="text-[14px] font-semibold">拆一道错题</div>
            <div className="flex gap-2">
              {pending.map((p, i) => <div key={i} className="relative"><img src={p.dataUrl} className="w-20 h-20 rounded-xl object-cover" /><button onClick={() => setPending(x => x.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] text-white" style={{ background: C.ink }}>×</button></div>)}
              {pending.length < 3 && <button onClick={() => fileRef.current?.click()} className="w-20 h-20 rounded-xl text-[11px]" style={{ background: '#f1eee6', color: C.muted }}>＋ 截图<br />（最多 3 张）</button>}
            </div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="补一句（可不写）：我选了 C / 我卡在列式 / 没截图就把题打出来" className="w-full rounded-xl p-2.5 text-[12.5px] outline-none" style={{ background: '#f8f6f0', border: `1px solid ${C.line}` }} />
            <button onClick={analyze} disabled={!!busy || (!pending.length && !note.trim())} className="w-full py-3 rounded-2xl text-[13px] font-semibold text-white disabled:opacity-40" style={{ background: C.accent }}>{busy || '拆'}</button>
          </div>
        </div>
      )}

      {/* ───── 错题详情 ───── */}
      {openWrong && (
        <div className="absolute inset-0 z-30 flex flex-col" style={{ background: C.bg }}>
          <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+10px)] pb-2">
            <button onClick={() => setOpenWrong(null)} className="text-[13px]" style={{ color: C.muted }}>‹ 返回</button>
            <Tag m={openWrong.module}>{MODULE_NAMES[openWrong.module]} · {openWrong.type}</Tag>
            <button onClick={() => { if (window.confirm('删掉这道错题？')) { removeWrong(openWrong.id); setOpenWrong(null); } }} className="text-[11px]" style={{ color: C.faint }}>删除</button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-24 space-y-3">
            {openWrong.images.map((t, i) => <TokenImg key={i} value={t} className="w-full rounded-2xl" />)}
            <Box>
              <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{openWrong.stem}</div>
              {openWrong.options && <div className="mt-2 space-y-0.5">{openWrong.options.map((o, i) => <div key={i} className="text-[12.5px]">{o}</div>)}</div>}
              <div className="mt-2 text-[12px] flex gap-3"><span style={{ color: C.accent }}>答案 {openWrong.answer || '—'}</span>{openWrong.mine && <span style={{ color: C.warn }}>你选 {openWrong.mine}</span>}</div>
            </Box>
            <Box style={{ background: '#fbf3ee', borderColor: '#f0dccf' }}><div className="text-[10.5px] mb-1" style={{ color: C.warn }}>错在哪</div><div className="text-[13px] leading-relaxed">{openWrong.why}</div></Box>
            <Box><div className="text-[10.5px] mb-1.5" style={{ color: C.muted }}>考场上这样做</div>
              <ol className="space-y-1.5">{openWrong.steps.map((s, i) => <li key={i} className="flex gap-2 text-[13px] leading-relaxed"><span className="shrink-0 w-5 h-5 rounded-full text-[11px] flex items-center justify-center text-white" style={{ background: C.ink }}>{i + 1}</span><span>{s}</span></li>)}</ol>
            </Box>
            <div className="px-3 py-2.5 rounded-2xl text-[13px] font-medium" style={{ background: C.soft, color: C.accent }}>下次：{openWrong.takeaway}</div>
            {openWrong.trap && <div className="text-[12px] px-1" style={{ color: C.muted }}>坑：{openWrong.trap}</div>}
            {openWrong.cardId && cardById(openWrong.cardId) && <button onClick={() => setOpenCard(cardById(openWrong.cardId)!)} className="w-full text-left p-3 rounded-2xl" style={{ background: C.card, border: `1px solid ${C.line}` }}>
              <div className="text-[10.5px]" style={{ color: C.muted }}>对应技巧卡</div><div className="text-[13px] font-semibold">{cardById(openWrong.cardId)!.title} ›</div></button>}
            {(openWrong.chat || []).map((c, i) => <div key={i} className="space-y-1.5"><div className="text-[12.5px] ml-auto max-w-[85%] w-fit px-3 py-1.5 rounded-2xl text-white" style={{ background: C.ink }}>{c.q}</div><div className="text-[12.5px] leading-relaxed px-3 py-2 rounded-2xl whitespace-pre-wrap" style={{ background: C.card, border: `1px solid ${C.line}` }}>{c.a}</div></div>)}
          </div>
          <div className="absolute inset-x-0 bottom-0 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+10px)] flex gap-2" style={{ background: C.bg, borderTop: `1px solid ${C.line}` }}>
            <input value={askText} onChange={e => setAskText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void ask(openWrong); }} placeholder="追问：为什么不能选 C？这步怎么算？" className="flex-1 rounded-full px-3.5 py-2 text-[12.5px] outline-none" style={{ background: C.card, border: `1px solid ${C.line}` }} />
            <button onClick={() => ask(openWrong)} disabled={!!busy || !askText.trim()} className="px-4 rounded-full text-[12.5px] text-white disabled:opacity-40" style={{ background: C.ink }}>{busy ? '…' : '问'}</button>
          </div>
        </div>
      )}

      {/* ───── 复习 ───── */}
      {reviewing && reviewing[0] && (() => { const w = reviewing[0]; return (
        <div className="absolute inset-0 z-30 flex flex-col" style={{ background: C.bg }}>
          <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+10px)] pb-2">
            <button onClick={() => setReviewing(null)} className="text-[13px]" style={{ color: C.muted }}>‹ 结束</button>
            <span className="text-[11.5px]" style={{ color: C.muted }}>还剩 {reviewing.length} 道</span><Tag m={w.module}>{w.type}</Tag>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-28 space-y-3">
            {w.images[0] ? <TokenImg value={w.images[0]} className="w-full rounded-2xl" /> : <Box><div className="text-[13px] leading-relaxed">{w.stem}</div></Box>}
            {!flip ? <div className="text-center text-[12px] mt-4" style={{ color: C.muted }}>先在心里过一遍：这是什么题型？用什么方法？</div> : <>
              <div className="px-3 py-2.5 rounded-2xl text-[13.5px] font-semibold" style={{ background: C.soft, color: C.accent }}>{w.takeaway}</div>
              <Box><div className="text-[12px] mb-1" style={{ color: C.accent }}>答案 {w.answer || '—'}</div>
                <ol className="space-y-1">{w.steps.map((s, i) => <li key={i} className="text-[12.5px] leading-relaxed">{i + 1}. {s}</li>)}</ol></Box>
              {w.trap && <div className="text-[12px] px-1" style={{ color: C.warn }}>坑：{w.trap}</div>}
            </>}
          </div>
          <div className="absolute inset-x-0 bottom-0 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+12px)] flex gap-2" style={{ background: C.bg }}>
            {!flip ? <button onClick={() => setFlip(true)} className="flex-1 py-3 rounded-2xl text-[13px] font-semibold text-white" style={{ background: C.ink }}>想好了，翻面</button> : <>
              <button onClick={() => { reviewWrong(w.id, false); setReviewing(r => r && r.length > 1 ? r.slice(1) : null); setFlip(false); }} className="flex-1 py-3 rounded-2xl text-[13px]" style={{ background: '#fbe9e1', color: C.warn }}>还不熟</button>
              <button onClick={() => { reviewWrong(w.id, true); setReviewing(r => r && r.length > 1 ? r.slice(1) : null); setFlip(false); }} className="flex-1 py-3 rounded-2xl text-[13px] font-semibold text-white" style={{ background: C.accent }}>记住了</button>
            </>}
          </div>
        </div>
      ); })()}

      {openCard && <CardView card={openCard} onClose={() => setOpenCard(null)} />}
      {busy && !adding && tab !== 'shenlun' && <div className="absolute left-1/2 -translate-x-1/2 bottom-8 z-50 px-4 py-2 rounded-full text-[12px] text-white" style={{ background: 'rgba(34,35,31,0.85)' }}>{busy}</div>}
    </div>
  );
};

export default ExamApp;
