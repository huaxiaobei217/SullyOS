/**
 * 页脚 —— 便签墙 · 快问快答转盘 · 深夜点播机。旧信纸 + 墨水 + 烛光。
 * 逻辑见 utils/footnote.ts。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { CaretLeft, Star, Trash, ArrowsClockwise, Play, Pause, ArrowCounterClockwise, PencilSimple, ChatCircle, TextAa } from '@phosphor-icons/react';
import {
  loadFootnote, updateFootnote, FOOTNOTE_CHANGED_EVENT, dropCard, QA_BANK, generateQuestion, answerQuestion,
  RADIO_CHANNELS, playRadio, addUserNote, replyToNote, FOOT_FONTS, FOOT_TINTS, fontCss, tintOf, loadCharFont, saveCharFont,
  type FootCard, type RadioChannel, type RadioPiece,
} from '../utils/footnote';
import { synthesizeSpeech, characterHasVoice } from '../utils/ttsRouter';
import TokenImg from '../components/os/TokenImg';

const T = {
  ink: '#2f3442', soft: '#6f6a62', line: '#e4dccd', bg: '#f3eee6', candle: '#b9875a', candleSoft: '#f1e2cf',
  card: '#fffaf2', night1: '#1d2030', night2: '#11131b',
};
const serif = `'Noto Serif SC','Songti SC','Georgia',serif`;
const KIND_LABEL: Record<FootCard['kind'], string> = { note: '批注', excerpt: '摘录', frame: '截帧', memo: '纸条' };

/** 便签字体：Google Fonts 一次性挂上（中文字体按字切片，只下载用到的字） */
let fontsLoaded = false;
const ensureFonts = () => {
  if (fontsLoaded || typeof document === 'undefined') return;
  fontsLoaded = true;
  const fam = FOOT_FONTS.filter(f => f.google).map(f => `family=${f.google}`).join('&');
  const l1 = document.createElement('link');
  l1.rel = 'stylesheet';
  l1.href = `https://fonts.googleapis.com/css2?${fam}&family=Noto+Serif+SC:wght@400;600&display=swap`;
  document.head.appendChild(l1);
  const l2 = document.createElement('link');
  l2.rel = 'stylesheet';
  l2.href = 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css';
  document.head.appendChild(l2);
};

type Tab = 'wall' | 'qa' | 'radio';

const FootnoteApp: React.FC = () => {
  const { closeApp, characters, apiConfig, addToast } = useOS() as any;
  const [tab, setTab] = useState<Tab>('wall');
  const [store, setStore] = useState(() => loadFootnote());
  useEffect(() => { ensureFonts(); }, []);
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
  const night = tab === 'radio';

  return (
    <div className="h-full w-full flex flex-col transition-colors duration-500"
      style={{ background: night ? `linear-gradient(180deg, ${T.night1}, ${T.night2})` : T.bg, color: night ? '#e9e2d6' : T.ink }}>
      <div className="shrink-0 px-3 pb-2 flex items-center gap-2" style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}>
        <button onClick={closeApp} className="p-1.5 -ml-1 active:scale-90"><CaretLeft size={22} /></button>
        <div className="text-lg tracking-[0.35em] font-semibold" style={{ fontFamily: serif }}>页脚</div>
        <div className="flex-1" />
        {(characters || []).length > 1 && (
          <select value={charId} onChange={e => setCharId(e.target.value)}
            className="text-[11px] rounded-full px-2 py-1 outline-none bg-transparent" style={{ border: `1px solid ${night ? 'rgba(233,226,214,0.25)' : T.line}`, color: 'inherit' }}>
            {(characters || []).map((c: any) => <option key={c.id} value={c.id} style={{ color: T.ink }}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div className="shrink-0 mx-4 mb-2 flex justify-center gap-6 text-[13px]" style={{ fontFamily: serif }}>
        {([['wall', '便签墙'], ['qa', '快问快答'], ['radio', '深夜点播']] as [Tab, string][]).map(([k, n]) => (
          <button key={k} onClick={() => setTab(k)} className="pb-1 transition-opacity"
            style={{ opacity: tab === k ? 1 : 0.45, borderBottom: `1.5px solid ${tab === k ? T.candle : 'transparent'}` }}>{n}</button>
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

/* ───────── 便签墙 ───────── */

const Tape: React.FC<{ color: string; seed: number }> = ({ color, seed }) => (
  <div className="absolute left-1/2 -top-2.5 h-5 w-14 -translate-x-1/2"
    style={{
      background: `repeating-linear-gradient(45deg, ${color}, ${color} 4px, rgba(255,255,255,0.25) 4px, rgba(255,255,255,0.25) 8px)`,
      transform: `translateX(-50%) rotate(${(seed % 7) - 3}deg)`, boxShadow: '0 1px 1px rgba(0,0,0,0.05)',
      clipPath: 'polygon(3% 0, 97% 4%, 100% 100%, 0 96%)',
    }} />
);

const Wall: React.FC<{ char: any; apiConfig: any; cards: FootCard[]; onErr: (e: any) => void }> = ({ char, apiConfig, cards, onErr }) => {
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'his' | 'mine' | 'star'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState('');
  const [font, setFont] = useState(() => { try { return localStorage.getItem('sully_footnote_my_font_v1') || 'kai'; } catch { return 'kai'; } });
  const [tint, setTint] = useState('rose');
  const [charFont, setCharFontState] = useState(loadCharFont());
  const [replying, setReplying] = useState<string | null>(null);
  const [showFonts, setShowFonts] = useState(false);

  const drop = () => { setBusy(true); dropCard(char, apiConfig).then(c => setOpenId(c.id)).catch(onErr).finally(() => setBusy(false)); };
  const post = () => {
    if (!draft.trim()) return;
    try { localStorage.setItem('sully_footnote_my_font_v1', font); } catch { /* ignore */ }
    addUserNote(char.id, draft, font, tint); setDraft(''); setWriting(false);
  };
  const askReply = (id: string) => { setReplying(id); replyToNote(char, apiConfig, id).catch(onErr).finally(() => setReplying(null)); };

  const shown = cards.filter(c => filter === 'all' ? true : filter === 'star' ? c.starred : filter === 'mine' ? c.author === 'user' : c.author !== 'user');
  return (
    <>
      <div className="flex gap-2 mb-2">
        <button onClick={drop} disabled={busy} className="flex-1 py-2.5 rounded-xl text-[13px] active:scale-[0.98] disabled:opacity-60"
          style={{ background: T.card, border: `1px dashed ${T.line}`, fontFamily: serif }}>{busy ? `${char.name}在找笔…` : `${char.name}贴一张`}</button>
        <button onClick={() => setWriting(v => !v)} className="flex-1 py-2.5 rounded-xl text-[13px] active:scale-[0.98] text-white"
          style={{ background: T.candle, fontFamily: serif }}><PencilSimple size={13} className="inline -mt-0.5 mr-1" />我写一张</button>
        <button onClick={() => setShowFonts(v => !v)} className="px-3 rounded-xl" style={{ background: T.card, border: `1px solid ${T.line}` }}><TextAa size={16} /></button>
      </div>

      {showFonts && (
        <div className="mb-3 p-3 rounded-xl text-[11px]" style={{ background: T.card, border: `1px solid ${T.line}` }}>
          <div className="mb-1.5 opacity-70">{char.name}写字用的字体</div>
          <div className="flex flex-wrap gap-1.5">
            {FOOT_FONTS.map(f => (
              <button key={f.id} onClick={() => { saveCharFont(f.id); setCharFontState(f.id); }}
                className="px-2.5 py-1 rounded-full" style={{ fontFamily: f.css, fontSize: 14, background: charFont === f.id ? T.candleSoft : 'transparent', border: `1px solid ${charFont === f.id ? T.candle : T.line}` }}>{f.name}</button>
            ))}
          </div>
          <div className="mt-1.5 opacity-50">只影响之后新贴的纸条。</div>
        </div>
      )}

      {writing && (
        <div className="relative mb-4 mt-3 p-4 pt-5 rounded-sm shadow-md" style={{ background: tintOf(tint).paper }}>
          <Tape color={tintOf(tint).tape} seed={3} />
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} autoFocus placeholder={`写给${char.name}…`}
            className="w-full bg-transparent outline-none resize-none leading-relaxed" style={{ fontFamily: fontCss(font), fontSize: 18, color: T.ink }} />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {FOOT_FONTS.map(f => (
              <button key={f.id} onClick={() => setFont(f.id)} className="px-2 py-0.5 rounded-full"
                style={{ fontFamily: f.css, fontSize: 13, background: font === f.id ? 'rgba(0,0,0,0.08)' : 'transparent', border: `1px solid ${font === f.id ? T.ink : 'rgba(0,0,0,0.1)'}` }}>{f.name}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2.5">
            {FOOT_TINTS.map(t => (
              <button key={t.id} onClick={() => setTint(t.id)} className="w-6 h-6 rounded-full"
                style={{ background: t.paper, border: `2px solid ${tint === t.id ? T.ink : 'rgba(0,0,0,0.12)'}` }} />
            ))}
            <div className="flex-1" />
            <button onClick={post} disabled={!draft.trim()} className="px-4 py-1.5 rounded-full text-[12px] text-white disabled:opacity-40" style={{ background: T.ink }}>贴上去</button>
          </div>
        </div>
      )}

      <div className="flex gap-3 mb-3 text-[11px]" style={{ color: T.soft }}>
        {([['all', '全部'], ['his', `${char.name}的`], ['mine', '我的'], ['star', '收藏']] as const).map(([k, n]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ color: filter === k ? T.ink : undefined, fontWeight: filter === k ? 600 : 400 }}>{n}</button>
        ))}
      </div>

      {!shown.length && <div className="text-center text-[11px] opacity-50 mt-8">墙上还空着</div>}
      <div className="columns-2 gap-4 pt-2">
        {shown.map((c, i) => {
          const tn = tintOf(c.tint);
          const mine = c.author === 'user';
          return (
            <div key={c.id} onClick={() => setOpenId(openId === c.id ? null : c.id)}
              className="relative break-inside-avoid mb-5 p-3 pt-4 cursor-pointer"
              style={{ background: tn.paper, boxShadow: '0 2px 6px rgba(60,45,30,0.10)', transform: `rotate(${((i * 37) % 7) - 3}deg)`, borderRadius: 2 }}>
              <Tape color={tn.tape} seed={i * 13 + 5} />
              <div className="flex items-center justify-between mb-1 text-[9px]" style={{ color: T.soft }}>
                <span>{mine ? '我' : KIND_LABEL[c.kind]}</span>
                {c.starred && <Star size={10} weight="fill" color={T.candle} />}
              </div>
              {c.quote && <div className="text-[11px] leading-relaxed italic mb-1.5" style={{ color: T.soft, fontFamily: serif }}>{c.kind === 'frame' ? c.quote : `「${c.quote}」`}</div>}
              <div className="leading-relaxed" style={{ fontFamily: fontCss(c.font), fontSize: 16, color: T.ink }}>{c.note}</div>
              {c.source && <div className="text-[9.5px] mt-1.5 opacity-60" style={{ fontFamily: serif }}>—— {c.source}</div>}
              {c.reply && (
                <div className="mt-2 pt-1.5 border-t border-dashed" style={{ borderColor: 'rgba(0,0,0,0.12)' }}>
                  <span className="text-[9px] opacity-50 mr-1">{mine ? `${char.name}：` : '↳'}</span>
                  <span style={{ fontFamily: fontCss(charFont), fontSize: 14 }}>{c.reply}</span>
                </div>
              )}
              {replying === c.id && <div className="mt-1.5 text-[10px] opacity-60">{char.name}在写…</div>}
              {openId === c.id && (
                <div className="flex flex-wrap justify-end gap-3 mt-2 pt-1.5" onClick={e => e.stopPropagation()}>
                  <button onClick={() => askReply(c.id)} disabled={!!replying} className="text-[10px] flex items-center gap-0.5" style={{ color: T.candle }}><ChatCircle size={12} />{c.reply ? '再回一句' : '等他回'}</button>
                  <button onClick={() => updateFootnote(s => ({ ...s, cards: s.cards.map(x => x.id === c.id ? { ...x, starred: !x.starred } : x) }))}
                    className="text-[10px] flex items-center gap-0.5" style={{ color: T.candle }}><Star size={12} weight={c.starred ? 'fill' : 'regular'} />{c.starred ? '取消' : '收藏'}</button>
                  <button onClick={() => updateFootnote(s => ({ ...s, cards: s.cards.filter(x => x.id !== c.id) }))}
                    className="text-[10px] flex items-center gap-0.5 text-rose-400"><Trash size={12} />撕掉</button>
                </div>
              )}
            </div>
          );
        })}
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
    const started = Date.now();
    let next: { text: string; fromBank: boolean };
    try {
      if (Math.random() < 0.5) {
        const used = new Set(rounds.slice(0, 30).map(r => r.question));
        const pool = QA_BANK.filter(x => !used.has(x));
        const src = pool.length ? pool : QA_BANK;
        next = { text: src[Math.floor(Math.random() * src.length)], fromBank: true };
      } else next = { text: await generateQuestion(char, apiConfig), fromBank: false };
    } catch (e) {
      next = { text: QA_BANK[Math.floor(Math.random() * QA_BANK.length)], fromBank: true };
      onErr(e);
    }
    setTimeout(() => { setQ(next); setSpinning(false); }, Math.max(0, 1600 - (Date.now() - started)));
  };
  const reveal = () => {
    if (!q || !mine.trim()) return;
    setRevealing(true);
    answerQuestion(char, apiConfig, q.text, mine.trim(), q.fromBank).then(setResult).catch(onErr).finally(() => setRevealing(false));
  };
  const slices = ['#f1e2cf', '#fbf5e6', '#e9e0d2', '#f6ece0'];

  return (
    <>
      <div className="flex flex-col items-center mt-2 mb-4">
        <div className="relative w-40 h-40">
          <div className="absolute left-1/2 -top-1 -translate-x-1/2 z-10 w-0 h-0" style={{ borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderTop: `12px solid ${T.ink}` }} />
          <div className="w-full h-full rounded-full"
            style={{
              transform: `rotate(${angle}deg)`, transition: 'transform 1.6s cubic-bezier(.17,.67,.3,1)',
              background: `conic-gradient(${Array.from({ length: 8 }, (_, i) => `${slices[i % 4]} ${i * 45}deg ${(i + 1) * 45}deg`).join(',')})`,
              border: `2px solid ${T.ink}`, boxShadow: '0 4px 14px rgba(60,45,30,0.12)',
            }}>
            <div className="absolute inset-0 m-auto w-10 h-10 rounded-full flex items-center justify-center" style={{ background: T.card, border: `1.5px solid ${T.ink}` }}>
              <span className="text-[10px] font-bold" style={{ fontFamily: serif }}>问</span>
            </div>
          </div>
        </div>
        <button onClick={spin} disabled={spinning || revealing} className="mt-3 px-6 py-2 rounded-full text-sm text-white active:scale-95 disabled:opacity-60"
          style={{ background: T.ink, fontFamily: serif }}>{spinning ? '转呀转…' : q ? '再转一次' : '转一下'}</button>
      </div>

      {q && (
        <div className="p-4 rounded-2xl mb-4" style={{ background: T.card, border: `1px solid ${T.line}` }}>
          <div className="text-[10px] mb-1" style={{ color: T.candle }}>{q.fromBank ? '题库' : `${char.name}现场出的题`}</div>
          <div className="text-[15px] font-semibold leading-relaxed mb-3" style={{ fontFamily: serif }}>{q.text}</div>
          {!result ? (
            <>
              <textarea value={mine} onChange={e => setMine(e.target.value)} rows={2} placeholder="你的答案（揭晓时才一起翻开）"
                className="w-full text-[13px] p-2.5 rounded-xl outline-none resize-none" style={{ background: T.bg }} />
              <button onClick={reveal} disabled={!mine.trim() || revealing} className="mt-2 w-full py-2 rounded-xl text-sm text-white disabled:opacity-50" style={{ background: T.candle }}>
                {revealing ? `${char.name}在想…` : '一起揭晓'}
              </button>
            </>
          ) : <Reveal r={result} name={char.name} />}
        </div>
      )}

      {rounds.length > 0 && <div className="text-[11px] mb-2 opacity-60">以前答过的</div>}
      {rounds.filter(r => r.id !== result?.id).slice(0, 30).map(r => (
        <div key={r.id} className="p-3 rounded-2xl mb-2" style={{ background: 'rgba(255,250,242,0.7)', border: `1px solid ${T.line}` }}>
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
      <div className="p-2 rounded-lg" style={{ background: T.candleSoft }}><div className="text-[9.5px] opacity-60 mb-0.5">{name}</div>{r.his}</div>
    </div>
    {r.reaction && <div className="mt-1.5 italic opacity-80" style={{ fontFamily: serif }}>{name}：{r.reaction}</div>}
  </div>
);

/* ───────── 深夜点播：一句一句冒出来的电台气泡 + 他的声音 ───────── */

const splitSegments = (text: string): string[] => {
  const out: string[] = [];
  for (const para of text.split(/\n+/).map(s => s.trim()).filter(Boolean)) {
    if (para.length <= 120) { out.push(para); continue; }
    let buf = '';
    for (const piece of para.split(/(?<=[。！？!?…])/)) {
      if ((buf + piece).length > 120 && buf) { out.push(buf); buf = ''; }
      buf += piece;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
};
const displayText = (s: string) => s.replace(/\[[^\]]{1,24}\]/g, '').replace(/\s{2,}/g, ' ').trim();

const RadioTab: React.FC<{ char: any; apiConfig: any; pieces: RadioPiece[]; onErr: (e: any) => void }> = ({ char, apiConfig, pieces, onErr }) => {
  const [busy, setBusy] = useState<RadioChannel | null>(null);
  const [current, setCurrent] = useState<RadioPiece | null>(pieces[0] || null);
  const [shown, setShown] = useState(0);
  const [speaking, setSpeaking] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const hasVoice = useMemo(() => { try { return characterHasVoice(char, apiConfig); } catch { return false; } }, [char, apiConfig]);
  const segs = useMemo(() => current ? splitSegments(current.text) : [], [current]);
  const runRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlCache = useRef<Map<string, Promise<string | null>>>(new Map());
  const pausedRef = useRef(false);
  const idxRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const warned = useRef(false);

  const stopAll = () => { runRef.current++; pausedRef.current = false; audioRef.current?.pause(); audioRef.current = null; setPlaying(false); setSpeaking(-1); };
  useEffect(() => () => stopAll(), []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [shown]);

  const tts = (piece: RadioPiece, i: number, text: string) => {
    const key = `${piece.id}:${i}`;
    if (!urlCache.current.has(key)) {
      urlCache.current.set(key, synthesizeSpeech(text, char, apiConfig).catch(e => {
        if (!warned.current) { warned.current = true; onErr(new Error(`语音没合成出来，先用文字播：${e?.message || e}`)); }
        return null;
      }));
    }
    return urlCache.current.get(key)!;
  };

  const run = async (piece: RadioPiece, from: number) => {
    const my = ++runRef.current;
    const list = splitSegments(piece.text);
    pausedRef.current = false;
    setPlaying(true);
    const useVoice = voiceOn && hasVoice;
    for (let i = from; i < list.length; i++) {
      if (runRef.current !== my) return;
      idxRef.current = i;
      const url = useVoice ? await tts(piece, i, list[i]) : null;
      if (useVoice && i + 1 < list.length) void tts(piece, i + 1, list[i + 1]);
      if (runRef.current !== my) return;
      setShown(s => Math.max(s, i + 1));
      setSpeaking(i);
      if (url) {
        await new Promise<void>(resolve => {
          const a = new Audio(url);
          audioRef.current = a;
          a.onended = () => resolve();
          a.onerror = () => resolve();
          a.play().catch(() => resolve());
        });
      } else {
        await new Promise(r => setTimeout(r, Math.min(9000, 900 + displayText(list[i]).length * 160)));
      }
      while (pausedRef.current && runRef.current === my) await new Promise(r => setTimeout(r, 200));
    }
    if (runRef.current === my) { setPlaying(false); setSpeaking(-1); }
  };

  const startPiece = (p: RadioPiece) => { stopAll(); setPaused(false); setCurrent(p); setShown(0); setTimeout(() => run(p, 0), 50); };
  const play = (ch: RadioChannel) => {
    stopAll(); setBusy(ch);
    playRadio(char, apiConfig, ch).then(startPiece).catch(onErr).finally(() => setBusy(null));
  };
  const [paused, setPaused] = useState(false);
  const togglePause = () => {
    if (!current) return;
    if (!playing) {
      const from = shown > 0 && shown < segs.length ? shown : 0;
      if (from === 0) setShown(0);
      setPaused(false);
      run(current, from);
      return;
    }
    if (pausedRef.current) { pausedRef.current = false; setPaused(false); audioRef.current?.play().catch(() => {}); }
    else { pausedRef.current = true; setPaused(true); audioRef.current?.pause(); }
  };
  const isPaused = playing && paused;

  return (
    <div className="pt-1">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${playing && !isPaused ? 'animate-pulse' : ''}`} style={{ background: playing ? '#e0605a' : 'rgba(233,226,214,0.3)' }} />
        <span className="text-[10px] tracking-[0.35em] opacity-70">{playing ? 'ON AIR' : 'OFF AIR'} · {char.name}</span>
        <div className="flex-1" />
        {hasVoice ? (
          <button onClick={() => setVoiceOn(v => !v)} className="text-[10px] px-2 py-0.5 rounded-full" style={{ border: '1px solid rgba(233,226,214,0.25)', opacity: voiceOn ? 1 : 0.5 }}>
            {voiceOn ? '他的声音 · 开' : '只看文字'}
          </button>
        ) : <span className="text-[10px] opacity-50">没配语音，只有文字</span>}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {RADIO_CHANNELS.map(ch => (
          <button key={ch.id} onClick={() => play(ch.id)} disabled={!!busy}
            className="p-2.5 rounded-2xl text-left active:scale-95 disabled:opacity-60"
            style={{ background: current?.channel === ch.id ? 'rgba(185,135,90,0.28)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(233,226,214,0.14)' }}>
            <div className="text-[12px] font-semibold" style={{ fontFamily: serif }}>{busy === ch.id ? '调频中…' : ch.name}</div>
            <div className="text-[9.5px] opacity-55 mt-0.5 leading-snug">{ch.desc}</div>
          </button>
        ))}
      </div>

      {current ? (
        <div className="rounded-3xl p-3.5 mb-4" style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(233,226,214,0.08)' }}>
          <div className="flex items-center gap-2 mb-3">
            {char.avatar && <TokenImg value={char.avatar} alt="" className="w-7 h-7 rounded-full object-cover" style={{ boxShadow: playing && !isPaused ? `0 0 0 2px ${T.candle}` : 'none' }} />}
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold truncate" style={{ fontFamily: serif }}>{current.title}</div>
              <div className="text-[9.5px] opacity-50">{RADIO_CHANNELS.find(c => c.id === current.channel)?.name}</div>
            </div>
            <div className="flex items-end gap-[2px] h-4 mr-1">
              {[0, 1, 2, 3].map(b => (
                <span key={b} className="w-[3px] rounded-sm" style={{
                  background: T.candle, height: playing && !isPaused ? undefined : 3,
                  animation: playing && !isPaused ? `footEq 0.${6 + b}s ease-in-out ${b * 0.1}s infinite alternate` : 'none',
                }} />
              ))}
            </div>
            <button onClick={togglePause} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: T.candle, color: '#fff' }}>
              {playing && !isPaused ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
            </button>
            <button onClick={() => startPiece(current)} className="opacity-60 p-1"><ArrowCounterClockwise size={15} /></button>
          </div>
          <style>{`@keyframes footEq { from { height: 3px } to { height: 16px } } @keyframes footIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }`}</style>
          <div className="space-y-2">
            {segs.slice(0, Math.max(shown, playing ? 0 : segs.length)).map((s, i) => (
              <div key={i} className="max-w-[88%] px-3 py-2 rounded-2xl rounded-tl-md text-[13.5px] leading-[1.8]"
                style={{
                  fontFamily: serif, animation: 'footIn .45s ease-out',
                  background: i === speaking ? 'rgba(185,135,90,0.22)' : 'rgba(255,255,255,0.06)',
                  transition: 'background .4s',
                }}>{displayText(s)}</div>
            ))}
            {playing && shown < segs.length && (
              <div className="w-12 px-3 py-2 rounded-2xl rounded-tl-md flex gap-1" style={{ background: 'rgba(255,255,255,0.06)' }}>
                {[0, 1, 2].map(d => <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'rgba(233,226,214,0.6)', animationDelay: `${d * 0.15}s` }} />)}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      ) : <div className="text-center text-[11px] opacity-50 my-10" style={{ fontFamily: serif }}>拧一个频道，他就开始讲</div>}

      {pieces.filter(p => p.id !== current?.id).length > 0 && <div className="text-[10px] opacity-45 mb-2">以前点过的</div>}
      {pieces.filter(p => p.id !== current?.id).slice(0, 30).map(p => (
        <button key={p.id} onClick={() => startPiece(p)} className="w-full text-left py-2 border-b flex items-center justify-between" style={{ borderColor: 'rgba(233,226,214,0.08)' }}>
          <span className="text-[12px] truncate" style={{ fontFamily: serif }}>{p.title}</span>
          <span className="text-[9.5px] opacity-45 shrink-0 ml-2">{RADIO_CHANNELS.find(c => c.id === p.channel)?.name} · {new Date(p.createdAt).toLocaleDateString()}</span>
        </button>
      ))}
      <div className="text-center mt-4">
        <button onClick={() => current && play(current.channel)} disabled={!!busy || !current} className="text-[10px] opacity-50 inline-flex items-center gap-1"><ArrowsClockwise size={11} />同频道再来一段</button>
      </div>
    </div>
  );
};

export default FootnoteApp;
