/**
 * 页脚 —— 书影批注墙 · 快问快答转盘 · 深夜点播机。雾霾蓝 + 羊皮纸。
 * 逻辑见 utils/footnote.ts。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useOS } from '../context/OSContext';
import { CaretLeft, Star, Trash, Radio, ArrowsClockwise } from '@phosphor-icons/react';
import {
  loadFootnote, updateFootnote, FOOTNOTE_CHANGED_EVENT, dropCard, QA_BANK, generateQuestion, answerQuestion,
  RADIO_CHANNELS, playRadio, type FootCard, type RadioChannel,
} from '../utils/footnote';

const T = {
  ink: '#3b506d', blue: '#7e9eca', blueSoft: '#eaf2ff', mist: '#d0dceb',
  paper: '#f7f0e1', paperEdge: '#e6dcc6', paperInk: '#5a4a35', bg: '#eef2f7',
};
const KIND_LABEL: Record<FootCard['kind'], string> = { note: '批注', excerpt: '摘录', frame: '截帧' };
const serif = `'Noto Serif SC','Songti SC','Georgia',serif`;

type Tab = 'wall' | 'qa' | 'radio';

const FootnoteApp: React.FC = () => {
  const { closeApp, characters, apiConfig, addToast } = useOS() as any;
  const [tab, setTab] = useState<Tab>('wall');
  const [store, setStore] = useState(() => loadFootnote());
  const defaultChar = useMemo(() => {
    let last = '';
    try { last = localStorage.getItem('os_last_active_char_id') || ''; } catch { /* ignore */ }
    return (characters || []).find((c: any) => /诺亚|Noah/i.test(c.name))?.id || last || characters?.[0]?.id || '';
  }, [characters]);
  const [charId, setCharId] = useState<string>(defaultChar);
  useEffect(() => { if (!charId && defaultChar) setCharId(defaultChar); }, [defaultChar, charId]);
  const char = (characters || []).find((c: any) => c.id === charId);

  useEffect(() => {
    const h = () => setStore(loadFootnote());
    window.addEventListener(FOOTNOTE_CHANGED_EVENT, h);
    return () => window.removeEventListener(FOOTNOTE_CHANGED_EVENT, h);
  }, []);

  const toastErr = (e: any) => addToast?.(e?.message || String(e), 'error');

  return (
    <div className="h-full w-full flex flex-col" style={{ background: T.bg, color: T.ink }}>
      <div className="shrink-0 px-3 pb-2 flex items-center gap-2" style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}>
        <button onClick={closeApp} className="p-1.5 -ml-1 active:scale-90"><CaretLeft size={22} /></button>
        <div className="text-lg tracking-[0.3em] font-semibold" style={{ fontFamily: serif }}>页脚</div>
        <div className="flex-1" />
        {(characters || []).length > 1 && (
          <select value={charId} onChange={e => setCharId(e.target.value)}
            className="text-[11px] rounded-full px-2 py-1 outline-none" style={{ background: T.blueSoft, color: T.ink, border: `1px solid ${T.mist}` }}>
            {(characters || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div className="shrink-0 mx-4 mb-2 p-1 rounded-full flex" style={{ background: 'rgba(255,255,255,0.7)', border: `1px solid ${T.mist}` }}>
        {([['wall', '批注墙'], ['qa', '快问快答'], ['radio', '深夜点播']] as [Tab, string][]).map(([k, n]) => (
          <button key={k} onClick={() => setTab(k)} className="flex-1 py-1.5 rounded-full text-xs font-semibold transition-colors"
            style={{ background: tab === k ? T.blue : 'transparent', color: tab === k ? 'white' : T.ink }}>{n}</button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-10">
        {!char ? <div className="text-center text-xs mt-10 opacity-60">先去建一个角色吧</div>
          : tab === 'wall' ? <Wall char={char} apiConfig={apiConfig} cards={store.cards.filter(c => c.charId === char.id)} onErr={toastErr} />
          : tab === 'qa' ? <Qa char={char} apiConfig={apiConfig} rounds={store.qa.filter(q => q.charId === char.id)} onErr={toastErr} />
          : <RadioTab char={char} apiConfig={apiConfig} pieces={store.radio.filter(r => r.charId === char.id)} onErr={toastErr} />}
      </div>
    </div>
  );
};

/* ───────── 批注墙 ───────── */

const Wall: React.FC<{ char: any; apiConfig: any; cards: FootCard[]; onErr: (e: any) => void }> = ({ char, apiConfig, cards, onErr }) => {
  const [busy, setBusy] = useState(false);
  const [onlyStar, setOnlyStar] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const drop = () => {
    setBusy(true);
    dropCard(char, apiConfig).then(c => setOpenId(c.id)).catch(onErr).finally(() => setBusy(false));
  };
  const shown = onlyStar ? cards.filter(c => c.starred) : cards;
  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <button onClick={drop} disabled={busy}
          className="flex-1 py-2.5 rounded-2xl text-sm font-semibold active:scale-[0.98] disabled:opacity-60"
          style={{ background: T.paper, color: T.paperInk, border: `1px dashed ${T.paperEdge}`, fontFamily: serif }}>
          {busy ? `${char.name}在翻书…` : '从书页里掉一张'}
        </button>
        <button onClick={() => setOnlyStar(v => !v)} className="p-2.5 rounded-2xl" style={{ background: onlyStar ? T.blue : 'white', color: onlyStar ? 'white' : T.blue }}>
          <Star size={16} weight={onlyStar ? 'fill' : 'regular'} />
        </button>
      </div>
      {!shown.length && <div className="text-center text-[11px] opacity-50 mt-8">{onlyStar ? '还没有收藏的卡片' : '墙上还是空的'}</div>}
      <div className="columns-2 gap-3">
        {shown.map((c, i) => (
          <div key={c.id} onClick={() => setOpenId(openId === c.id ? null : c.id)}
            className="break-inside-avoid mb-3 p-3 rounded-lg shadow-sm cursor-pointer"
            style={{ background: T.paper, border: `1px solid ${T.paperEdge}`, transform: `rotate(${((i * 37) % 5) - 2}deg)` }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: T.blueSoft, color: T.blue, border: `0.5px solid ${T.mist}` }}>{KIND_LABEL[c.kind]}</span>
              {c.starred && <Star size={11} weight="fill" color={T.blue} />}
            </div>
            {c.quote && <div className="text-[11.5px] leading-relaxed italic mb-1.5" style={{ color: T.paperInk, fontFamily: serif }}>{c.kind === 'frame' ? c.quote : `「${c.quote}」`}</div>}
            <div className="text-[12px] leading-relaxed" style={{ color: T.ink }}>{c.note}</div>
            <div className="text-[9.5px] mt-2 opacity-60" style={{ fontFamily: serif }}>—— {c.source}</div>
            {openId === c.id && (
              <div className="flex justify-end gap-3 mt-2 pt-1.5 border-t" style={{ borderColor: T.paperEdge }} onClick={e => e.stopPropagation()}>
                <button onClick={() => updateFootnote(s => ({ ...s, cards: s.cards.map(x => x.id === c.id ? { ...x, starred: !x.starred } : x) }))}
                  className="text-[10px] flex items-center gap-1" style={{ color: T.blue }}><Star size={12} weight={c.starred ? 'fill' : 'regular'} />{c.starred ? '取消收藏' : '收藏'}</button>
                <button onClick={() => updateFootnote(s => ({ ...s, cards: s.cards.filter(x => x.id !== c.id) }))}
                  className="text-[10px] flex items-center gap-1 text-rose-400"><Trash size={12} />撕掉</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
};

/* ───────── 快问快答 ───────── */

const Qa: React.FC<{ char: any; apiConfig: any; rounds: any[]; onErr: (e: any) => void }> = ({ char, apiConfig, rounds, onErr }) => {
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [q, setQ] = useState<{ text: string; fromBank: boolean } | null>(null);
  const [mine, setMine] = useState('');
  const [revealing, setRevealing] = useState(false);
  const [result, setResult] = useState<any>(null);

  const spin = async () => {
    setSpinning(true); setResult(null); setMine(''); setQ(null);
    setAngle(a => a + 720 + Math.floor(Math.random() * 360));
    const useBank = Math.random() < 0.5;
    const started = Date.now();
    let next: { text: string; fromBank: boolean };
    try {
      if (useBank) {
        const used = new Set(rounds.slice(0, 30).map(r => r.question));
        const pool = QA_BANK.filter(x => !used.has(x));
        next = { text: (pool.length ? pool : QA_BANK)[Math.floor(Math.random() * (pool.length || QA_BANK.length))], fromBank: true };
      } else {
        next = { text: await generateQuestion(char, apiConfig), fromBank: false };
      }
    } catch (e) {
      next = { text: QA_BANK[Math.floor(Math.random() * QA_BANK.length)], fromBank: true };
      onErr(e);
    }
    const wait = Math.max(0, 1600 - (Date.now() - started));
    setTimeout(() => { setQ(next); setSpinning(false); }, wait);
  };
  const reveal = () => {
    if (!q || !mine.trim()) return;
    setRevealing(true);
    answerQuestion(char, apiConfig, q.text, mine.trim(), q.fromBank).then(setResult).catch(onErr).finally(() => setRevealing(false));
  };

  return (
    <>
      <div className="flex flex-col items-center mt-2 mb-4">
        <div className="relative w-40 h-40">
          <div className="absolute left-1/2 -top-1 -translate-x-1/2 z-10 w-0 h-0" style={{ borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderTop: `12px solid ${T.ink}` }} />
          <div className="w-full h-full rounded-full shadow-inner"
            style={{
              transform: `rotate(${angle}deg)`, transition: 'transform 1.6s cubic-bezier(.17,.67,.3,1)',
              background: `conic-gradient(${[T.blueSoft, T.paper, '#dfe8f5', '#f2e8d4', T.blueSoft, T.paper, '#dfe8f5', '#f2e8d4'].map((c, i) => `${c} ${i * 45}deg ${(i + 1) * 45}deg`).join(',')})`,
              border: `3px solid ${T.blue}`,
            }}>
            <div className="absolute inset-0 m-auto w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'white', border: `2px solid ${T.blue}` }}>
              <span className="text-[10px] font-bold" style={{ color: T.blue }}>Q&A</span>
            </div>
          </div>
        </div>
        <button onClick={spin} disabled={spinning || revealing} className="mt-3 px-6 py-2 rounded-full text-sm font-semibold text-white active:scale-95 disabled:opacity-60"
          style={{ background: T.blue }}>{spinning ? '转呀转…' : q ? '再转一次' : '转一下'}</button>
      </div>

      {q && (
        <div className="p-4 rounded-2xl mb-4" style={{ background: 'white', border: `1px solid ${T.mist}` }}>
          <div className="text-[10px] mb-1" style={{ color: T.blue }}>{q.fromBank ? '题库' : `${char.name}现场出的题`}</div>
          <div className="text-[15px] font-semibold leading-relaxed mb-3" style={{ fontFamily: serif }}>{q.text}</div>
          {!result ? (
            <>
              <textarea value={mine} onChange={e => setMine(e.target.value)} rows={2} placeholder="你的答案（他看不到，揭晓时才一起翻开）"
                className="w-full text-[13px] p-2.5 rounded-xl outline-none resize-none" style={{ background: T.bg, color: T.ink }} />
              <button onClick={reveal} disabled={!mine.trim() || revealing} className="mt-2 w-full py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: T.ink }}>
                {revealing ? `${char.name}在想…` : '一起揭晓'}
              </button>
            </>
          ) : <Reveal r={result} name={char.name} />}
        </div>
      )}

      {rounds.length > 0 && <div className="text-[11px] mb-2 opacity-60">以前答过的</div>}
      {rounds.filter(r => r.id !== result?.id).slice(0, 30).map(r => (
        <div key={r.id} className="p-3 rounded-2xl mb-2" style={{ background: 'rgba(255,255,255,0.7)', border: `1px solid ${T.mist}` }}>
          <div className="text-[12.5px] font-semibold mb-1.5" style={{ fontFamily: serif }}>{r.question}</div>
          <Reveal r={r} name={char.name} small />
        </div>
      ))}
    </>
  );
};

const Reveal: React.FC<{ r: any; name: string; small?: boolean }> = ({ r, name, small }) => (
  <div className={small ? 'text-[11.5px]' : 'text-[13px]'}>
    <div className="grid grid-cols-2 gap-2">
      <div className="p-2 rounded-lg" style={{ background: T.bg }}><div className="text-[9.5px] opacity-60 mb-0.5">你</div>{r.mine}</div>
      <div className="p-2 rounded-lg" style={{ background: T.paper, color: T.paperInk }}><div className="text-[9.5px] opacity-60 mb-0.5">{name}</div>{r.his}</div>
    </div>
    {r.reaction && <div className="mt-1.5 italic opacity-80" style={{ fontFamily: serif }}>{name}：{r.reaction}</div>}
  </div>
);

/* ───────── 深夜点播 ───────── */

const RadioTab: React.FC<{ char: any; apiConfig: any; pieces: any[]; onErr: (e: any) => void }> = ({ char, apiConfig, pieces, onErr }) => {
  const [busy, setBusy] = useState<RadioChannel | null>(null);
  const [current, setCurrent] = useState<any>(pieces[0] || null);
  const play = (ch: RadioChannel) => {
    setBusy(ch);
    playRadio(char, apiConfig, ch).then(setCurrent).catch(onErr).finally(() => setBusy(null));
  };
  return (
    <div className="rounded-3xl p-4 -mx-1 min-h-full" style={{ background: 'linear-gradient(180deg,#2c3a50,#1f2a3b)', color: '#dfe8f5' }}>
      <div className="flex items-center gap-2 mb-3 opacity-80"><Radio size={16} /><span className="text-[11px] tracking-[0.3em]">LATE NIGHT · {char.name}</span></div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {RADIO_CHANNELS.map(ch => (
          <button key={ch.id} onClick={() => play(ch.id)} disabled={!!busy}
            className="p-2.5 rounded-2xl text-left active:scale-95 disabled:opacity-60"
            style={{ background: current?.channel === ch.id ? 'rgba(126,158,202,0.35)' : 'rgba(255,255,255,0.06)', border: '1px solid rgba(208,220,235,0.2)' }}>
            <div className="text-[12px] font-semibold">{busy === ch.id ? '调频中…' : ch.name}</div>
            <div className="text-[9.5px] opacity-60 mt-0.5 leading-snug">{ch.desc}</div>
          </button>
        ))}
      </div>
      {current ? (
        <div className="p-4 rounded-2xl mb-4" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[15px] font-semibold" style={{ fontFamily: serif }}>{current.title}</div>
            <button onClick={() => play(current.channel)} disabled={!!busy} className="opacity-60"><ArrowsClockwise size={15} /></button>
          </div>
          <div className="text-[13px] leading-[1.9] whitespace-pre-wrap" style={{ fontFamily: serif }}>{current.text}</div>
        </div>
      ) : <div className="text-center text-[11px] opacity-50 my-8">选一个频道，他就开始讲</div>}
      {pieces.filter(p => p.id !== current?.id).length > 0 && <div className="text-[10px] opacity-50 mb-2">以前点过的</div>}
      {pieces.filter(p => p.id !== current?.id).slice(0, 30).map(p => (
        <button key={p.id} onClick={() => setCurrent(p)} className="w-full text-left py-2 border-b flex items-center justify-between" style={{ borderColor: 'rgba(208,220,235,0.12)' }}>
          <span className="text-[12px] truncate">{p.title}</span>
          <span className="text-[9.5px] opacity-50 shrink-0 ml-2">{RADIO_CHANNELS.find(c => c.id === p.channel)?.name} · {new Date(p.createdAt).toLocaleDateString()}</span>
        </button>
      ))}
    </div>
  );
};

export default FootnoteApp;
