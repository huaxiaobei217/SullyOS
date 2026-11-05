/**
 * 书影架 · 一起看书
 * 书架 → 阅读（他在你读过的地方画线写批注）→ 伴读小窗（你吐槽，他回；他的话可以用他的声音念外语版）
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import type { CharacterProfile } from '../types';
import {
  loadShelf, SHELF_EVENT, importBook, loadChapters, deleteBook, savePosition, annotateChapter, chatAboutBook, toggleAutoNote,
  summarizeChapter, addReadingSeconds, markFinishedIfDone, loadStats, readingStreak, fmtMinutes, dayKeyOf, shareShelfNote, shareShelfTalk,
  type ShelfBook, type ShelfChapter, type ShelfNote, type ShelfChat,
} from '../utils/shelf';
import { synthesizeSpeech, characterHasVoice } from '../utils/ttsRouter';
import { voiceLanguageLabel } from '../utils/voiceLanguage';
import TokenImg from '../components/os/TokenImg';
import { useReadAloud, readAloudSupported } from '../hooks/useReadAloud';
import { loadVocab, VOCAB_EVENT, addVocab, removeVocab, hasVocab, tokenize, isLatinText, lookupWord, sentenceOf, type VocabItem } from '../utils/shelfVocab';

const T = {
  paper: '#f6f1e7', paperDeep: '#ece4d3', ink: '#2f2a24', muted: '#8a7f70', faint: '#b9ae9c',
  line: '#d9cfbd', accent: '#7a4e3a', pencil: '#5b6b7a', mine: '#4f6b58',
};
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const FONT_KEY = 'sully_shelf_font_v1';
const FLIP_KEY = 'sully_shelf_flip_v1';
const GAP = 48;

const useShelf = () => {
  const [s, set] = useState(loadShelf());
  useEffect(() => { const h = () => set(loadShelf()); window.addEventListener(SHELF_EVENT, h); return () => window.removeEventListener(SHELF_EVENT, h); }, []);
  return s;
};

/* 一段正文：把他画线的那一小段标出来，后面跟编号 */
const Para: React.FC<{ text: string; notes: { n: number; note: ShelfNote }[]; onNote: (n: ShelfNote) => void; onTap: () => void; size: number }> = ({ text, notes, onNote, onTap, size }) => {
  const parts: React.ReactNode[] = [];
  const marks = notes.map(x => ({ ...x, at: x.note.quote ? text.indexOf(x.note.quote) : -1 })).sort((a, b) => a.at - b.at);
  let cur = 0;
  const tail: React.ReactNode[] = [];
  for (const m of marks) {
    const badge = <sup key={`b${m.note.id}`} onClick={e => { e.stopPropagation(); onNote(m.note); }} className="cursor-pointer select-none ml-0.5" style={{ color: T.pencil, fontSize: '0.8em' }}>{CIRCLED[m.n] || `(${m.n + 1})`}</sup>;
    if (m.at >= cur && m.note.quote) {
      parts.push(text.slice(cur, m.at));
      parts.push(<span key={m.note.id} onClick={e => { e.stopPropagation(); onNote(m.note); }} style={{ textDecoration: 'underline wavy', textDecorationColor: T.pencil, textUnderlineOffset: '4px', textDecorationThickness: '1px' }}>{m.note.quote}</span>);
      parts.push(badge);
      cur = m.at + m.note.quote.length;
    } else tail.push(badge);
  }
  parts.push(text.slice(cur));
  return (
    <p onClick={onTap} className="mb-3 leading-[1.95] text-justify" style={{ fontSize: size, textIndent: '2em', color: T.ink, borderLeft: notes.length && marks.every(m => m.at < 0) ? `2px solid ${T.pencil}55` : undefined, paddingLeft: notes.length && marks.every(m => m.at < 0) ? 6 : 0 }}>
      {parts}{tail}
    </p>
  );
};

const ShelfApp: React.FC = () => {
  const { closeApp, characters, activeCharacterId, apiConfig, userProfile, addToast } = useOS() as any;
  const store = useShelf();
  const [charId, setCharId] = useState<string>(() => (characters.find((c: any) => /诺亚|Noah/i.test(c.name)) || characters.find((c: any) => c.id === activeCharacterId) || characters[0])?.id || '');
  const char: CharacterProfile | undefined = characters.find((c: any) => c.id === charId);
  const [bookId, setBookId] = useState<string | null>(null);
  const book = store.books.find(b => b.id === bookId) || null;
  const [chapters, setChapters] = useState<ShelfChapter[]>([]);
  const [ch, setCh] = useState(0);
  const [size, setSize] = useState(() => { try { return Number(localStorage.getItem(FONT_KEY)) || 17; } catch { return 17; } });
  const [showToc, setShowToc] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [openNote, setOpenNote] = useState<ShelfNote | null>(null);
  const [tapped, setTapped] = useState<number | null>(null);
  const [quote, setQuote] = useState('');
  const [say, setSay] = useState('');
  const [busy, setBusy] = useState('');
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const paraRefs = useRef<(HTMLParagraphElement | HTMLDivElement | null)[]>([]);
  /* 翻页模式：书页按屏幕分栏，左右翻 */
  const [flip, setFlip] = useState(() => { try { return localStorage.getItem(FLIP_KEY) !== '0'; } catch { return true; } });
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const pageBoxRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<'pos' | 'last' | null>('pos');
  const touchRef = useRef<{ x: number; y: number; t: number; lock?: 'h' | 'v' } | null>(null);
  /* 沉浸式翻页：手指拖着走、松手吸附；中间点一下呼出菜单 */
  const [bars, setBars] = useState(false);
  const [dx, setDx] = useState(0);
  const [anim, setAnim] = useState(true);
  const [menuAt, setMenuAt] = useState<{ i: number; top: number } | null>(null);
  const turningRef = useRef(false);
  const enterRef = useRef(false);
  const suppressClick = useRef(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceCache = useRef(new Map<string, Promise<string | null>>());
  const [playing, setPlaying] = useState('');
  /* 生词本 */
  const [vocab, setVocab] = useState<VocabItem[]>(loadVocab());
  useEffect(() => { const h = () => setVocab(loadVocab()); window.addEventListener(VOCAB_EVENT, h); return () => window.removeEventListener(VOCAB_EVENT, h); }, []);
  const [vocabPara, setVocabPara] = useState<number | null>(null);
  const [lookup, setLookup] = useState<{ word: string; sentence: string; res?: { phonetic?: string; meaning: string; note?: string }; err?: string } | null>(null);
  const [showVocab, setShowVocab] = useState(false);
  const userName = userProfile?.name || '我';
  const lang = char?.callVoiceLang || 'en';
  const hasVoice = !!char && characterHasVoice(char, apiConfig);

  /* 打开一本书 */
  useEffect(() => {
    if (!bookId) return;
    let alive = true;
    loadChapters(bookId).then(cs => {
      if (!alive) return;
      setChapters(cs);
      const b = loadShelf().books.find(x => x.id === bookId);
      setCh(b?.pos.ch || 0);
      restoreRef.current = 'pos';
      try { if (flip && !localStorage.getItem('sully_shelf_flip_hint_v2')) { localStorage.setItem('sully_shelf_flip_hint_v2', '1'); addToast?.('左右滑或点两边翻页，中间点一下出菜单，长按一段跟他吐槽', 'info'); } } catch { /* ignore */ }
      if (!flip) setTimeout(() => { paraRefs.current[b?.pos.para || 0]?.scrollIntoView({ block: 'start' }); }, 60);
    });
    return () => { alive = false; };
  }, [bookId]);

  /* 读书时长：打开着、最近 90 秒内有翻动或点按，就每 15 秒记一次 */
  const lastActive = useRef(Date.now());
  useEffect(() => {
    if (!bookId) return;
    lastActive.current = Date.now();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastActive.current < 90_000) addReadingSeconds(bookId, 15);
    }, 15_000);
    return () => clearInterval(t);
  }, [bookId]);

  /* 记进度：最上面那段；读到章末自动请他批注 */
  const lastSaved = useRef(0);
  const onScroll = () => {
    lastActive.current = Date.now();
    if (!book || !scrollRef.current) return;
    const top = scrollRef.current.getBoundingClientRect().top + 60;
    const bottom = scrollRef.current.getBoundingClientRect().bottom;
    let first = 0; let lastVisible = 0;
    paraRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top <= top) first = i;
      if (r.top < bottom) lastVisible = i;
    });
    if (Date.now() - lastSaved.current > 800) {
      lastSaved.current = Date.now();
      savePosition(book.id, ch, Math.max(first, Math.min(lastVisible, (chapters[ch]?.paras.length || 1) - 1)));
    }
    const atEnd = lastVisible >= (chapters[ch]?.paras.length || 0);
    if (atEnd) finishChapter();
  };

  /** 读完这章：记进度；开了自动批注、这章还没批注过、篇幅够长，就请他写 */
  const finishChapter = () => {
    if (!book) return;
    savePosition(book.id, ch, Math.max(0, (chapters[ch]?.paras.length || 1) - 1));
    markFinishedIfDone(book.id);
    const long = (chapters[ch]?.paras.join('').length || 0) >= 200;
    if (!long) return;
    if (store.autoNote && char && !book.annotatedChapters?.includes(ch) && !busy) runAnnotate();
    // 没开自动批注：悄悄写一段这章的梗概，伴读时他记得前情（批注那次会顺手写，所以只在不批注时单独写）
    else if (!store.autoNote && !store.outlines[book.id]?.[ch]) summarizeChapter(apiConfig, book, ch).catch(() => {});
  };

  const share = async (fn: () => Promise<void>) => {
    try { await fn(); addToast?.('发到聊天了', 'success'); } catch (e: any) { addToast?.(`没发出去：${e?.message || e}`, 'error'); }
  };

  const runAnnotate = async (upTo?: number) => {
    if (!book || !char) return;
    setBusy(`${char.name}在页边写批注…`);
    try {
      const notes = await annotateChapter(char, apiConfig, userName, book, ch, upTo);
      addToast?.(`${char.name}画了 ${notes.length} 处`, 'success');
    } catch (e: any) { addToast?.(`批注没写成：${e?.message || e}`, 'error'); }
    setBusy('');
  };

  const send = async () => {
    if (!book || !char || !say.trim() || busy) return;
    const text = say.trim(); setSay('');
    setBusy(`${char.name}在想…`);
    try {
      const pos = loadShelf().books.find(b => b.id === book.id)?.pos || { ch, para: 0 };
      await chatAboutBook(char, apiConfig, userName, book, ch, pos.ch === ch ? pos.para : 0, text, quote || undefined);
      setQuote('');
    } catch (e: any) { addToast?.(`没回上：${e?.message || e}`, 'error'); setSay(text); }
    setBusy('');
  };
  useEffect(() => { if (showChat) chatEnd.current?.scrollIntoView({ block: 'end' }); }, [showChat, store.chat.length]);

  const play = async (id: string, text: string) => {
    if (!char || !text) return;
    audioRef.current?.pause();
    if (playing === id) { setPlaying(''); return; }
    if (!voiceCache.current.has(id)) {
      voiceCache.current.set(id, synthesizeSpeech(text, char, apiConfig, lang ? { languageBoost: lang } : undefined).catch((e: any) => { addToast?.(`语音没合成出来：${e?.message || e}`, 'error'); return null; }));
    }
    setPlaying(id);
    const url = await voiceCache.current.get(id)!;
    if (!url) { setPlaying(''); return; }
    const a = new Audio(url); audioRef.current = a;
    a.onended = () => setPlaying(''); a.play().catch(() => setPlaying(''));
  };

  const chapterNotes = useMemo(() => {
    if (!book) return [] as ShelfNote[];
    return store.notes.filter(n => n.bookId === book.id && n.ch === ch && n.charId === charId)
      .sort((a, b) => a.para - b.para || (chapters[ch]?.paras[a.para]?.indexOf(a.quote) ?? 0) - (chapters[ch]?.paras[b.para]?.indexOf(b.quote) ?? 0));
  }, [store.notes, book, ch, charId, chapters]);
  const notesByPara = useMemo(() => {
    const m = new Map<number, { n: number; note: ShelfNote }[]>();
    chapterNotes.forEach((note, n) => { const arr = m.get(note.para) || []; arr.push({ n, note }); m.set(note.para, arr); });
    return m;
  }, [chapterNotes]);
  const chat = book ? store.chat.filter(c => c.bookId === book.id && c.charId === charId) : [];

  const doLookup = async (word: string, para: string) => {
    const sentence = sentenceOf(para, word);
    setLookup({ word, sentence });
    try { const res = await lookupWord(apiConfig, word, sentence); setLookup(l => l && l.word === word ? { ...l, res } : l); }
    catch (e: any) { setLookup(l => l && l.word === word ? { ...l, err: e?.message || '没查到' } : l); }
  };

  const goChapter = (i: number) => {
    if (!book || i < 0 || i >= chapters.length) return;
    setAnim(false); setDx(0); setMenuAt(null);
    setCh(i); setShowToc(false); setTapped(null);
    savePosition(book.id, i, 0);
    setTimeout(() => scrollRef.current?.scrollTo({ top: 0 }), 30);
    setPage(0);
  };

  /* ───── 翻页 ───── */
  useEffect(() => {
    const el = pageBoxRef.current;
    if (!el || !flip) return;
    const measure = () => { const cs = getComputedStyle(el); setBox({ w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) }); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [flip, bookId, chapters.length]);

  const pageOf = (i: number) => { const el = paraRefs.current[i] as HTMLElement | null; return el && box.w ? Math.floor((el.offsetLeft + 4) / (box.w + GAP)) : 0; };

  useEffect(() => {
    if (!flip || !colRef.current || !box.w || !chapters[ch]) return;
    const raf = requestAnimationFrame(() => {
      const n = Math.max(1, Math.round((colRef.current!.scrollWidth + GAP) / (box.w + GAP)));
      setPages(n);
      if (restoreRef.current === 'pos') {
        const b = loadShelf().books.find(x => x.id === bookId);
        setPage(b && b.pos.ch === ch ? Math.min(n - 1, pageOf(b.pos.para)) : 0);
      } else if (restoreRef.current === 'last') setPage(n - 1);
      else setPage(p => Math.min(p, n - 1));
      restoreRef.current = null;
      if (enterRef.current) {
        enterRef.current = false;
        requestAnimationFrame(() => requestAnimationFrame(() => { setAnim(true); setDx(0); turningRef.current = false; }));
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flip, box.w, box.h, ch, chapters, size, store.notes.length]);

  const savePagePos = (pg: number) => {
    if (!book) return;
    let first = 0;
    for (let i = 0; i < (chapters[ch]?.paras.length || 0); i++) { if (pageOf(i) <= pg) first = i; else break; }
    savePosition(book.id, ch, first);
  };
  const stride = () => box.w + GAP;
  /** 换章：当前页先滑出去，新章从另一边滑进来 */
  const crossChapter = (dir: 1 | -1) => {
    if (!book || turningRef.current) return;
    const target = ch + dir;
    if (target < 0 || target >= chapters.length) { setAnim(true); setDx(0); if (dir > 0) finishChapter(); return; }
    turningRef.current = true;
    setAnim(true); setDx(-dir * stride());
    setTimeout(() => {
      if (dir > 0) { finishChapter(); restoreRef.current = null; }
      else restoreRef.current = 'last';
      setAnim(false); setDx(dir * stride());
      setCh(target); savePosition(book.id, target, 0); if (dir > 0) setPage(0);
      enterRef.current = true;
      // 兜底：万一排版没触发，也别卡在半路
      setTimeout(() => { if (enterRef.current) { enterRef.current = false; setAnim(true); setDx(0); turningRef.current = false; } }, 700);
    }, 200);
  };
  const turn = (dir: 1 | -1) => {
    lastActive.current = Date.now();
    setTapped(null); setMenuAt(null);
    if (!book) return;
    const next = page + dir;
    if (next >= pages || next < 0) { crossChapter(dir); return; }
    setAnim(true); setDx(0); setPage(next);
    savePagePos(next);
    if (next === pages - 1) finishChapter();
  };

  const onBoxClick = (e: React.MouseEvent) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (menuAt) { setMenuAt(null); setTapped(null); return; }
    const r = pageBoxRef.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (bars) { setBars(false); return; }
    if (x < 0.3) turn(-1); else if (x > 0.7) turn(1); else setBars(true);
  };
  const onTouchStart = (e: React.TouchEvent) => { const t = e.touches[0]; touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now() }; setAnim(false); };
  const onTouchMove = (e: React.TouchEvent) => {
    const s0 = touchRef.current; if (!s0 || turningRef.current) return;
    const t = e.touches[0]; const mx = t.clientX - s0.x; const my = t.clientY - s0.y;
    if (!s0.lock) { if (Math.abs(mx) > 8 || Math.abs(my) > 8) s0.lock = Math.abs(mx) > Math.abs(my) ? 'h' : 'v'; else return; }
    if (s0.lock !== 'h') return;
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    // 第一章第一页往右拖、最后一章最后一页往左拖：有阻力
    const atStart = page === 0 && ch === 0 && mx > 0;
    const atEnd = page === pages - 1 && ch === chapters.length - 1 && mx < 0;
    setDx(atStart || atEnd ? mx * 0.25 : mx);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s0 = touchRef.current; touchRef.current = null;
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    if (!s0 || turningRef.current) { setAnim(true); return; }
    const t = e.changedTouches[0];
    const mx = t.clientX - s0.x; const dt = Math.max(1, Date.now() - s0.t);
    if (s0.lock === 'h') {
      suppressClick.current = true;
      const v = mx / dt; // px/ms
      const go = Math.abs(mx) > box.w * 0.2 || (Math.abs(mx) > 24 && Math.abs(v) > 0.35);
      setAnim(true);
      if (go) turn(mx < 0 ? 1 : -1); else setDx(0);
    } else setAnim(true);
  };
  const openMenu = (i: number) => {
    const el = paraRefs.current[i] as HTMLElement | null; const root = pageBoxRef.current;
    if (!el || !root) { setTapped(i); return; }
    const r = el.getBoundingClientRect(); const rr = root.getBoundingClientRect();
    const top = Math.max(r.top, rr.top) - rr.top;
    setTapped(i); setMenuAt({ i, top: Math.min(Math.max(top + 4, 8), rr.height - 120) });
  };
  const longPress = (i: number) => ({
    onTouchStart: () => { if (pressTimer.current) clearTimeout(pressTimer.current); pressTimer.current = setTimeout(() => { suppressClick.current = true; openMenu(i); try { navigator.vibrate?.(20); } catch { /* ignore */ } }, 480); },
    onTouchMove: () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } },
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); suppressClick.current = true; openMenu(i); },
  });

  /* ───── 听书（系统朗读） ───── */
  const ra = useReadAloud(
    i => chapters[ch]?.paras[i] ?? null,
    i => {
      lastActive.current = Date.now();
      if (flip) { const pg = pageOf(i); if (pg !== page) setPage(pg); }
      else paraRefs.current[i]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (book) savePosition(book.id, ch, i);
    },
    () => { if (ch < chapters.length - 1) { finishChapter(); goChapter(ch + 1); return true; } finishChapter(); return false; },
  );
  const toggleListen = () => {
    if (ra.active) { ra.stop(); return; }
    let from = 0;
    if (flip) { for (let i = 0; i < (chapters[ch]?.paras.length || 0); i++) { if (pageOf(i) < page) from = i + 1; else break; } }
    else { const b = loadShelf().books.find(x => x.id === bookId); from = b && b.pos.ch === ch ? b.pos.para : 0; }
    if (!ra.start(Math.min(from, Math.max(0, (chapters[ch]?.paras.length || 1) - 1)))) addToast?.('这个浏览器不支持朗读', 'error');
  };

  /* ───────── 书架 ───────── */
  if (!book) {
    return (
      <div className="h-full w-full flex flex-col relative" style={{ background: T.paper, color: T.ink }}>
        <div className="shrink-0 px-5 pb-3 flex items-center justify-between" style={{ paddingTop: 'calc(var(--chrome-top) + 0.5rem)' }}>
          <button onClick={closeApp} className="text-sm" style={{ color: T.muted }}>‹ 返回</button>
          <div className="font-serif text-lg tracking-widest">书影架</div>
          <button onClick={() => fileRef.current?.click()} disabled={importing} className="text-sm" style={{ color: T.accent }}>{importing ? '导入中…' : '＋ 书'}</button>
          <input ref={fileRef} type="file" accept=".txt,.epub,text/plain,application/epub+zip" className="hidden" onChange={async e => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            setImporting(true);
            try { const b = await importBook(f); addToast?.(`《${b.title}》上架了，${b.chapterTitles.length} 章`, 'success'); }
            catch (err: any) { addToast?.(`导入失败：${err?.message || err}`, 'error'); }
            setImporting(false);
          }} />
        </div>
        <div className="px-5 pb-2 flex items-center gap-3 overflow-x-auto no-scrollbar">
          <span className="text-[11px] shrink-0" style={{ color: T.muted }}>陪你读</span>
          {characters.map((c: any) => (
            <button key={c.id} onClick={() => setCharId(c.id)} className="flex items-center gap-1.5 shrink-0" style={{ opacity: c.id === charId ? 1 : 0.45 }}>
              <TokenImg value={c.avatar} className="w-7 h-7 rounded-full object-cover" />
              <span className="text-[11px]">{c.name}</span>
            </button>
          ))}
        </div>
        <label className="mx-5 mb-3 flex items-center justify-between text-[11px]" style={{ color: T.muted }}>
          <span>读完一章，他自动在页边写批注（每章一次）</span>
          <input type="checkbox" checked={store.autoNote} onChange={e => toggleAutoNote(e.target.checked)} />
        </label>
        {vocab.length > 0 && (
          <button onClick={() => setShowVocab(true)} className="mx-5 mb-3 flex items-center justify-between text-[11.5px] rounded-xl px-3 py-2" style={{ background: '#fffdf8', border: `1px solid ${T.line}`, color: T.mine }}>
            <span>生词本 · {vocab.length} 个词</span><span style={{ color: T.faint }}>›</span>
          </button>
        )}
        {showVocab && (
          <div className="absolute inset-0 z-40 flex flex-col" style={{ background: T.paper }}>
            <div className="shrink-0 px-5 pb-3 flex items-center justify-between" style={{ paddingTop: 'calc(var(--chrome-top) + 0.5rem)' }}>
              <button onClick={() => setShowVocab(false)} className="text-sm" style={{ color: T.muted }}>‹ 书架</button>
              <div className="font-serif">生词本</div><span className="w-10" />
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-10 space-y-2.5">
              {vocab.map(v => (
                <div key={v.id} className="rounded-xl p-3" style={{ background: '#fffdf8', border: `1px solid ${T.line}` }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <div><span className="font-serif text-[16px] font-semibold">{v.word}</span>{v.phonetic && <span className="ml-2 text-[11px]" style={{ color: T.muted }}>{v.phonetic}</span>}</div>
                    <button onClick={() => removeVocab(v.id)} className="text-[11px]" style={{ color: T.faint }}>删</button>
                  </div>
                  <div className="text-[13px] mt-0.5">{v.meaning}</div>
                  {v.note && <div className="text-[11.5px] mt-0.5" style={{ color: T.muted }}>{v.note}</div>}
                  <div className="text-[11.5px] mt-1.5 font-serif italic leading-relaxed" style={{ color: T.muted }}>{v.sentence}</div>
                  <div className="text-[10px] mt-1" style={{ color: T.faint }}>《{v.bookTitle}》</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {(() => {
          const st = loadStats();
          const now = Date.now();
          const days = Array.from({ length: 14 }, (_, i) => { const t = now - (13 - i) * 86400000; return { k: dayKeyOf(t), sec: st.days[dayKeyOf(t)] || 0, d: new Date(t).getDate() }; });
          const week = days.slice(-7).reduce((a, x) => a + x.sec, 0);
          const total = Object.values(st.days).reduce((a, x) => a + x, 0);
          const max = Math.max(600, ...days.map(x => x.sec));
          if (!total) return null;
          return (
            <div className="mx-5 mb-4 rounded-2xl p-3.5" style={{ background: '#fffdf8', border: `1px solid ${T.line}` }}>
              <div className="flex text-center">
                {[['今天', fmtMinutes(days[13].sec)], ['这周', fmtMinutes(week)], ['一共', fmtMinutes(total)], ['读完', `${Object.keys(st.finished).length} 本`], ['连续', `${readingStreak()} 天`]].map(([k, v]) => (
                  <div key={k} className="flex-1"><div className="text-[12.5px] font-serif" style={{ color: T.ink }}>{v}</div><div className="text-[9.5px]" style={{ color: T.faint }}>{k}</div></div>
                ))}
              </div>
              <div className="flex items-end gap-1 h-12 mt-3">
                {days.map(x => (
                  <div key={x.k} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full rounded-sm" style={{ height: `${Math.max(2, (x.sec / max) * 40)}px`, background: x.sec ? T.accent : T.paperDeep, opacity: x.sec ? 0.85 : 1 }} title={fmtMinutes(x.sec)} />
                    <div className="text-[8px]" style={{ color: T.faint }}>{x.d}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        <div className="flex-1 overflow-y-auto px-5 pb-10">
          {!store.books.length && (
            <div className="text-center text-xs leading-relaxed mt-16" style={{ color: T.faint }}>
              点右上角「＋ 书」导入 TXT 或 EPUB<br />他会和你读同一页，只批注你读过的地方，不剧透
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            {store.books.map(b => {
              const done = b.readTo.filter((r, i) => r >= (b.chapterSizes[i] || 1) - 1).length;
              const pct = Math.round((done / Math.max(1, b.chapterTitles.length)) * 100);
              const n = store.notes.filter(x => x.bookId === b.id && x.charId === charId).length;
              return (
                <div key={b.id} className="relative">
                  <button onClick={() => setBookId(b.id)} className="w-full aspect-[3/4] rounded-r-lg rounded-l-sm shadow-md p-2.5 flex flex-col text-left text-white" style={{ background: b.cover }}>
                    <div className="flex-1 font-serif font-bold text-[13px] leading-snug line-clamp-4">{b.title}</div>
                    {b.author && <div className="text-[9.5px] opacity-75 truncate">{b.author}</div>}
                  </button>
                  <div className="mt-1 text-[10px] flex justify-between" style={{ color: T.muted }}><span>{loadStats().finished[b.id] ? '读完' : `${pct}%`}{loadStats().books[b.id] ? ` · ${fmtMinutes(loadStats().books[b.id])}` : ''}</span>{n > 0 && <span>✎ {n}</span>}</div>
                  <button onClick={() => { if (confirm(`把《${b.title}》从书架拿下来？他的批注和你们的伴读记录也会一起删掉。`)) deleteBook(b.id); }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] bg-black/40 text-white">×</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  /* ───────── 阅读 ───────── */
  const chapter = chapters[ch];
  return (
    <div className="h-full w-full flex flex-col relative" style={{ background: T.paper, color: T.ink }}>
      {!flip && <div className="shrink-0 px-4 pb-2 flex items-center gap-2 border-b" style={{ paddingTop: 'calc(var(--chrome-top) + 0.4rem)', borderColor: T.line }}>
        <button onClick={() => { ra.stop(); setBookId(null); setChapters([]); setShowChat(false); }} className="text-sm shrink-0" style={{ color: T.muted }}>‹</button>
        <button onClick={() => setShowToc(true)} className="flex-1 min-w-0 text-left">
          <div className="text-[10px] truncate" style={{ color: T.muted }}>{book.title}</div>
          <div className="text-[13px] font-serif truncate">{chapter?.title || ''}</div>
        </button>
        {readAloudSupported() && <button onClick={toggleListen} className="text-xs px-1" style={{ color: ra.active ? T.accent : T.muted }}>{ra.active ? '■ 停' : '听书'}</button>}
        <button onClick={() => { const v = !flip; setFlip(v); restoreRef.current = 'pos'; try { localStorage.setItem(FLIP_KEY, v ? '1' : '0'); } catch { /* ignore */ } if (!v) setTimeout(() => { const b = loadShelf().books.find(x => x.id === bookId); paraRefs.current[b?.pos.para || 0]?.scrollIntoView({ block: 'start' }); }, 60); }} className="text-xs px-1" style={{ color: T.muted }}>{flip ? '翻页' : '滚动'}</button>
        <button onClick={() => { const v = size >= 22 ? 15 : size + 1; setSize(v); try { localStorage.setItem(FONT_KEY, String(v)); } catch { /* ignore */ } }} className="text-xs px-1.5" style={{ color: T.muted }}>Aa {size}</button>
        {char && <button onClick={() => setShowChat(true)} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full" style={{ background: T.paperDeep }}>
          <TokenImg value={char.avatar} className="w-5 h-5 rounded-full object-cover" />伴读{chat.length ? ` ${Math.ceil(chat.length / 2)}` : ''}
        </button>}
      </div>}

      {busy && <div className="absolute left-1/2 -translate-x-1/2 z-30 text-[11px] px-3 py-1 rounded-full shadow" style={{ top: 'calc(var(--chrome-top) + 3.4rem)', background: T.ink, color: T.paper }}>{busy}</div>}

      {flip ? (
        <>
          {/* 页眉：只有一行很淡的章节名 */}
          <div className="absolute left-0 right-0 z-10 px-6 flex justify-between text-[10.5px] font-sans pointer-events-none" style={{ top: 'calc(var(--chrome-top) + 0.35rem)', color: T.faint }}>
            <span className="truncate max-w-[70%]">{chapter?.title || book.title}</span>
          </div>
          <div ref={pageBoxRef} onClick={onBoxClick} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
            className="flex-1 relative overflow-hidden px-6 select-none"
            style={{ paddingTop: 'calc(var(--chrome-top) + 1.9rem)', paddingBottom: 'calc(var(--safe-bottom, 0px) + 2.1rem)', touchAction: 'none', WebkitUserSelect: 'none' }}>
            <div ref={colRef} className="font-serif relative" style={{ height: box.h || '100%', columnWidth: box.w ? `${box.w}px` : undefined, columnGap: `${GAP}px`, columnFill: 'auto', transform: `translate3d(${-page * (box.w + GAP) + dx}px,0,0)`, transition: anim ? 'transform 260ms cubic-bezier(.22,.8,.3,1)' : 'none', willChange: 'transform' }}>
        {chapter?.paras.map((p, i) => (
          <div key={i} ref={el => { paraRefs.current[i] = el; }} {...longPress(i)} style={ra.para === i || tapped === i ? { background: tapped === i ? 'rgba(122,78,58,0.12)' : 'rgba(122,78,58,0.08)', borderRadius: 4 } : undefined}>
            <Para text={p} size={size} notes={notesByPara.get(i) || []} onNote={setOpenNote} onTap={() => { /* 翻页模式：点按交给翻页，长按出菜单 */ }} />
          </div>
        ))}
        <div ref={el => { paraRefs.current[chapter?.paras.length || 0] = el; }} className="pt-6 pb-4 text-center font-sans" style={{ breakInside: 'avoid' }}>
          <div className="text-[11px] mb-3" style={{ color: T.faint }}>— 本章完 · 往左翻进下一章 —</div>
          {char && !book.annotatedChapters?.includes(ch) && !store.autoNote && (
            <button onClick={e => { e.stopPropagation(); runAnnotate(); }} disabled={!!busy} className="text-[12px] px-4 py-1.5 rounded-full" style={{ background: T.paperDeep, color: T.pencil }}>✎ 请{char.name}在这章写批注</button>
          )}
        </div>
            </div>
            {/* 长按一段：浮在段落旁边的菜单（不挤动排版） */}
            {menuAt && chapter?.paras[menuAt.i] != null && (
              <div className="absolute left-4 right-4 z-20 flex flex-wrap gap-2 p-2 rounded-2xl shadow-lg font-sans" style={{ top: menuAt.top, background: '#fffdf8', border: `1px solid ${T.line}` }} onClick={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}>
                <button onClick={() => { const p = chapter.paras[menuAt.i]; setQuote(p.length > 60 ? p.slice(0, 60) + '…' : p); setTapped(null); setMenuAt(null); setShowChat(true); }} className="text-[12px] px-3 py-1.5 rounded-full" style={{ background: T.paperDeep, color: T.accent }}>💬 吐槽这段</button>
                <button onClick={() => { const i = menuAt.i; setTapped(null); setMenuAt(null); savePosition(book.id, ch, i); runAnnotate(i); }} disabled={!!busy} className="text-[12px] px-3 py-1.5 rounded-full" style={{ background: T.paperDeep, color: T.pencil }}>✎ 批注到这里</button>
                {isLatinText(chapter.paras[menuAt.i]) && <button onClick={() => { const i = menuAt.i; setTapped(null); setMenuAt(null); setVocabPara(i); }} className="text-[12px] px-3 py-1.5 rounded-full" style={{ background: T.paperDeep, color: T.mine }}>查词</button>}
                <button onClick={() => { const i = menuAt.i; setTapped(null); setMenuAt(null); ra.start(i); }} className="text-[12px] px-3 py-1.5 rounded-full" style={{ background: T.paperDeep, color: T.muted }}>从这听</button>
              </div>
            )}
          </div>
          {/* 页脚：页码 */}
          <div className="absolute left-0 right-0 z-10 px-6 flex justify-between text-[10px] font-sans pointer-events-none" style={{ bottom: 'calc(var(--safe-bottom, 0px) + 0.7rem)', color: T.faint }}>
            <span>{Math.round(((ch + (page + 1) / Math.max(1, pages)) / Math.max(1, chapters.length)) * 1000) / 10}%</span>
            <span>{page + 1} / {pages}</span>
          </div>

          {/* 中间点一下：上下菜单 */}
          {bars && (
            <>
              <div className="absolute left-0 right-0 top-0 z-30 px-4 pb-3 flex items-center gap-2 shadow-sm" style={{ paddingTop: 'calc(var(--chrome-top) + 0.4rem)', background: 'rgba(250,246,238,0.97)', borderBottom: `1px solid ${T.line}` }}>
                <button onClick={() => { ra.stop(); setBars(false); setBookId(null); setChapters([]); setShowChat(false); }} className="text-lg px-1 shrink-0" style={{ color: T.muted }}>‹</button>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] truncate" style={{ color: T.muted }}>{book.title}</div>
                  <div className="text-[13px] font-serif truncate">{chapter?.title || ''}</div>
                </div>
                {char && <button onClick={() => { setBars(false); setShowChat(true); }} className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full shrink-0" style={{ background: T.paperDeep }}>
                  <TokenImg value={char.avatar} className="w-5 h-5 rounded-full object-cover" />伴读{chat.length ? ` ${Math.ceil(chat.length / 2)}` : ''}
                </button>}
              </div>
              <div className="absolute left-0 right-0 bottom-0 z-30 px-5 pt-3 font-sans" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 0.8rem)', background: 'rgba(250,246,238,0.97)', borderTop: `1px solid ${T.line}` }}>
                <div className="flex items-center gap-3 text-[12px]">
                  <button onClick={() => { setBars(false); goChapter(ch - 1); }} disabled={ch === 0} className="disabled:opacity-30" style={{ color: T.muted }}>上一章</button>
                  <input type="range" min={0} max={Math.max(0, pages - 1)} value={page} onChange={e => { const v = Number(e.target.value); setAnim(false); setPage(v); savePagePos(v); }} className="flex-1" style={{ accentColor: T.accent }} />
                  <button onClick={() => { setBars(false); finishChapter(); goChapter(ch + 1); }} disabled={ch >= chapters.length - 1} className="disabled:opacity-30" style={{ color: T.muted }}>下一章</button>
                </div>
                <div className="grid grid-cols-5 mt-3 text-[11px] text-center" style={{ color: T.ink }}>
                  <button onClick={() => { setBars(false); setShowToc(true); }}>☰<div className="mt-0.5" style={{ color: T.muted }}>目录</div></button>
                  <button onClick={() => { const v = Math.max(14, size - 1); setSize(v); restoreRef.current = 'pos'; try { localStorage.setItem(FONT_KEY, String(v)); } catch { /* ignore */ } }}>A-<div className="mt-0.5" style={{ color: T.muted }}>{size}</div></button>
                  <button onClick={() => { const v = Math.min(24, size + 1); setSize(v); restoreRef.current = 'pos'; try { localStorage.setItem(FONT_KEY, String(v)); } catch { /* ignore */ } }}>A+<div className="mt-0.5" style={{ color: T.muted }}>字号</div></button>
                  {readAloudSupported() ? <button onClick={() => { setBars(false); toggleListen(); }} style={{ color: ra.active ? T.accent : T.ink }}>{ra.active ? '■' : '♪'}<div className="mt-0.5" style={{ color: T.muted }}>{ra.active ? '停止' : '听书'}</div></button> : <span />}
                  <button onClick={() => { setBars(false); setFlip(false); restoreRef.current = 'pos'; try { localStorage.setItem(FLIP_KEY, '0'); } catch { /* ignore */ } setTimeout(() => { const b = loadShelf().books.find(x => x.id === bookId); paraRefs.current[b?.pos.para || 0]?.scrollIntoView({ block: 'start' }); }, 60); }}>⇅<div className="mt-0.5" style={{ color: T.muted }}>滚动</div></button>
                </div>
              </div>
            </>
          )}
        </>
      ) : (
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-6 pt-5 pb-28 font-serif">
        {chapter?.paras.map((p, i) => (
          <div key={i} ref={el => { paraRefs.current[i] = el; }} style={ra.para === i ? { background: 'rgba(122,78,58,0.08)', borderRadius: 4 } : undefined}>
            <Para text={p} size={size} notes={notesByPara.get(i) || []} onNote={setOpenNote} onTap={() => { lastActive.current = Date.now(); setTapped(tapped === i ? null : i); }} />
            {tapped === i && (
              <div className="flex gap-2 -mt-1.5 mb-3 font-sans">
                <button onClick={() => { setQuote(p.length > 60 ? p.slice(0, 60) + '…' : p); setTapped(null); setShowChat(true); }} className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: T.paperDeep, color: T.accent }}>💬 跟他吐槽这段</button>
                <button onClick={() => { setTapped(null); savePosition(book.id, ch, i); runAnnotate(i); }} disabled={!!busy} className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: T.paperDeep, color: T.pencil }}>✎ 让他批注到这里</button>
                {isLatinText(p) && <button onClick={() => { setTapped(null); setVocabPara(i); }} className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: T.paperDeep, color: T.mine }}>查词</button>}
                <button onClick={() => { setTapped(null); ra.start(i); }} className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: T.paperDeep, color: T.muted }}>从这听</button>
              </div>
            )}
          </div>
        ))}
        <div ref={el => { paraRefs.current[chapter?.paras.length || 0] = el; }} className="pt-6 pb-4 text-center font-sans">
          <div className="text-[11px] mb-3" style={{ color: T.faint }}>— 本章完 —</div>
          {char && !book.annotatedChapters?.includes(ch) && !store.autoNote && (
            <button onClick={() => runAnnotate()} disabled={!!busy} className="text-[12px] px-4 py-1.5 rounded-full mb-3" style={{ background: T.paperDeep, color: T.pencil }}>✎ 请{char.name}在这章写批注</button>
          )}
          <div className="flex justify-center gap-3">
            <button onClick={() => goChapter(ch - 1)} disabled={ch === 0} className="text-[12px] px-4 py-2 rounded-xl disabled:opacity-30" style={{ background: T.paperDeep }}>上一章</button>
            <button onClick={() => { finishChapter(); goChapter(ch + 1); }} disabled={ch >= chapters.length - 1} className="text-[12px] px-4 py-2 rounded-xl text-white disabled:opacity-30" style={{ background: T.accent }}>下一章</button>
          </div>
        </div>
      </div>
      )}

      {ra.active && (
        <div className="absolute left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 text-[11px] px-3.5 py-1.5 rounded-full shadow font-sans" style={{ bottom: 'calc(var(--safe-bottom, 0px) + 2.2rem)', background: T.ink, color: T.paper }}>
          <span>在念第 {(ra.para ?? 0) + 1} 段</span>
          <button onClick={() => ra.setRate(ra.rate >= 1.75 ? 0.75 : Math.round((ra.rate + 0.25) * 100) / 100)}>{ra.rate}x</button>
          <button onClick={ra.stop}>■</button>
        </div>
      )}

      {/* 查词：点这段里的词 */}
      {vocabPara !== null && chapter?.paras[vocabPara] && (
        <div className="absolute inset-0 z-40 flex items-end" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={() => { setVocabPara(null); setLookup(null); }}>
          <div className="w-full m-3 rounded-2xl p-4 shadow-xl max-h-[75%] overflow-y-auto" style={{ background: '#fffdf8', border: `1px solid ${T.line}` }} onClick={e => e.stopPropagation()}>
            <div className="text-[11px] mb-2 font-sans" style={{ color: T.muted }}>点不认识的词</div>
            <div className="font-serif text-[15px] leading-[2]">
              {tokenize(chapter.paras[vocabPara]).map((tk, k) => tk.word
                ? <span key={k} onClick={() => doLookup(tk.t.replace(/['’]s$/, ''), chapter.paras[vocabPara])} className="cursor-pointer rounded px-0.5" style={lookup?.word === tk.t.replace(/['’]s$/, '') ? { background: '#e4ece4', color: T.mine } : hasVocab(tk.t) ? { textDecoration: 'underline dotted', textDecorationColor: T.mine } : undefined}>{tk.t}</span>
                : <span key={k}>{tk.t}</span>)}
            </div>
            {lookup && (
              <div className="mt-3 pt-3 border-t font-sans" style={{ borderColor: T.line }}>
                <div className="flex items-baseline gap-2"><span className="font-serif text-[17px] font-semibold">{lookup.word}</span>{lookup.res?.phonetic && <span className="text-[11px]" style={{ color: T.muted }}>{lookup.res.phonetic}</span>}</div>
                {!lookup.res && !lookup.err && <div className="text-[12px] mt-1" style={{ color: T.faint }}>在查…</div>}
                {lookup.err && <div className="text-[12px] mt-1" style={{ color: '#b0563c' }}>{lookup.err}</div>}
                {lookup.res && <>
                  <div className="text-[13px] mt-1">{lookup.res.meaning}</div>
                  {lookup.res.note && <div className="text-[11.5px] mt-1" style={{ color: T.muted }}>{lookup.res.note}</div>}
                  <button onClick={() => { addVocab({ word: lookup.word, phonetic: lookup.res!.phonetic, meaning: lookup.res!.meaning, note: lookup.res!.note, sentence: lookup.sentence, bookTitle: book.title }); addToast?.('收进生词本了', 'success'); }}
                    className="mt-2 text-[12px] px-3 py-1 rounded-full" style={{ background: T.paperDeep, color: T.mine }}>{hasVocab(lookup.word) ? '已在生词本（再收一次会更新）' : '＋ 收进生词本'}</button>
                </>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 批注气泡 */}
      {openNote && char && (
        <div className="absolute inset-0 z-40 flex items-end" onClick={() => setOpenNote(null)}>
          <div className="w-full m-3 rounded-2xl p-4 shadow-xl" style={{ background: '#fffdf8', border: `1px solid ${T.line}` }} onClick={e => e.stopPropagation()}>
            {openNote.quote && <div className="text-[12px] font-serif mb-2 pl-2" style={{ color: T.muted, borderLeft: `2px solid ${T.pencil}` }}>{openNote.quote}</div>}
            <div className="flex items-start gap-2">
              <TokenImg value={char.avatar} className="w-7 h-7 rounded-full object-cover shrink-0" />
              <div className="flex-1 text-[14px] leading-relaxed" style={{ color: T.pencil, fontFamily: `'Caveat','Long Cang','Ma Shan Zheng',cursive` }}>{openNote.zh}</div>
            </div>
            <div className="flex gap-2 mt-3">
              {hasVoice && (openNote.voice || openNote.zh) && (
                <button onClick={() => play(openNote.id, openNote.voice || openNote.zh)} className="text-[11px] px-3 py-1 rounded-full" style={{ background: T.paperDeep, color: T.accent }}>
                  {playing === openNote.id ? '■ 停' : `▶ 听他念${openNote.voice ? `（${voiceLanguageLabel(lang)}）` : ''}`}
                </button>
              )}
              <button onClick={() => share(() => shareShelfNote(openNote, book, char.name, userName))} className="text-[11px] px-3 py-1 rounded-full" style={{ background: T.paperDeep, color: T.muted }}>发到聊天</button>
            </div>
          </div>
        </div>
      )}

      {/* 目录 */}
      {showToc && (
        <div className="absolute inset-0 z-40 flex">
          <div className="flex-1 bg-black/30" onClick={() => setShowToc(false)} />
          <div className="w-72 h-full overflow-y-auto p-4" style={{ background: T.paper, paddingTop: 'calc(var(--chrome-top) + 1rem)' }}>
            <div className="text-xs mb-3 tracking-widest" style={{ color: T.muted }}>目录</div>
            {book.chapterTitles.map((t, i) => {
              const read = (book.readTo[i] ?? -1) >= (book.chapterSizes[i] || 1) - 1;
              const n = store.notes.filter(x => x.bookId === book.id && x.ch === i && x.charId === charId).length;
              return (
                <button key={i} onClick={() => goChapter(i)} className="w-full text-left py-2 px-2 rounded-lg text-[13px] flex items-center gap-2" style={{ background: i === ch ? T.paperDeep : 'transparent', color: read ? T.muted : T.ink }}>
                  <span className="flex-1 truncate">{t}</span>{n > 0 && <span className="text-[10px]" style={{ color: T.pencil }}>✎{n}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 伴读小窗 */}
      {showChat && char && (
        <div className="absolute inset-x-0 bottom-0 z-40 h-[62%] rounded-t-3xl shadow-2xl flex flex-col font-sans" style={{ background: '#fffdf8', borderTop: `1px solid ${T.line}` }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: T.line }}>
            <div className="flex items-center gap-2 text-[13px]"><TokenImg value={char.avatar} className="w-6 h-6 rounded-full object-cover" />和{char.name}一起读</div>
            <button onClick={() => setShowChat(false)} className="text-sm px-2" style={{ color: T.muted }}>收起</button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
            {!chat.length && <div className="text-[11.5px] text-center mt-6 leading-relaxed" style={{ color: T.faint }}>读到哪就吐槽到哪，他只知道你读过的部分。<br />点正文里的一段，可以指着那段跟他说。</div>}
            {chat.map(c => c.role === 'me' ? (
              <div key={c.id} className="flex flex-col items-end">
                {c.quote && <div className="text-[10.5px] max-w-[85%] mb-0.5 truncate" style={{ color: T.faint }}>「{c.quote}」</div>}
                <div className="text-[13px] text-white rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%] leading-relaxed" style={{ background: T.mine }}>{c.text}</div>
              </div>
            ) : (
              <div key={c.id} className="flex items-start gap-2">
                <TokenImg value={char.avatar} className="w-6 h-6 rounded-full object-cover shrink-0" />
                <div className="max-w-[85%]">
                  <div className="text-[13px] rounded-2xl rounded-tl-sm px-3 py-2 leading-relaxed" style={{ background: T.paperDeep, color: T.ink }}>{c.text}</div>
                  <div className="flex gap-3 mt-0.5 ml-1">
                    {hasVoice && <button onClick={() => play(c.id, c.voice || c.text)} className="text-[10.5px]" style={{ color: T.accent }}>{playing === c.id ? '■ 停' : `▶ 听${c.voice ? voiceLanguageLabel(lang) : ''}`}</button>}
                    <button onClick={() => share(() => shareShelfTalk(c as ShelfChat, book, char.name, userName))} className="text-[10.5px]" style={{ color: T.faint }}>发到聊天</button>
                  </div>
                </div>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
          {quote && (
            <div className="mx-4 mb-1 text-[11px] flex items-center gap-2 px-2 py-1 rounded-lg" style={{ background: T.paperDeep, color: T.muted }}>
              <span className="flex-1 truncate">指着：「{quote}」</span><button onClick={() => setQuote('')}>×</button>
            </div>
          )}
          <div className="flex gap-2 px-4 pb-4 pt-1" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 1rem)' }}>
            <input value={say} onChange={e => setSay(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} placeholder="吐槽一句…" className="flex-1 min-w-0 px-3 py-2 rounded-xl text-[13px] outline-none" style={{ background: T.paper, border: `1px solid ${T.line}` }} />
            <button onClick={send} disabled={!say.trim() || !!busy} className="px-4 rounded-xl text-[13px] text-white disabled:opacity-40" style={{ background: T.accent }}>说</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShelfApp;
