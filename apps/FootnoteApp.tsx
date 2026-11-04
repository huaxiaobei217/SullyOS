/**
 * 页脚 —— 便签墙 · 快问快答转盘 · 深夜点播机。旧信纸 + 墨水 + 烛光。
 * 逻辑见 utils/footnote.ts。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { CaretLeft, Star, Trash, ArrowsClockwise, Play, Pause, PencilSimple, ChatCircle, TextAa, Translate, ImageSquare, DownloadSimple, PaperPlaneTilt } from '@phosphor-icons/react';
import { shareNote, shareRadio, shareQa } from '../utils/footnoteShare';
import { voiceLanguageLabel } from '../utils/voiceLanguage';
import { DB } from '../utils/db';
import {
  loadFootnote, updateFootnote, FOOTNOTE_CHANGED_EVENT, dropCards, QA_BANK, generateQuestion, answerQuestion,
  RADIO_CHANNELS, playRadio, addUserNote, addUserReply, replyToNote, threadOf, parseRadioSegments,
  getRadioAudio, saveRadioAudio, deleteRadioPiece, collectRadioAudio,
  FOOT_FONTS, FOOT_TINTS, fontCss, tintOf, loadCharFont, saveCharFont,
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
  l1.href = `https://fonts.googleapis.com/css2?${fam}&family=Noto+Serif+SC:wght@400;600&family=Cormorant+Garamond:ital@1&display=swap`;
  document.head.appendChild(l1);
  const l2 = document.createElement('link');
  l2.rel = 'stylesheet';
  l2.href = 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css';
  document.head.appendChild(l2);
};

type Tab = 'wall' | 'qa' | 'radio';

/** 一小枝茉莉 */
const Jasmine: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <path d="M12 21c0-5 1-8 4-11" stroke="#7d8f6a" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    <path d="M14.5 13.5c1.8-.2 3 .6 3.6 1.8-1.7.4-3-.2-3.6-1.8z" fill="#9aae84" />
    {[0, 72, 144, 216, 288].map(a => (
      <ellipse key={a} cx="12" cy="6.2" rx="1.9" ry="3" fill="#fffdf6" stroke="#e9dfc9" strokeWidth=".5" transform={`rotate(${a} 12 9)`} />
    ))}
    <circle cx="12" cy="9" r="1.2" fill="#e8c873" />
  </svg>
);

const FootnoteApp: React.FC = () => {
  const { closeApp, characters, apiConfig, addToast, userProfile } = useOS() as any;
  const userName = userProfile?.name || '我';
  const onShared = () => addToast?.('发到聊天里了，他之后会记得', 'success');
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

  // 自定义背景图（自己用 NAI / GPT 生的图），存本机 IndexedDB
  const [bgs, setBgs] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);
  const bgKey = (t: Tab) => `footnote_bg_${t === 'radio' ? 'radio' : 'wall'}`;
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    Promise.all(['wall', 'radio'].map(async k => {
      const v = await DB.getAssetRaw(`footnote_bg_${k}`).catch(() => null);
      if (v?.blob) { const u = URL.createObjectURL(v.blob); urls.push(u); return [k, u] as const; }
      return null;
    })).then(list => { if (alive) setBgs(Object.fromEntries(list.filter(Boolean) as any)); });
    return () => { alive = false; urls.forEach(u => URL.revokeObjectURL(u)); };
  }, []);
  const pickBg = async (f?: File) => {
    if (!f) return;
    await DB.saveAssetRaw(bgKey(tab), { blob: f, mimeType: f.type });
    setBgs(b => ({ ...b, [tab === 'radio' ? 'radio' : 'wall']: URL.createObjectURL(f) }));
  };
  const clearBg = async () => {
    await DB.deleteAsset(bgKey(tab)).catch(() => {});
    setBgs(b => { const n = { ...b }; delete n[tab === 'radio' ? 'radio' : 'wall']; return n; });
  };
  const curBg = tab === 'radio' ? bgs.radio : tab === 'wall' ? bgs.wall : undefined;

  return (
    <div className="h-full w-full flex flex-col transition-colors duration-500"
      style={{
        background: curBg
          ? (night ? `linear-gradient(rgba(17,19,27,0.6), rgba(17,19,27,0.9)), url(${curBg}) center / cover no-repeat` : `linear-gradient(rgba(243,238,230,0.5), rgba(243,238,230,0.78)), url(${curBg}) center / cover no-repeat`)
          : (night ? `linear-gradient(180deg, ${T.night1}, ${T.night2})` : T.bg),
        color: night ? '#e9e2d6' : T.ink,
      }}>
      <div className="shrink-0 px-3 pb-2 flex items-center gap-2" style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}>
        <button onClick={closeApp} className="p-1.5 -ml-1 active:scale-90"><CaretLeft size={22} /></button>
        <div className="text-lg tracking-[0.35em] font-semibold flex items-center gap-1.5" style={{ fontFamily: serif }}><Jasmine />页脚</div>
        <div className="flex-1" />
        {tab !== 'qa' && (
          <>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { pickBg(e.target.files?.[0]); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()} className="p-1.5 opacity-70" title="换背景图"><ImageSquare size={18} /></button>
            {curBg && <button onClick={clearBg} className="text-[10px] opacity-50 -ml-1 mr-1">恢复</button>}
          </>
        )}
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
          : tab === 'wall' ? <Wall char={char} apiConfig={apiConfig} cards={store.cards.filter(c => c.charId === char.id)} onErr={toastErr} bg={bgs.wall} userName={userName} onShared={onShared} />
          : tab === 'qa' ? <Qa char={char} apiConfig={apiConfig} rounds={store.qa.filter(q => q.charId === char.id)} onErr={toastErr} userName={userName} onShared={onShared} />
          : <RadioTab char={char} apiConfig={apiConfig} pieces={store.radio.filter(r => r.charId === char.id)} onErr={toastErr} bg={bgs.radio} userName={userName} onShared={onShared} />}
      </div>
    </div>
  );
};

/* ───────── 便签墙 ───────── */

/** 半透明、两头锯齿的和纸胶带 */
const zig = (() => {
  const n = 7, pts: string[] = [];
  for (let i = 0; i <= n; i++) pts.push(`${i % 2 ? 4 : 0}% ${(i / n) * 100}%`);
  const left = pts.join(',');
  const right = pts.slice().reverse().map(p => { const [x, y] = p.split(' '); return `${100 - parseFloat(x)}% ${y}`; }).join(',');
  return `polygon(${left},${right})`;
})();
const Tape: React.FC<{ color: string; seed: number; wide?: boolean }> = ({ color, seed, wide }) => (
  <div className={`absolute left-1/2 -top-2.5 h-[18px] ${wide ? 'w-24' : 'w-16'}`}
    style={{
      background: `linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0.15)), ${color.replace(/[\d.]+\)$/, '0.55)')}`,
      backdropFilter: 'blur(1px)', WebkitBackdropFilter: 'blur(1px)',
      transform: `translateX(-50%) rotate(${(seed % 9) - 4}deg)`,
      boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.4)', clipPath: zig,
    }} />
);

const Wall: React.FC<{ char: any; apiConfig: any; cards: FootCard[]; onErr: (e: any) => void; bg?: string; userName: string; onShared?: () => void }> = ({ char, apiConfig, cards, onErr, bg, userName, onShared }) => {
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'his' | 'mine' | 'star'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState('');
  const [font, setFont] = useState(() => { try { return localStorage.getItem('sully_footnote_my_font_v1') || 'kai'; } catch { return 'kai'; } });
  const [tint, setTint] = useState('rose');
  const [charFont, setCharFontState] = useState(loadCharFont());
  const [showFonts, setShowFonts] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const drop = () => {
    setBusy(true);
    dropCards(char, apiConfig).then(list => { setFresh(new Set(list.map(c => c.id))); setFilter('all'); }).catch(onErr).finally(() => setBusy(false));
  };
  const post = () => {
    if (!draft.trim()) return;
    try { localStorage.setItem('sully_footnote_my_font_v1', font); } catch { /* ignore */ }
    addUserNote(char.id, draft, font, tint); setDraft(''); setWriting(false);
  };

  const shown = cards.filter(c => filter === 'all' ? true : filter === 'star' ? c.starred : filter === 'mine' ? c.author === 'user' : c.author !== 'user');
  const open = cards.find(c => c.id === openId) || null;
  return (
    <div className="min-h-full" data-bg={bg ? '1' : '0'}>
      <style>{`@keyframes footDrop { 0% { opacity: 0; transform: translateY(-24px) rotate(var(--r)) scale(1.04) } 100% { opacity: 1; transform: rotate(var(--r)) } }`}</style>
      <div className="flex gap-2 mb-2 pt-1">
        <button onClick={drop} disabled={busy} className="flex-1 py-2.5 rounded-xl text-[13px] active:scale-[0.98] disabled:opacity-60"
          style={{ background: T.card, border: `1px dashed ${T.line}`, fontFamily: serif }}>{busy ? `${char.name}在到处贴…` : `看看${char.name}贴了什么`}</button>
        <button onClick={() => setWriting(v => !v)} className="flex-1 py-2.5 rounded-xl text-[13px] active:scale-[0.98] text-white"
          style={{ background: T.candle, fontFamily: serif }}><PencilSimple size={13} className="inline -mt-0.5 mr-1" />我写一张</button>
        <button onClick={() => setShowFonts(v => !v)} className="px-3 rounded-xl" style={{ background: T.card, border: `1px solid ${T.line}` }}><TextAa size={16} /></button>
      </div>

      {showFonts && (
        <div className="mb-3 p-3 rounded-xl text-[11px]" style={{ background: T.card, border: `1px solid ${T.line}` }}>
          <div className="mb-1.5 opacity-70">{char.name}写字用的字体（只影响之后新贴的）</div>
          <div className="flex flex-wrap gap-1.5">
            {FOOT_FONTS.map(f => (
              <button key={f.id} onClick={() => { saveCharFont(f.id); setCharFontState(f.id); }}
                className="px-2.5 py-1 rounded-full" style={{ fontFamily: f.css, fontSize: 13, background: charFont === f.id ? T.candleSoft : 'transparent', border: `1px solid ${charFont === f.id ? T.candle : T.line}` }}>{f.name}</button>
            ))}
          </div>
          <div className="mt-2 leading-relaxed" style={{ fontFamily: fontCss(charFont), fontSize: 15 }}>
            London, 11pm — 灯泡我换了，别再摸黑看书。
          </div>
          {FOOT_FONTS.find(f => f.id === charFont)?.hint && <div className="mt-1 opacity-60">{FOOT_FONTS.find(f => f.id === charFont)?.hint}</div>}
        </div>
      )}

      {writing && (
        <div className="relative mb-4 mt-3 p-4 pt-5 rounded-sm shadow-md" style={{ background: tintOf(tint).paper }}>
          <Tape color={tintOf(tint).tape} seed={3} />
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} autoFocus placeholder={`写给${char.name}…`}
            className="w-full bg-transparent outline-none resize-none leading-relaxed" style={{ fontFamily: fontCss(font), fontSize: 15, color: T.ink }} />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {FOOT_FONTS.map(f => (
              <button key={f.id} onClick={() => setFont(f.id)} className="px-2 py-0.5 rounded-full"
                style={{ fontFamily: f.css, fontSize: 12, background: font === f.id ? 'rgba(0,0,0,0.08)' : 'transparent', border: `1px solid ${font === f.id ? T.ink : 'rgba(0,0,0,0.1)'}` }}>{f.name}</button>
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
      <div className="columns-2 gap-4 pt-2 pb-6">
        {shown.map((c, i) => {
          const tn = tintOf(c.tint);
          const mine = c.author === 'user';
          const th = threadOf(c);
          const r = `${((i * 37) % 7) - 3}deg`;
          return (
            <div key={c.id} onClick={() => setOpenId(c.id)}
              className="relative break-inside-avoid mb-5 p-3 pt-4 cursor-pointer active:scale-[0.98] transition-transform"
              style={{
                background: tn.paper, boxShadow: '0 2px 6px rgba(60,45,30,0.10)', transform: `rotate(${r})`, borderRadius: 2,
                ['--r' as any]: r, animation: fresh.has(c.id) ? `footDrop .5s ease-out ${Array.from(fresh).indexOf(c.id) * 0.12}s both` : undefined,
              }}>
              <Tape color={tn.tape} seed={i * 13 + 5} />
              <div className="flex items-center justify-between mb-1 text-[9px]" style={{ color: T.soft }}>
                <span>{mine ? '我' : KIND_LABEL[c.kind]}</span>
                <span className="flex items-center gap-1">{th.length > 0 && <span>{th.length} 条回复</span>}{c.starred && <Star size={10} weight="fill" color={T.candle} />}</span>
              </div>
              {c.quote && <div className="text-[10.5px] leading-relaxed italic mb-1 line-clamp-2" style={{ color: T.soft, fontFamily: serif }}>{c.kind === 'frame' ? c.quote : `「${c.quote}」`}</div>}
              <div className="leading-relaxed line-clamp-5" style={{ fontFamily: fontCss(c.font), fontSize: 13.5, color: T.ink }}>{c.note}</div>
              {c.source && <div className="text-[9px] mt-1.5 opacity-55 truncate" style={{ fontFamily: serif }}>—— {c.source}</div>}
            </div>
          );
        })}
      </div>
      {open && <NoteSheet card={open} char={char} apiConfig={apiConfig} onErr={onErr} onClose={() => setOpenId(null)} userName={userName} onShared={onShared} />}
    </div>
  );
};

/** 点开一张纸条：放大看，下面你一句我一句 */
const NoteSheet: React.FC<{ card: FootCard; char: any; apiConfig: any; onErr: (e: any) => void; onClose: () => void; userName: string; onShared?: () => void }> = ({ card, char, apiConfig, onErr, onClose, userName, onShared }) => {
  const [mine, setMine] = useState('');
  const [waiting, setWaiting] = useState(false);
  const tn = tintOf(card.tint);
  const th = threadOf(card);
  const myFont = (() => { try { return localStorage.getItem('sully_footnote_my_font_v1') || 'kai'; } catch { return 'kai'; } })();
  const askHim = () => { setWaiting(true); replyToNote(char, apiConfig, card.id).catch(onErr).finally(() => setWaiting(false)); };
  const send = (andAsk: boolean) => { if (mine.trim()) addUserReply(card.id, mine); setMine(''); if (andAsk) setTimeout(askHim, 30); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: 'rgba(40,32,24,0.35)', backdropFilter: 'blur(3px)' }} />
      <div className="relative w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}
        style={{ background: tn.paper, borderRadius: 3, transform: 'rotate(-1deg)', animation: 'footDrop .3s ease-out both', ['--r' as any]: '-1deg' }}>
        <Tape color={tn.tape} seed={2} wide />
        <div className="max-h-[78vh] overflow-y-auto no-scrollbar p-5 pt-7">
        <div className="text-[10px] mb-2" style={{ color: T.soft }}>{card.author === 'user' ? '我贴的' : `${char.name} · ${KIND_LABEL[card.kind]}`}{card.source ? ` · ${card.source}` : ''}</div>
        {card.quote && <div className="text-[12px] leading-relaxed italic mb-2" style={{ color: T.soft, fontFamily: serif }}>{card.kind === 'frame' ? card.quote : `「${card.quote}」`}</div>}
        <div className="leading-relaxed" style={{ fontFamily: fontCss(card.font), fontSize: 17, color: T.ink }}>{card.note}</div>

        {(th.length > 0 || waiting) && <div className="mt-4 pt-3 border-t border-dashed space-y-2" style={{ borderColor: 'rgba(0,0,0,0.15)' }}>
          {th.map((t, i) => (
            <div key={i} className={t.by === 'user' ? 'text-right' : ''}>
              <span className="text-[9px] opacity-45 mx-1">{t.by === 'user' ? '我' : char.name}</span>
              <div style={{ fontFamily: fontCss(t.by === 'user' ? myFont : loadCharFont()), fontSize: 14.5, color: T.ink }}>{t.text}</div>
            </div>
          ))}
          {waiting && <div className="text-[11px] opacity-50">{char.name}拿起笔…</div>}
        </div>}

        <div className="mt-4 pt-3 border-t border-dashed" style={{ borderColor: 'rgba(0,0,0,0.12)' }}>
          <textarea value={mine} onChange={e => setMine(e.target.value)} rows={2} placeholder="在下面写一句…"
            className="block w-full min-w-0 bg-transparent outline-none resize-none" style={{ fontFamily: fontCss(myFont), fontSize: 14, color: T.ink, backgroundImage: 'repeating-linear-gradient(transparent, transparent 25px, rgba(0,0,0,0.08) 25px, rgba(0,0,0,0.08) 26px)', lineHeight: '26px' }} />
          <div className="flex justify-end items-center gap-3 mt-2">
            {mine.trim() && <button onClick={() => send(false)} className="text-[11px] opacity-60">只写上</button>}
            <button onClick={() => send(true)} disabled={waiting || (!mine.trim() && th.length > 0 && th[th.length - 1].by === 'char')}
              className="px-3 py-1.5 rounded-full text-[11.5px] text-white disabled:opacity-40" style={{ background: T.ink }}>{mine.trim() ? '写上，等他回' : '等他回一句'}</button>
          </div>
        </div>

        <div className="flex justify-between mt-4 text-[11px]">
          <button onClick={() => updateFootnote(s => ({ ...s, cards: s.cards.filter(x => x.id !== card.id) }))} className="flex items-center gap-1 text-rose-400"><Trash size={13} />撕掉</button>
          <button onClick={() => updateFootnote(s => ({ ...s, cards: s.cards.map(x => x.id === card.id ? { ...x, starred: !x.starred } : x) }))}
            className="flex items-center gap-1" style={{ color: T.candle }}><Star size={13} weight={card.starred ? 'fill' : 'regular'} />{card.starred ? '取消收藏' : '收藏'}</button>
          <button onClick={() => shareNote(card, char.name, userName).then(() => onShared?.()).catch(onErr)} className="flex items-center gap-1" style={{ color: T.ink }}><PaperPlaneTilt size={13} />发到聊天</button>
          <button onClick={onClose} className="opacity-60">收起</button>
        </div>
        </div>
      </div>
    </div>
  );
};

/* ───────── 快问快答 ───────── */

/** 旧黄铜边的题目转盘：八格旧纸，每格一个小记号，中间一朵茉莉 */
const Wheel: React.FC<{ angle: number }> = ({ angle }) => {
  // \uFE0E：强制按文字字形显示，不让 ☕ ✉ 变成彩色 emoji
  const glyphs = ['☾', '✦', '♪', '❀', '✎', '☂', '✉', '☕'].map(g => g + '\uFE0E');
  const papers = ['#fbf4e6', '#f1e4cf', '#f8efdf', '#ead9bf'];
  const R = 92, C = 100;
  const pt = (deg: number, r: number) => [C + r * Math.sin(deg * Math.PI / 180), C - r * Math.cos(deg * Math.PI / 180)];
  return (
    <div className="relative" style={{ width: 200, height: 210 }}>
      {/* 指针 */}
      <svg className="absolute left-1/2 -translate-x-1/2 z-10" style={{ top: -2 }} width="22" height="30" viewBox="0 0 22 30">
        <defs><linearGradient id="fnBrassP" x1="0" x2="1"><stop offset="0" stopColor="#e2c48d" /><stop offset="1" stopColor="#9a7442" /></linearGradient></defs>
        <path d="M11 29 L3 9 A8 8 0 1 1 19 9 Z" fill="url(#fnBrassP)" stroke="#6e5230" strokeWidth=".8" />
        <circle cx="11" cy="8" r="2.6" fill="#fffaf0" opacity=".85" />
      </svg>
      <svg width="200" height="200" viewBox="0 0 200 200" className="absolute left-0 top-2.5" style={{ filter: 'drop-shadow(0 6px 14px rgba(60,45,30,0.18))' }}>
        <defs>
          <linearGradient id="fnBrass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e6cc98" /><stop offset=".5" stopColor="#b8935a" /><stop offset="1" stopColor="#8a6a3c" /></linearGradient>
          <radialGradient id="fnPaperShade" cx=".5" cy=".5" r=".5"><stop offset=".6" stopColor="rgba(0,0,0,0)" /><stop offset="1" stopColor="rgba(90,60,30,0.12)" /></radialGradient>
        </defs>
        <circle cx={C} cy={C} r="99" fill="url(#fnBrass)" />
        <circle cx={C} cy={C} r="95" fill="#f7efe0" />
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '100px 100px', transition: 'transform 1.6s cubic-bezier(.17,.67,.25,1.04)' }}>
          {glyphs.map((g, i) => {
            const a0 = i * 45, a1 = a0 + 45;
            const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R);
            const [gx, gy] = pt(a0 + 22.5, 64);
            return (
              <g key={i}>
                <path d={`M${C} ${C} L${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1} Z`} fill={papers[i % 4]} stroke="rgba(47,52,66,0.35)" strokeWidth=".6" />
                <text x={gx} y={gy} textAnchor="middle" dominantBaseline="central" fontSize="15" fill="#5a4a35" transform={`rotate(${a0 + 22.5} ${gx} ${gy})`} style={{ fontFamily: serif }}>{g}</text>
              </g>
            );
          })}
          {Array.from({ length: 48 }, (_, i) => { const [x0, y0] = pt(i * 7.5, R - 1); const [x1, y1] = pt(i * 7.5, R - (i % 6 === 0 ? 7 : 4)); return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="rgba(47,52,66,0.4)" strokeWidth=".6" />; })}
          <circle cx={C} cy={C} r={R} fill="url(#fnPaperShade)" />
        </g>
        <circle cx={C} cy={C} r="22" fill="url(#fnBrass)" />
        <circle cx={C} cy={C} r="18.5" fill="#fffaf0" />
        {[0, 72, 144, 216, 288].map(a => <ellipse key={a} cx={C} cy={C - 7} rx="3.6" ry="6" fill="#fffdf6" stroke="#e2d6bc" strokeWidth=".6" transform={`rotate(${a} ${C} ${C})`} />)}
        <circle cx={C} cy={C} r="2.6" fill="#e8c873" />
      </svg>
    </div>
  );
};

const Qa: React.FC<{ char: any; apiConfig: any; rounds: any[]; onErr: (e: any) => void; userName: string; onShared?: () => void }> = ({ char, apiConfig, rounds, onErr, userName, onShared }) => {
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

  return (
    <>
      <div className="flex flex-col items-center mt-2 mb-4">
        <Wheel angle={angle} />
        <button onClick={spin} disabled={spinning || revealing} className="mt-3 px-6 py-2 rounded-full text-sm text-white active:scale-95 disabled:opacity-60"
          style={{ background: T.ink, fontFamily: serif }}>{spinning ? '转呀转…' : q ? '再转一次' : '转一下'}</button>
      </div>

      {q && (
        <div className="relative p-4 pt-5 mb-5 mx-1" style={{ background: '#fffcf3', borderRadius: 3, boxShadow: '0 3px 10px rgba(60,45,30,0.10)', transform: 'rotate(-0.6deg)' }}>
          <Tape color="rgba(222,190,140,0.32)" seed={4} wide />
          <div className="text-[10px] mb-1" style={{ color: T.candle }}>{q.fromBank ? '从题罐里抽的' : `${char.name}现场出的题`}</div>
          <div className="text-[15px] font-semibold leading-relaxed mb-3" style={{ fontFamily: serif }}>{q.text}</div>
          {!result ? (
            <>
              <textarea value={mine} onChange={e => setMine(e.target.value)} rows={2} placeholder="你的答案（揭晓时才一起翻开）"
                className="w-full text-[13px] p-2.5 rounded-xl outline-none resize-none" style={{ background: T.bg }} />
              <button onClick={reveal} disabled={!mine.trim() || revealing} className="mt-2 w-full py-2 rounded-xl text-sm text-white disabled:opacity-50" style={{ background: T.candle }}>
                {revealing ? `${char.name}在想…` : '一起揭晓'}
              </button>
            </>
          ) : (
            <>
              <Reveal r={result} name={char.name} />
              <div className="text-right mt-2"><button onClick={() => shareQa(result, char.name, userName).then(() => onShared?.()).catch(onErr)} className="text-[10.5px] inline-flex items-center gap-1" style={{ color: T.soft }}><PaperPlaneTilt size={11} />发到聊天</button></div>
            </>
          )}
        </div>
      )}

      {rounds.length > 0 && <div className="text-[11px] mb-2 opacity-60">以前答过的</div>}
      {rounds.filter(r => r.id !== result?.id).slice(0, 30).map(r => (
        <div key={r.id} className="p-3 pb-4 rounded-xl mb-3" style={{ background: 'rgba(255,252,243,0.55)', border: `1px dashed ${T.line}` }}>
          <div className="text-[12.5px] font-semibold mb-1.5" style={{ fontFamily: serif }}>{r.question}</div>
          <Reveal r={r} name={char.name} small />
          <div className="text-right mt-2"><button onClick={() => shareQa(r, char.name, userName).then(() => onShared?.()).catch(onErr)} className="text-[10.5px] inline-flex items-center gap-1" style={{ color: T.soft }}><PaperPlaneTilt size={11} />发到聊天</button></div>
        </div>
      ))}
    </>
  );
};

const Reveal: React.FC<{ r: any; name: string; small?: boolean }> = ({ r, name, small }) => {
  const myFont = (() => { try { return localStorage.getItem('sully_footnote_my_font_v1') || 'kai'; } catch { return 'kai'; } })();
  const fs = small ? 12.5 : 14;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mt-1">
        {[
          { who: '你', text: r.mine, paper: '#fff6f4', tape: 'rgba(225,165,170,0.30)', font: myFont, rot: -1.5 },
          { who: name, text: r.his, paper: '#f4f8fc', tape: 'rgba(150,180,215,0.30)', font: loadCharFont(), rot: 1.5 },
        ].map((n, i) => (
          <div key={i} className="relative p-2.5 pt-3.5" style={{ background: n.paper, borderRadius: 2, transform: `rotate(${n.rot}deg)`, boxShadow: '0 2px 6px rgba(60,45,30,0.08)' }}>
            <Tape color={n.tape} seed={i * 5 + 2} />
            <div className="text-[9px] mb-0.5" style={{ color: T.soft }}>{n.who}</div>
            <div className="leading-relaxed" style={{ fontFamily: fontCss(n.font), fontSize: fs, color: T.ink }}>{n.text}</div>
          </div>
        ))}
      </div>
      {r.reaction && <div className="mt-3 text-center italic" style={{ fontFamily: fontCss(loadCharFont()), fontSize: fs, color: T.soft }}>—— {r.reaction}</div>}
    </div>
  );
};

/* ───────── 深夜点播：像接通一通深夜电话 ───────── */

const displayText = (s: string) => s.replace(/\[[^\]]{1,24}\]/g, '').replace(/<[^>]+>/g, '').replace(/\s{2,}/g, ' ').trim();
/** 哄睡：念之前把感叹号、大笑之类会突然变响的东西压平 */
const soften = (s: string) => s.replace(/[！!]+/g, '。').replace(/(哈|呵|嘿){2,}|(ha){2,}/gi, '').replace(/\[(?:laugh|laughs|shout|shouts|excited|yell)[^\]]*\]/gi, '').trim();
const fmtClock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/** 慢慢转的黑胶，垫在头像后面 */
const Vinyl: React.FC<{ spinning: boolean }> = ({ spinning }) => (
  <div className="absolute inset-0 rounded-full" style={{
    background: 'repeating-radial-gradient(circle at 50% 50%, #15161d 0, #15161d 2px, #23252f 3px, #15161d 5px)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.04)',
    animation: 'footSpin 14s linear infinite', animationPlayState: spinning ? 'running' : 'paused',
  }}>
    <div className="absolute inset-0 rounded-full" style={{ background: 'conic-gradient(from 30deg, transparent 0 40deg, rgba(255,255,255,0.07) 60deg, transparent 80deg 220deg, rgba(255,255,255,0.05) 240deg, transparent 260deg)' }} />
  </div>
);

const RadioTab: React.FC<{ char: any; apiConfig: any; pieces: RadioPiece[]; onErr: (e: any) => void; bg?: string; userName: string; onShared?: () => void }> = ({ char, apiConfig, pieces, onErr, bg, userName, onShared }) => {
  const [busy, setBusy] = useState<RadioChannel | null>(null);
  const [current, setCurrent] = useState<RadioPiece | null>(null);
  const [shown, setShown] = useState(0);
  const [speaking, setSpeaking] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [bilingual, setBilingual] = useState(() => { try { return localStorage.getItem('sully_footnote_radio_bi_v1') !== '0'; } catch { return true; } });
  const [showTranscript, setShowTranscript] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const lang = char.callVoiceLang || 'en';
  const hasVoice = useMemo(() => { try { return characterHasVoice(char, apiConfig); } catch { return false; } }, [char, apiConfig]);
  const segs = useMemo(() => current ? parseRadioSegments(current.text) : [], [current]);
  const runRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlCache = useRef<Map<string, Promise<string | null>>>(new Map());
  const pausedRef = useRef(false);
  const warned = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { try { localStorage.setItem('sully_footnote_radio_bi_v1', bilingual ? '1' : '0'); } catch { /* ignore */ } }, [bilingual]);
  useEffect(() => {
    if (!playing || paused) return;
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [playing, paused]);
  useEffect(() => { if (showTranscript) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [shown, showTranscript]);

  const stopAll = () => { runRef.current++; pausedRef.current = false; audioRef.current?.pause(); audioRef.current = null; setPlaying(false); setPaused(false); setSpeaking(-1); };
  useEffect(() => () => stopAll(), []);

  const tts = (piece: RadioPiece, i: number, text: string) => {
    const key = `${piece.id}:${i}`;
    if (!urlCache.current.has(key)) {
      const opts = piece.voiceLang ? { languageBoost: piece.voiceLang } : undefined;
      urlCache.current.set(key, (async () => {
        const saved = await getRadioAudio(piece.id, i);
        if (saved) return URL.createObjectURL(saved);
        const url = await synthesizeSpeech(text, char, apiConfig, opts);
        // 存一份到本机：重播不再花钱，也能下载
        fetch(url).then(r => r.blob()).then(b => saveRadioAudio(piece.id, i, b)).catch(() => {});
        return url;
      })().catch(e => {
        if (!warned.current) { warned.current = true; onErr(new Error(`语音没合成出来，先用字幕播：${e?.message || e}`)); }
        return null;
      }));
    }
    return urlCache.current.get(key)!;
  };

  const run = async (piece: RadioPiece, from: number) => {
    const my = ++runRef.current;
    const list = parseRadioSegments(piece.text);
    pausedRef.current = false; setPaused(false); setPlaying(true);
    for (let i = from; i < list.length; i++) {
      if (runRef.current !== my) return;
      const url = hasVoice ? await tts(piece, i, soften(list[i].voice)) : null;
      if (hasVoice && i + 1 < list.length) void tts(piece, i + 1, soften(list[i + 1].voice));
      if (runRef.current !== my) return;
      setShown(s => Math.max(s, i + 1));
      setSpeaking(i);
      if (url) {
        await new Promise<void>(resolve => {
          const a = new Audio(url);
          audioRef.current = a;
          a.onended = () => resolve(); a.onerror = () => resolve();
          a.play().catch(() => resolve());
        });
      } else {
        await new Promise(r => setTimeout(r, Math.min(9000, 1200 + displayText(list[i].zh).length * 170)));
      }
      while (pausedRef.current && runRef.current === my) await new Promise(r => setTimeout(r, 200));
      if (runRef.current === my) await new Promise(r => setTimeout(r, 350));
    }
    if (runRef.current === my) { setPlaying(false); setSpeaking(-1); }
  };

  const startPiece = (p: RadioPiece) => { stopAll(); setCurrent(p); setShown(0); setElapsed(0); setShowHistory(false); setTimeout(() => run(p, 0), 50); };
  const [topic, setTopic] = useState('');
  const tune = (ch: RadioChannel) => {
    stopAll(); setBusy(ch);
    playRadio(char, apiConfig, ch, bilingual ? lang : '', ch === 'free' ? topic : '').then(p => { setTopic(''); startPiece(p); }).catch(onErr).finally(() => setBusy(null));
  };
  const togglePause = () => {
    if (!current) return;
    if (!playing) { const from = shown > 0 && shown < segs.length ? shown : 0; if (!from) setShown(0); run(current, from); return; }
    if (pausedRef.current) { pausedRef.current = false; setPaused(false); audioRef.current?.play().catch(() => {}); }
    else { pausedRef.current = true; setPaused(true); audioRef.current?.pause(); }
  };
  const hangUp = () => { stopAll(); setCurrent(null); setShown(0); setElapsed(0); };
  const save = (blob: Blob, name: string) => {
    const u = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
  };
  const downloadPiece = async (p: RadioPiece) => {
    const name = `${char.name}-${p.title}`.replace(/[\\/:*?"<>|]/g, '');
    const { blob, missing } = await collectRadioAudio(p);
    if (blob) save(blob, `${name}.mp3`);
    const text = `${p.title}\n${RADIO_CHANNELS.find(c => c.id === p.channel)?.name} · ${new Date(p.createdAt).toLocaleString()}\n\n` +
      parseRadioSegments(p.text).map(sg => sg.voice !== sg.zh ? `${displayText(sg.voice)}\n${displayText(sg.zh)}` : displayText(sg.zh)).join('\n\n');
    save(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${name}.txt`);
    if (!blob) onErr(new Error('这期还没有存下来的音频（播一遍就有了），先下载了文字稿'));
    else if (missing) onErr(new Error(`有 ${missing} 段还没播到，音频里没有这几段`));
  };

  const live = playing && !paused;
  const line = speaking >= 0 ? segs[speaking] : (shown > 0 ? segs[shown - 1] : null);
  const isBi = !!current?.voiceLang;
  const chName = current ? RADIO_CHANNELS.find(c => c.id === current.channel)?.name : '';

  return (
    <div className="relative -mx-4 -mt-1 px-5 flex flex-col" style={{ minHeight: 'calc(100% + 4px)' }}>
      <style>{`@keyframes footSpin { to { transform: rotate(360deg) } }
@keyframes footRing { 0% { transform: scale(1); opacity: .55 } 100% { transform: scale(1.55); opacity: 0 } }
@keyframes footSub { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes footEq { from { height: 3px } to { height: 14px } }`}</style>

      <div className="relative flex items-center justify-between text-[10px] tracking-[0.3em] opacity-75 mb-2">
        <span className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${live ? 'animate-pulse' : ''}`} style={{ background: current ? '#e0605a' : 'rgba(233,226,214,0.3)' }} />{current ? 'ON AIR' : 'OFF AIR'}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{current ? fmtClock(elapsed) : 'LATE NIGHT'}</span>
      </div>

      {/* 头像 + 黑胶 + 说话时的光圈 */}
      <div className="relative mx-auto mt-4 mb-4" style={{ width: 200, height: 200 }}>
        <Vinyl spinning={live} />
        {live && [0, 1].map(k => (
          <div key={k} className="absolute rounded-full" style={{ inset: 46, border: `1.5px solid ${T.candle}`, animation: `footRing 2.4s ease-out ${k * 1.2}s infinite` }} />
        ))}
        <div className="absolute rounded-full overflow-hidden" style={{ inset: 46, boxShadow: live ? `0 0 0 2px ${T.candle}, 0 0 30px rgba(185,135,90,0.45)` : '0 0 0 2px rgba(233,226,214,0.18)' }}>
          {char.avatar ? <TokenImg value={char.avatar} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-2xl" style={{ background: '#2a2d3a' }}>{(char.name || '·').slice(0, 1)}</div>}
        </div>
      </div>
      <div className="relative text-center">
        <div className="text-[17px] tracking-[0.2em]" style={{ fontFamily: serif }}>{char.name}</div>
        <div className="text-[10.5px] opacity-55 mt-1">{current ? `${chName} · ${current.title}` : busy ? '正在调频…' : '选一个频道，他就开始讲'}</div>
      </div>

      {/* 字幕 */}
      <div className="relative mt-5 min-h-[96px] flex items-center justify-center">
        {line ? (
          <div key={speaking} className="w-full px-4 py-3 rounded-2xl text-center" style={{ background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(233,226,214,0.10)', backdropFilter: 'blur(12px)', animation: 'footSub .35s ease-out both' }}>
            {isBi && line.voice !== line.zh && <div className="text-[14.5px] leading-relaxed" style={{ fontFamily: `'Cormorant Garamond','Georgia',serif`, fontStyle: 'italic' }}>{displayText(line.voice)}</div>}
            <div className={`${isBi && line.voice !== line.zh ? 'text-[11.5px] opacity-65 mt-1' : 'text-[14px]'} leading-relaxed`} style={{ fontFamily: serif }}>{displayText(line.zh)}</div>
          </div>
        ) : !current && (
          <div className="w-full">
            <div className="grid grid-cols-2 gap-2">
              {RADIO_CHANNELS.filter(ch => !ch.hidden && ch.id !== 'free').map(ch => (
                <button key={ch.id} onClick={() => tune(ch.id)} disabled={!!busy}
                  className="p-2.5 rounded-2xl text-left active:scale-95 disabled:opacity-60"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(233,226,214,0.14)' }}>
                  <div className="text-[12px] font-semibold" style={{ fontFamily: serif }}>{busy === ch.id ? '调频中…' : ch.name}</div>
                  <div className="text-[9.5px] opacity-55 mt-0.5 leading-snug">{ch.desc}</div>
                </button>
              ))}
            </div>
            <div className="mt-2 p-2.5 rounded-2xl flex items-center gap-2" style={{ background: 'rgba(185,135,90,0.12)', border: '1px solid rgba(185,135,90,0.3)' }}>
              <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="想听什么？不填就让他看着办"
                className="flex-1 min-w-0 bg-transparent outline-none text-[12px] placeholder:opacity-50" style={{ fontFamily: serif, color: 'inherit' }} />
              <button onClick={() => tune('free')} disabled={!!busy} className="shrink-0 px-3 py-1.5 rounded-full text-[11.5px] disabled:opacity-60" style={{ background: T.candle, color: '#fff' }}>
                {busy === 'free' ? '他在想…' : topic.trim() ? '点这个' : '他看着办'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 字幕记录 */}
      {current && showTranscript && (
        <div className="relative mt-3 max-h-56 overflow-y-auto no-scrollbar space-y-1.5 px-1">
          {segs.slice(0, Math.max(shown, playing ? 0 : segs.length)).map((sg, i) => (
            <div key={i} className="text-[12px] leading-relaxed" style={{ opacity: i === speaking ? 1 : 0.55, fontFamily: serif }}>
              {isBi && sg.voice !== sg.zh && <div className="italic">{displayText(sg.voice)}</div>}
              <div className={isBi ? 'text-[11px] opacity-80' : ''}>{displayText(sg.zh)}</div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {pieces.length > 0 && (
        <div className="relative mt-5 pb-2">
          <div className="text-[10px] opacity-45 mb-1 tracking-[0.2em]">以前的节目</div>
          {pieces.slice(0, 40).map(p => (
            <div key={p.id} className="flex items-center gap-2 py-2 border-b" style={{ borderColor: 'rgba(233,226,214,0.08)', opacity: current?.id === p.id ? 1 : 0.85 }}>
              <button onClick={() => startPiece(p)} className="flex-1 min-w-0 text-left">
                <div className="text-[12px] truncate" style={{ fontFamily: serif, color: current?.id === p.id ? T.candle : undefined }}>{p.title}</div>
                <div className="text-[9.5px] opacity-45">{RADIO_CHANNELS.find(c => c.id === p.channel)?.name || '电台'}{p.voiceLang ? ' · 双语' : ''} · {new Date(p.createdAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
              </button>
              <button onClick={() => shareRadio(p, char.name, userName).then(() => onShared?.()).catch(onErr)} className="p-1.5 opacity-60" title="发到聊天"><PaperPlaneTilt size={15} /></button>
              <button onClick={() => downloadPiece(p)} className="p-1.5 opacity-60" title="下载"><DownloadSimple size={15} /></button>
              <button onClick={() => { if (current?.id === p.id) hangUp(); void deleteRadioPiece(p); }} className="p-1.5 opacity-50 text-rose-300" title="删除"><Trash size={15} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="flex-1" />

      {/* 底部按钮：像打电话那一排（吸底） */}
      <div className="sticky bottom-0 z-10 grid grid-cols-4 gap-2 pt-6 pb-2 -mx-5 px-5" style={{ background: 'linear-gradient(transparent, rgba(17,19,27,0.92) 35%)' }}>
        {[
          { label: current ? '换台' : '随便听', icon: <ArrowsClockwise size={20} />, on: false, act: () => current ? hangUp() : (() => { const pool = RADIO_CHANNELS.filter(c => !c.hidden); tune(pool[Math.floor(Math.random() * pool.length)].id); })(), disabled: !!busy },
          { label: playing && !paused ? '暂停' : '继续', icon: playing && !paused ? <Pause size={20} weight="fill" /> : <Play size={20} weight="fill" />, on: live, act: togglePause, disabled: !current },
          { label: bilingual ? '双语 ON' : '双语 OFF', icon: <Translate size={20} />, on: bilingual, act: () => setBilingual(v => !v) },
          { label: showTranscript ? '收起字幕' : '字幕记录', icon: <ChatCircle size={20} />, on: showTranscript, act: () => setShowTranscript(v => !v), disabled: !current },
        ].map((b, i) => (
          <button key={i} onClick={b.act} disabled={b.disabled} className="flex flex-col items-center gap-1.5 active:scale-95 disabled:opacity-30">
            <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: b.on ? 'rgba(185,135,90,0.3)' : 'rgba(255,255,255,0.06)', border: `1px solid ${b.on ? 'rgba(185,135,90,0.6)' : 'rgba(233,226,214,0.15)'}` }}>{b.icon}</span>
            <span className="text-[10px] opacity-70">{b.label}</span>
          </button>
        ))}
      </div>
      <div className="relative text-center text-[9.5px] opacity-40 pb-2">
        {!hasVoice ? '他还没配语音，只有字幕' : bilingual ? `下一段会用${voiceLanguageLabel(lang)}念，配中文字幕` : '下一段只念中文'}
        {live && <span className="inline-flex items-end gap-[2px] h-3 ml-2 align-middle">{[0, 1, 2, 3].map(k => <span key={k} className="w-[2px] rounded-sm" style={{ background: T.candle, animation: `footEq 0.${6 + k}s ease-in-out ${k * 0.1}s infinite alternate` }} />)}</span>}
      </div>

    </div>
  );
};

export default FootnoteApp;
