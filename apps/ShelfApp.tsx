/**
 * 书影架 · 一起看书
 * 书架 → 阅读（他在你读过的地方画线写批注）→ 伴读小窗（你吐槽，他回；他的话可以用他的声音念外语版）
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import type { CharacterProfile } from '../types';
import {
  loadShelf, SHELF_EVENT, importBook, loadChapters, deleteBook, savePosition, annotateChapter, chatAboutBook, toggleAutoNote,
  type ShelfBook, type ShelfChapter, type ShelfNote,
} from '../utils/shelf';
import { synthesizeSpeech, characterHasVoice } from '../utils/ttsRouter';
import { voiceLanguageLabel } from '../utils/voiceLanguage';
import TokenImg from '../components/os/TokenImg';

const T = {
  paper: '#f6f1e7', paperDeep: '#ece4d3', ink: '#2f2a24', muted: '#8a7f70', faint: '#b9ae9c',
  line: '#d9cfbd', accent: '#7a4e3a', pencil: '#5b6b7a', mine: '#4f6b58',
};
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const FONT_KEY = 'sully_shelf_font_v1';

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
  const chatEnd = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceCache = useRef(new Map<string, Promise<string | null>>());
  const [playing, setPlaying] = useState('');
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
      setTimeout(() => { paraRefs.current[b?.pos.para || 0]?.scrollIntoView({ block: 'start' }); }, 60);
    });
    return () => { alive = false; };
  }, [bookId]);

  /* 记进度：最上面那段；读到章末自动请他批注 */
  const lastSaved = useRef(0);
  const onScroll = () => {
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
    const long = (chapters[ch]?.paras.join('').length || 0) >= 200;
    if (long && store.autoNote && char && !book.annotatedChapters?.includes(ch) && !busy) runAnnotate();
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

  const goChapter = (i: number) => {
    if (!book || i < 0 || i >= chapters.length) return;
    setCh(i); setShowToc(false); setTapped(null);
    savePosition(book.id, i, 0);
    setTimeout(() => scrollRef.current?.scrollTo({ top: 0 }), 30);
  };

  /* ───────── 书架 ───────── */
  if (!book) {
    return (
      <div className="h-full w-full flex flex-col" style={{ background: T.paper, color: T.ink }}>
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
                  <div className="mt-1 text-[10px] flex justify-between" style={{ color: T.muted }}><span>{pct}%</span>{n > 0 && <span>✎ {n}</span>}</div>
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
      <div className="shrink-0 px-4 pb-2 flex items-center gap-2 border-b" style={{ paddingTop: 'calc(var(--chrome-top) + 0.4rem)', borderColor: T.line }}>
        <button onClick={() => { setBookId(null); setChapters([]); setShowChat(false); }} className="text-sm shrink-0" style={{ color: T.muted }}>‹</button>
        <button onClick={() => setShowToc(true)} className="flex-1 min-w-0 text-left">
          <div className="text-[10px] truncate" style={{ color: T.muted }}>{book.title}</div>
          <div className="text-[13px] font-serif truncate">{chapter?.title || ''}</div>
        </button>
        <button onClick={() => { const v = size >= 22 ? 15 : size + 1; setSize(v); try { localStorage.setItem(FONT_KEY, String(v)); } catch { /* ignore */ } }} className="text-xs px-1.5" style={{ color: T.muted }}>Aa {size}</button>
        {char && <button onClick={() => setShowChat(true)} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full" style={{ background: T.paperDeep }}>
          <TokenImg value={char.avatar} className="w-5 h-5 rounded-full object-cover" />伴读{chat.length ? ` ${Math.ceil(chat.length / 2)}` : ''}
        </button>}
      </div>

      {busy && <div className="absolute left-1/2 -translate-x-1/2 z-30 text-[11px] px-3 py-1 rounded-full shadow" style={{ top: 'calc(var(--chrome-top) + 3.4rem)', background: T.ink, color: T.paper }}>{busy}</div>}

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-6 pt-5 pb-28 font-serif">
        {chapter?.paras.map((p, i) => (
          <div key={i} ref={el => { paraRefs.current[i] = el; }}>
            <Para text={p} size={size} notes={notesByPara.get(i) || []} onNote={setOpenNote} onTap={() => setTapped(tapped === i ? null : i)} />
            {tapped === i && (
              <div className="flex gap-2 -mt-1.5 mb-3 font-sans">
                <button onClick={() => { setQuote(p.length > 60 ? p.slice(0, 60) + '…' : p); setTapped(null); setShowChat(true); }} className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: T.paperDeep, color: T.accent }}>💬 跟他吐槽这段</button>
                <button onClick={() => { setTapped(null); savePosition(book.id, ch, i); runAnnotate(i); }} disabled={!!busy} className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: T.paperDeep, color: T.pencil }}>✎ 让他批注到这里</button>
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

      {/* 批注气泡 */}
      {openNote && char && (
        <div className="absolute inset-0 z-40 flex items-end" onClick={() => setOpenNote(null)}>
          <div className="w-full m-3 rounded-2xl p-4 shadow-xl" style={{ background: '#fffdf8', border: `1px solid ${T.line}` }} onClick={e => e.stopPropagation()}>
            {openNote.quote && <div className="text-[12px] font-serif mb-2 pl-2" style={{ color: T.muted, borderLeft: `2px solid ${T.pencil}` }}>{openNote.quote}</div>}
            <div className="flex items-start gap-2">
              <TokenImg value={char.avatar} className="w-7 h-7 rounded-full object-cover shrink-0" />
              <div className="flex-1 text-[14px] leading-relaxed" style={{ color: T.pencil, fontFamily: `'Caveat','Long Cang','Ma Shan Zheng',cursive` }}>{openNote.zh}</div>
            </div>
            {hasVoice && (openNote.voice || openNote.zh) && (
              <button onClick={() => play(openNote.id, openNote.voice || openNote.zh)} className="mt-3 text-[11px] px-3 py-1 rounded-full" style={{ background: T.paperDeep, color: T.accent }}>
                {playing === openNote.id ? '■ 停' : `▶ 听他念${openNote.voice ? `（${voiceLanguageLabel(lang)}）` : ''}`}
              </button>
            )}
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
                  {hasVoice && <button onClick={() => play(c.id, c.voice || c.text)} className="text-[10.5px] mt-0.5 ml-1" style={{ color: T.accent }}>{playing === c.id ? '■ 停' : `▶ 听${c.voice ? voiceLanguageLabel(lang) : ''}`}</button>}
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
