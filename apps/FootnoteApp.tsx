/**
 * 页脚 —— 便签墙 · 快问快答转盘 · 深夜点播机。旧信纸 + 墨水 + 烛光。
 * 逻辑见 utils/footnote.ts。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { CaretLeft, Star, Trash, ArrowsClockwise, Play, Pause, PencilSimple, ChatCircle, TextAa, Translate, ImageSquare, DownloadSimple, PaperPlaneTilt, Sparkle, Moon } from '@phosphor-icons/react';
import { isNaiReady, generateNaiImage } from '../utils/nai';
import { shareNote, shareRadio, shareQa, shareCapsule } from '../utils/footnoteShare';
import { isFootnoteChatOn, setFootnoteChatOn } from '../utils/footnoteChat';
import { computeHateStats, saveHateTotal, type HateStats } from '../utils/hateCounter';
import { startNoise, NOISE_NAMES, NOISE_KINDS, type NoiseKind, type NoisePlayer } from '../utils/sleepNoise';
import { voiceLanguageLabel } from '../utils/voiceLanguage';
import { DB } from '../utils/db';
import {
  loadFootnote, updateFootnote, FOOTNOTE_CHANGED_EVENT, dropCards, QA_BANK, generateQuestion, answerQuestion,
  RADIO_CHANNELS, playRadio, addUserNote, addUserReply, replyToNote, threadOf, parseRadioSegments,
  getRadioAudio, saveRadioAudio, deleteRadioPiece, collectRadioAudio, drawCardImage,
  removeAskedQuestion, sealCapsule, openCapsule, canOpenCapsule, todayKey, SLEEP_SCRIPT_NOTE, type Capsule,
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

type Tab = 'wall' | 'qa' | 'radio' | 'capsule';

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
  const [naiBgOpen, setNaiBgOpen] = useState(false);
  const BG_PRESET: Record<string, string> = {
    wall: 'cozy study room, wooden desk, stacked books, vinyl records, jasmine flowers in a glass, warm desk lamp, rainy window, cork board with notes, soft light, london',
    radio: 'night, dark room, rainy window, city lights bokeh, vinyl record player, dim warm lamp, curtains, quiet, london, cinematic lighting',
  };
  const [bgTags, setBgTags] = useState('');
  const [bgMsg, setBgMsg] = useState('');
  const drawBg = async () => {
    const k = tab === 'radio' ? 'radio' : 'wall';
    setBgMsg('准备中…');
    try {
      const blob = await generateNaiImage(bgTags.trim() || BG_PRESET[k], { orient: 'portrait', onProgress: m => setBgMsg(m) });
      await DB.saveAssetRaw(bgKey(tab), { blob, mimeType: blob.type });
      setBgs(b => ({ ...b, [k]: URL.createObjectURL(blob) }));
      setBgMsg(''); setNaiBgOpen(false);
    } catch (e: any) { setBgMsg(''); toastErr(e); }
  };

  return (
    <div className="h-full w-full flex flex-col transition-colors duration-500"
      style={{
        background: curBg
          ? (night ? `linear-gradient(rgba(17,19,27,0.6), rgba(17,19,27,0.9)), url(${curBg}) center / cover no-repeat` : `linear-gradient(rgba(243,238,230,0.5), rgba(243,238,230,0.78)), url(${curBg}) center / cover no-repeat`)
          : (night ? `linear-gradient(180deg, ${T.night1}, ${T.night2})` : T.bg),
        color: night ? '#e9e2d6' : T.ink,
      }}>
      <style>{`@keyframes footDrop { 0% { opacity: 0; transform: translateY(-24px) rotate(var(--r)) scale(1.04) } 100% { opacity: 1; transform: rotate(var(--r)) } }`}</style>
      <div className="shrink-0 px-3 pb-2 flex items-center gap-2" style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}>
        <button onClick={closeApp} className="p-1.5 -ml-1 active:scale-90"><CaretLeft size={22} /></button>
        <div className="text-lg tracking-[0.35em] font-semibold flex items-center gap-1.5" style={{ fontFamily: serif }}><Jasmine />页脚</div>
        <div className="flex-1" />
        {tab !== 'qa' && (
          <>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { pickBg(e.target.files?.[0]); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()} className="p-1.5 opacity-70" title="换背景图"><ImageSquare size={18} /></button>
            {isNaiReady() && <button onClick={() => setNaiBgOpen(v => !v)} className="p-1.5 opacity-70" title="用 NovelAI 画背景"><Sparkle size={17} /></button>}
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

      {naiBgOpen && tab !== 'qa' && (
        <div className="shrink-0 mx-4 mb-2 p-3 rounded-xl text-[11px]" style={{ background: night ? 'rgba(255,255,255,0.06)' : T.card, border: `1px solid ${night ? 'rgba(233,226,214,0.15)' : T.line}` }}>
          <div className="mb-1 opacity-70">用 NovelAI 画一张{tab === 'radio' ? '深夜点播' : '便签墙'}的背景（英文 tag，不填用默认）</div>
          <textarea value={bgTags} onChange={e => setBgTags(e.target.value)} rows={2} placeholder={BG_PRESET[tab === 'radio' ? 'radio' : 'wall']}
            className="w-full bg-transparent outline-none resize-none text-[11px] placeholder:opacity-50" style={{ color: 'inherit' }} />
          <div className="flex justify-end gap-3 mt-1">
            <button onClick={() => setNaiBgOpen(false)} className="opacity-60">算了</button>
            <button onClick={drawBg} disabled={!!bgMsg} className="px-3 py-1 rounded-full text-white disabled:opacity-60" style={{ background: T.candle }}>{bgMsg || '画'}</button>
          </div>
        </div>
      )}
      <div className="shrink-0 mx-4 mb-2 flex justify-center gap-5 text-[13px]" style={{ fontFamily: serif }}>
        {([['wall', '便签墙'], ['qa', '快问快答'], ['radio', '深夜点播'], ['capsule', '胶囊']] as [Tab, string][]).map(([k, n]) => (
          <button key={k} onClick={() => setTab(k)} className="pb-1 transition-opacity"
            style={{ opacity: tab === k ? 1 : 0.45, borderBottom: `1.5px solid ${tab === k ? T.candle : 'transparent'}` }}>{n}</button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-10">
        {!char ? <div className="text-center text-xs mt-10 opacity-60">先去建一个角色吧</div>
          : tab === 'wall' ? <Wall char={char} apiConfig={apiConfig} cards={store.cards.filter(c => c.charId === char.id)} onErr={toastErr} bg={bgs.wall} userName={userName} onShared={onShared} />
          : tab === 'qa' ? <Qa char={char} apiConfig={apiConfig} rounds={store.qa.filter(q => q.charId === char.id)} asked={(store.asked || []).filter(a => a.charId === char.id)} onErr={toastErr} userName={userName} onShared={onShared} />
          : tab === 'capsule' ? <CapsuleTab char={char} apiConfig={apiConfig} capsules={(store.capsules || []).filter(c => c.charId === char.id)} onErr={toastErr} userName={userName} onShared={onShared} />
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
  const [fnChatOn, setFnChatOn] = useState(() => isFootnoteChatOn(char.id));
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const drop = () => {
    setBusy(true);
    dropCards(char, apiConfig).then(list => {
      setFresh(new Set(list.map(c => c.id))); setFilter('all');
      // 截帧便签自动配图（排队一张张画，画好自己出现）
      if (isNaiReady()) {
        void (async () => { for (const c of list) if (c.kind === 'frame' && c.scene) { try { await drawCardImage(c.id, char.id); } catch (e) { onErr(e); break; } } })();
      }
    }).catch(onErr).finally(() => setBusy(false));
  };
  // 他自己会来贴：墙上他的上一张已经是 20 小时前了，打开页脚时他顺手贴两张新的、顺便回你留的纸条
  useEffect(() => {
    try {
      const key = `sully_footnote_autodrop_${char.id}`;
      const last = Math.max(Number(localStorage.getItem(key) || 0), ...cards.filter(c => c.author !== 'user').map(c => c.createdAt), 0);
      if (Date.now() - last < 20 * 3600 * 1000 || busy) return;
      localStorage.setItem(key, String(Date.now()));
      setBusy(true);
      dropCards(char, apiConfig, 2).then(list => setFresh(new Set(list.map(c => c.id)))).catch(() => { /* 静默：没配好 API 就算了 */ }).finally(() => setBusy(false));
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char.id]);
  const post = () => {
    if (!draft.trim()) return;
    try { localStorage.setItem('sully_footnote_my_font_v1', font); } catch { /* ignore */ }
    addUserNote(char.id, draft, font, tint); setDraft(''); setWriting(false);
  };

  const shown = cards.filter(c => filter === 'all' ? true : filter === 'star' ? c.starred : filter === 'mine' ? c.author === 'user' : c.author !== 'user');
  const open = cards.find(c => c.id === openId) || null;
  return (
    <div className="min-h-full" data-bg={bg ? '1' : '0'}>
      <HateCounter char={char} userName={userName} />
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
          <label className="flex items-start justify-between gap-3 mb-3 pb-3 border-b" style={{ borderColor: T.line }}>
            <span><span className="block font-semibold">{char.name}在聊天里也能用页脚</span><span className="block opacity-60 mt-0.5">他可以自己贴便签、出题、给你点播，聊天里会收到一张小卡片。</span></span>
            <input type="checkbox" className="mt-1" checked={fnChatOn} onChange={e => { setFootnoteChatOn(char.id, e.target.checked); setFnChatOn(e.target.checked); }} />
          </label>
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
              {(c.image || c.imaging) && (
                <div className="mb-2 p-1 pb-3 bg-white shadow-sm" style={{ transform: 'rotate(1deg)' }}>
                  {c.image ? <TokenImg value={c.image} alt="" className="w-full block" /> : <div className="w-full aspect-[3/2] flex items-center justify-center text-[10px]" style={{ background: '#efe7d8', color: T.soft }}>冲洗中…</div>}
                </div>
              )}
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
  const [drawMsg, setDrawMsg] = useState('');
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
        {(card.image || card.imaging) && (
          <div className="mb-3 p-1.5 pb-5 bg-white shadow" style={{ transform: 'rotate(1.2deg)' }}>
            {card.image ? <TokenImg value={card.image} alt="" className="w-full block" /> : <div className="w-full aspect-[3/2] flex items-center justify-center text-[11px]" style={{ background: '#efe7d8', color: T.soft }}>{drawMsg || '冲洗中…'}</div>}
          </div>
        )}
        {card.scene && isNaiReady() && !card.imaging && (
          <button onClick={() => { setDrawMsg('准备中…'); drawCardImage(card.id, char.id, m => setDrawMsg(m)).catch(onErr).finally(() => setDrawMsg('')); }}
            className="mb-2 text-[10.5px] inline-flex items-center gap-1" style={{ color: T.candle }}><ImageSquare size={12} />{card.image ? '重画这张图' : '配张图'}</button>
        )}
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

const Qa: React.FC<{ char: any; apiConfig: any; rounds: any[]; asked: { id: string; question: string }[]; onErr: (e: any) => void; userName: string; onShared?: () => void }> = ({ char, apiConfig, rounds, asked, onErr, userName, onShared }) => {
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [q, setQ] = useState<{ text: string; fromBank: boolean; askedId?: string } | null>(null);
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
    answerQuestion(char, apiConfig, q.text, mine.trim(), q.fromBank).then(r => { setResult(r); if (q.askedId) removeAskedQuestion(q.askedId); }).catch(onErr).finally(() => setRevealing(false));
  };

  return (
    <>
      {asked.length > 0 && (
        <div className="mb-3 space-y-2">
          {asked.map(a => (
            <button key={a.id} onClick={() => { setResult(null); setMine(''); setQ({ text: a.question, fromBank: false, askedId: a.id }); }}
              className="w-full text-left p-3 rounded-xl flex items-center gap-2 active:scale-[0.99]" style={{ background: T.candleSoft, border: `1px solid ${T.candle}55` }}>
              <span className="text-[10px] shrink-0 px-1.5 py-0.5 rounded" style={{ background: T.candle, color: '#fff' }}>{char.name}出的题</span>
              <span className="text-[12.5px] flex-1 truncate" style={{ fontFamily: serif }}>{a.question}</span>
              <span className="text-[10.5px] shrink-0" style={{ color: T.candle }}>去答</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col items-center mt-2 mb-4">
        <Wheel angle={angle} />
        <button onClick={spin} disabled={spinning || revealing} className="mt-3 px-6 py-2 rounded-full text-sm text-white active:scale-95 disabled:opacity-60"
          style={{ background: T.ink, fontFamily: serif }}>{spinning ? '转呀转…' : q ? '再转一次' : '转一下'}</button>
      </div>

      {q && (
        <div className="relative p-4 pt-5 mb-5 mx-1" style={{ background: '#fffcf3', borderRadius: 3, boxShadow: '0 3px 10px rgba(60,45,30,0.10)', transform: 'rotate(-0.6deg)' }}>
          <Tape color="rgba(222,190,140,0.32)" seed={4} wide />
          <div className="text-[10px] mb-1" style={{ color: T.candle }}>{q.askedId ? `${char.name}在聊天里出的题` : q.fromBank ? '从题罐里抽的' : `${char.name}现场出的题`}</div>
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

const displayText = (s: string) => s.replace(/\[[^\]]{1,60}\]/g, '').replace(/<[^>]+>/g, '').replace(/\s{2,}/g, ' ').trim();
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
      duck(true);
      if (url) {
        await new Promise<void>(resolve => {
          const a = new Audio(url);
          audioRef.current = a;
          // 哄睡后半段，他的声音也跟着轻一点
          if (sleepRef.current.on) a.volume = Math.max(0.55, 1 - sleepFraction() * 0.45);
          a.onended = () => resolve(); a.onerror = () => resolve();
          a.play().catch(() => resolve());
        });
      } else {
        await new Promise(r => setTimeout(r, Math.min(9000, 1200 + displayText(list[i].zh).length * 170)));
      }
      duck(false);
      while (pausedRef.current && runRef.current === my) await new Promise(r => setTimeout(r, 200));
      // 哄睡模式：越往后，句子之间停得越久
      if (runRef.current === my) await new Promise(r => setTimeout(r, sleepRef.current.on ? (sleepRef.current.gaps[i] ?? 3000) : 350));
    }
    if (runRef.current === my) { setPlaying(false); setSpeaking(-1); void onPieceEnd(piece); }
  };

  /* ── 哄睡模式：一份睡前稿分段慢慢念 + 白噪音 / 自己的歌单 ── */
  const [sleepOn, setSleepOn] = useState(false);
  const [sleepMins, setSleepMins] = useState(() => { try { return Number(localStorage.getItem('sully_sleep_mins_v1')) || 30; } catch { return 30; } });
  const [sleepPanel, setSleepPanel] = useState(false);
  const [sleepMsg, setSleepMsg] = useState('');
  const [sleepSource, setSleepSource] = useState<'new' | 'old'>('new');
  const [sleepOldId, setSleepOldId] = useState('');
  const sleepRef = useRef<{ on: boolean; start: number; mins: number; gaps: number[] }>({ on: false, start: 0, mins: 30, gaps: [] });
  const sleepFraction = () => sleepRef.current.on ? Math.min(1, (Date.now() - sleepRef.current.start) / (sleepRef.current.mins * 60000)) : 0;
  /** 段与段之间的间隔：几何级数越拉越长，加起来约占总时长的六成 */
  const planGaps = (n: number, mins: number) => {
    const w = Array.from({ length: Math.max(0, n - 1) }, (_, i) => Math.pow(1.55, i));
    const sum = w.reduce((x, y) => x + y, 0) || 1;
    const total = Math.max(60, mins * 60 * 0.6 - n * 12) * 1000;
    return w.map(x => Math.min(15 * 60000, (x / sum) * total));
  };
  // 背景声：白噪音（现场生成）+ 自己的歌单（多首，顺序循环）
  const [noiseKind, setNoiseKind] = useState<NoiseKind | ''>(() => { try { return (localStorage.getItem('sully_sleep_noise_v1') as NoiseKind) || 'rain'; } catch { return 'rain'; } });
  const noiseRef = useRef<NoisePlayer | null>(null);
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const [playlist, setPlaylist] = useState<{ id: string; name: string }[]>(() => { try { return JSON.parse(localStorage.getItem('sully_sleep_playlist_v1') || '[]'); } catch { return []; } });
  const playlistRef = useRef(playlist);
  const [bgmVol, setBgmVol] = useState(() => { try { return Number(localStorage.getItem('sully_sleep_bgm_vol_v1') || '0.35'); } catch { return 0.35; } });
  const bgmVolRef = useRef(bgmVol);
  useEffect(() => { playlistRef.current = playlist; try { localStorage.setItem('sully_sleep_playlist_v1', JSON.stringify(playlist)); } catch { /* ignore */ } }, [playlist]);
  useEffect(() => {
    bgmVolRef.current = bgmVol;
    if (bgmRef.current) bgmRef.current.volume = bgmVol;
    noiseRef.current?.setVolume(bgmVol * 0.6);
    try { localStorage.setItem('sully_sleep_bgm_vol_v1', String(bgmVol)); } catch { /* ignore */ }
  }, [bgmVol]);
  useEffect(() => { try { localStorage.setItem('sully_sleep_mins_v1', String(sleepMins)); localStorage.setItem('sully_sleep_noise_v1', noiseKind); } catch { /* ignore */ } }, [sleepMins, noiseKind]);
  useEffect(() => () => { bgmRef.current?.pause(); void noiseRef.current?.stop(); }, []);
  const bgmFileRef = useRef<HTMLInputElement | null>(null);
  const addSongs = async (files?: FileList | null) => {
    if (!files?.length) return;
    const added: { id: string; name: string }[] = [];
    for (const f of Array.from(files)) {
      const id = `sleep_bgm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      await DB.saveAssetRaw(id, { blob: f, mimeType: f.type, name: f.name });
      added.push({ id, name: f.name.replace(/\.[^.]+$/, '') });
    }
    setPlaylist(p => [...p, ...added]);
  };
  const removeSong = (id: string) => { setPlaylist(p => p.filter(x => x.id !== id)); void DB.deleteAsset(id).catch(() => {}); };
  const playSongAt = async (k: number) => {
    const list = playlistRef.current;
    if (!list.length || !sleepRef.current.on) return;
    const item = list[k % list.length];
    const v: any = await DB.getAssetRaw(item.id).catch(() => null);
    if (!v?.blob) { void playSongAt(k + 1); return; }
    const a = new Audio(URL.createObjectURL(v.blob));
    a.volume = bgmVolRef.current;
    a.onended = () => { void playSongAt(k + 1); };
    bgmRef.current = a;
    a.play().catch(() => {});
  };
  const startBackground = () => {
    if (noiseKind) { try { noiseRef.current = startNoise(noiseKind, bgmVolRef.current * 0.6); } catch { /* 不支持 WebAudio */ } }
    void playSongAt(0);
  };
  /** 他说话时背景声压低 */
  const duck = (speaking: boolean) => {
    if (bgmRef.current) bgmRef.current.volume = speaking ? bgmVolRef.current * 0.3 : bgmVolRef.current;
    noiseRef.current?.setVolume(bgmVolRef.current * (speaking ? 0.25 : 0.6));
  };
  const fadeOutBackground = async () => {
    const a = bgmRef.current;
    const n = noiseRef.current; noiseRef.current = null;
    const jobs: Promise<void>[] = [];
    if (n) jobs.push(n.stop(8000));
    if (a) jobs.push((async () => { for (let k = 20; k >= 0; k--) { a.volume = bgmVolRef.current * (k / 20); await new Promise(r => setTimeout(r, 400)); } a.pause(); })());
    bgmRef.current = null;
    await Promise.all(jobs);
  };
  const sleepTimer = useRef<number | null>(null);
  const [, sleepTick] = useState(0);
  useEffect(() => { if (!sleepOn) return; const t = setInterval(() => sleepTick(x => x + 1), 30000); return () => clearInterval(t); }, [sleepOn]);
  const startSleep = async () => {
    setSleepPanel(false); setSleepMsg('');
    let piece: RadioPiece | null = null;
    if (sleepSource === 'old') piece = pieces.find(p => p.id === sleepOldId) || pieces[0] || null;
    if (!piece) {
      setBusy('free');
      try {
        const ch: RadioChannel = current?.channel && current.channel !== 'patent' ? current.channel : 'free';
        piece = await playRadio(char, apiConfig, ch, bilingual ? lang : '', ch === 'free' ? topic : '', SLEEP_SCRIPT_NOTE);
        setTopic('');
      } catch (e) { onErr(e); setBusy(null); return; }
      setBusy(null);
    }
    const n = parseRadioSegments(piece.text).length;
    sleepRef.current = { on: true, start: Date.now(), mins: sleepMins, gaps: planGaps(n, sleepMins) };
    setSleepOn(true);
    startBackground();
    if (sleepTimer.current) window.clearTimeout(sleepTimer.current);
    sleepTimer.current = window.setTimeout(() => stopSleep('陪你到这儿了，晚安。'), sleepMins * 60000);
    startPiece(piece);
  };
  const stopSleep = (msg = '') => {
    sleepRef.current.on = false; setSleepOn(false); setSleepMsg(msg);
    if (sleepTimer.current) { window.clearTimeout(sleepTimer.current); sleepTimer.current = null; }
    void fadeOutBackground();
  };
  /** 一份稿子念完：哄睡模式下不再生成新的，只剩背景声陪到时间结束 */
  const onPieceEnd = async (_piece: RadioPiece) => { /* 背景声继续，计时器到点淡出 */ };

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
  const hangUp = () => { stopAll(); setCurrent(null); setShown(0); setElapsed(0); if (sleepRef.current.on) stopSleep(); };
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

      {/* 哄睡模式 */}
      <div className="relative mt-4">
        {sleepOn ? (
          <div className="flex items-center gap-2 p-2.5 rounded-2xl text-[11.5px]" style={{ background: 'rgba(185,135,90,0.14)', border: '1px solid rgba(185,135,90,0.35)' }}>
            <Moon size={15} weight="fill" style={{ color: T.candle }} />
            <span className="flex-1">哄睡中 · 还剩 {Math.max(0, Math.ceil(sleepMins - (Date.now() - sleepRef.current.start) / 60000))} 分钟{!playing && current ? ' · 他讲完了，背景声陪着你' : ' · 越往后越安静'}</span>
            <button onClick={() => stopSleep()} className="opacity-70">停下</button>
          </div>
        ) : (
          <button onClick={() => setSleepPanel(v => !v)} className="w-full flex items-center gap-2 p-2.5 rounded-2xl text-[11.5px]" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(233,226,214,0.12)' }}>
            <Moon size={15} /><span className="flex-1 text-left">哄睡模式{sleepMsg ? ` · ${sleepMsg}` : '：定时陪你睡，背景音乐，越讲越轻'}</span><span className="opacity-50">{sleepPanel ? '收起' : '设置'}</span>
          </button>
        )}
        {sleepPanel && !sleepOn && (
          <div className="mt-2 p-3 rounded-2xl space-y-3 text-[11.5px]" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(233,226,214,0.12)' }}>
            <div>
              <div className="opacity-60 mb-1.5">陪多久</div>
              <div className="flex gap-1.5">
                {[15, 30, 45, 60, 90].map(m => (
                  <button key={m} onClick={() => setSleepMins(m)} className="flex-1 py-1 rounded-full" style={{ background: sleepMins === m ? 'rgba(185,135,90,0.35)' : 'transparent', border: '1px solid rgba(233,226,214,0.2)' }}>{m} 分</button>
                ))}
              </div>
            </div>
            <div>
              <div className="opacity-60 mb-1.5">今晚讲什么</div>
              <div className="flex gap-1.5">
                <button onClick={() => setSleepSource('new')} className="flex-1 py-1 rounded-full" style={{ background: sleepSource === 'new' ? 'rgba(185,135,90,0.35)' : 'transparent', border: '1px solid rgba(233,226,214,0.2)' }}>新写一份</button>
                <button onClick={() => { setSleepSource('old'); if (!sleepOldId && pieces[0]) setSleepOldId(pieces[0].id); }} disabled={!pieces.length} className="flex-1 py-1 rounded-full disabled:opacity-30" style={{ background: sleepSource === 'old' ? 'rgba(185,135,90,0.35)' : 'transparent', border: '1px solid rgba(233,226,214,0.2)' }}>重听以前的（不花钱）</button>
              </div>
              {sleepSource === 'old' && pieces.length > 0 && (
                <select value={sleepOldId} onChange={e => setSleepOldId(e.target.value)} className="w-full mt-1.5 bg-transparent rounded-lg px-2 py-1" style={{ border: '1px solid rgba(233,226,214,0.2)', color: 'inherit' }}>
                  {pieces.slice(0, 30).map(p => <option key={p.id} value={p.id} style={{ color: T.ink }}>{p.title}</option>)}
                </select>
              )}
              <div className="opacity-45 mt-1 leading-relaxed">{sleepSource === 'new' ? '只调一次模型写一份睡前稿，分成七八小段慢慢念；每段语音只合成一次，存下来以后重听不再花钱。' : '用存好的音频重念一遍，段与段之间照样越停越久。'}</div>
            </div>
            <div>
              <div className="opacity-60 mb-1.5">背景声（他说话时会自动压低）</div>
              <div className="flex flex-wrap gap-1.5">
                {NOISE_KINDS.map(k => (
                  <button key={k} onClick={() => setNoiseKind(noiseKind === k ? '' : k)} className="px-2.5 py-1 rounded-full" style={{ background: noiseKind === k ? 'rgba(185,135,90,0.35)' : 'transparent', border: '1px solid rgba(233,226,214,0.2)' }}>{NOISE_NAMES[k]}</button>
                ))}
              </div>
              <div className="mt-2 space-y-1">
                {playlist.map((x, i) => (
                  <div key={x.id} className="flex items-center gap-2"><span className="opacity-40 w-4">{i + 1}</span><span className="flex-1 truncate">{x.name}</span><button onClick={() => removeSong(x.id)} className="opacity-50">×</button></div>
                ))}
              </div>
              <input ref={bgmFileRef} type="file" accept="audio/*" multiple className="hidden" onChange={e => { addSongs(e.target.files); e.target.value = ''; }} />
              <button onClick={() => bgmFileRef.current?.click()} className="mt-1.5 px-3 py-1 rounded-full" style={{ border: '1px solid rgba(233,226,214,0.25)' }}>+ 加几首本地音乐（按顺序轮流放）</button>
              <div className="flex items-center gap-2 mt-2"><span className="opacity-50 shrink-0">音量</span><input type="range" className="flex-1" min={0} max={1} step={0.05} value={bgmVol} onChange={e => setBgmVol(Number(e.target.value))} /></div>
            </div>
            <div className="opacity-50 leading-relaxed">开始后：他一小段一小段地念，段与段之间越停越久，后半段基本只剩背景声；到时间背景声慢慢淡出。</div>
            <button onClick={startSleep} disabled={!!busy} className="w-full py-2 rounded-full text-white disabled:opacity-50" style={{ background: T.candle }}>开始哄睡</button>
          </div>
        )}
      </div>

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

/* ───────── 「恨你」计数器 ───────── */

const HateCounter: React.FC<{ char: any; userName: string }> = ({ char, userName }) => {
  const [stats, setStats] = useState<HateStats | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    DB.getMessagesByCharId(char.id, true).then(msgs => {
      if (!alive) return;
      const st = computeHateStats(msgs);
      setStats(st); saveHateTotal(char.id, st.total);
    }).catch(() => {});
    return () => { alive = false; };
  }, [char.id]);
  if (!stats || !stats.total) return null;
  const milestone = [1000, 520, 500, 365, 300, 200, 100, 99, 50, 10].find(n => stats.total >= n);
  const last14 = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 13 + i); return stats.byDay[todayKey(d)] || 0; });
  const max = Math.max(1, ...last14);
  return (
    <div className="relative mb-4 mt-1">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-3 p-3 text-left active:scale-[0.99]"
        style={{ background: '#fff6f4', borderRadius: 3, boxShadow: '0 2px 8px rgba(60,45,30,0.08)', transform: 'rotate(-0.4deg)' }}>
        <div className="shrink-0 w-14 h-14 rounded-full flex flex-col items-center justify-center" style={{ border: '2px solid #b5464a', color: '#b5464a', transform: 'rotate(-10deg)' }}>
          <span className="text-[9px] tracking-widest leading-none">恨你</span>
          <span className="text-[17px] font-bold leading-tight" style={{ fontFamily: serif }}>{stats.total}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px]" style={{ fontFamily: serif }}>{userName}说了 <b>{stats.total}</b> 次「恨你」</div>
          <div className="text-[10.5px] mt-0.5" style={{ color: T.soft }}>
            今天 {stats.today} 次{stats.currentStreak > 1 ? ` · 连续 ${stats.currentStreak} 天` : ''} · 最长连续 {stats.longestStreak} 天{milestone ? ` · 已经过了 ${milestone} 次` : ''}
          </div>
          <div className="flex items-end gap-[3px] h-5 mt-1.5">
            {last14.map((n, i) => <span key={i} className="flex-1 rounded-sm" style={{ height: `${n ? 20 + (n / max) * 80 : 8}%`, background: n ? '#c97c7f' : 'rgba(0,0,0,0.06)' }} />)}
          </div>
        </div>
      </button>
      {open && (
        <div className="mt-2 p-3 space-y-2.5 text-[11.5px]" style={{ background: 'rgba(255,252,243,0.85)', borderRadius: 3 }}>
          <div className="text-[10px]" style={{ color: T.soft }}>最近几次，和{char.name}当时怎么回的</div>
          {stats.recent.slice(0, 12).map((r, i) => (
            <div key={i} className="pb-2 border-b border-dashed" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
              <div><span className="opacity-50 mr-1">{new Date(r.at).toLocaleDateString()}</span>{r.text}</div>
              {r.reply && <div className="mt-0.5" style={{ fontFamily: fontCss(loadCharFont()), fontSize: 13, color: T.ink }}>↳ {r.reply}</div>}
            </div>
          ))}
          {stats.firstAt && <div className="text-[10px]" style={{ color: T.soft }}>第一次是 {new Date(stats.firstAt).toLocaleDateString()}。</div>}
        </div>
      )}
    </div>
  );
};

/* ───────── 时间胶囊 ───────── */

const addMonths = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() + n); return todayKey(d); };
const daysUntil = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(y, m - 1, d).getTime(), n = new Date(); n.setHours(0, 0, 0, 0);
  return Math.round((t - n.getTime()) / 86400000);
};

/** 火漆印：一朵茉莉压在深红蜡上 */
const WaxSeal: React.FC<{ size?: number; glow?: boolean }> = ({ size = 44, glow }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" style={{ filter: glow ? 'drop-shadow(0 0 8px rgba(185,135,90,0.7))' : 'drop-shadow(0 2px 3px rgba(80,20,20,0.35))' }}>
    <defs><radialGradient id="fnWax" cx=".4" cy=".35" r=".7"><stop offset="0" stopColor="#b5464a" /><stop offset=".7" stopColor="#7e2228" /><stop offset="1" stopColor="#5e171c" /></radialGradient></defs>
    <path d="M24 3c4 0 6 3 9 4s7 1 8.5 4.5S41 18 42.5 21s3 6.5 1 9.5-5 3.5-6.5 6.5-1 7-4.5 8.5S27 44 24 45s-6 0-8.5-1.5-4-4.5-6.5-5.5-6-1.5-6.5-5S5 27 4.5 24 3 17.5 5 15s5-2.5 6.5-5S14 4.5 17 4s4-1 7-1z" fill="url(#fnWax)" />
    <circle cx="24" cy="24" r="13" fill="none" stroke="rgba(255,220,200,0.25)" strokeWidth="1" />
    {[0, 72, 144, 216, 288].map(a => <ellipse key={a} cx="24" cy="18.5" rx="2.6" ry="4.6" fill="rgba(255,225,205,0.32)" transform={`rotate(${a} 24 24)`} />)}
    <circle cx="24" cy="24" r="1.8" fill="rgba(255,225,205,0.45)" />
  </svg>
);

/** 带划线批注的信：被划的句子下面一道波浪线 + 圈号，点一下在原地展开他的批注；全部批注也列在信后面 */
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const AnnotatedLetter: React.FC<{ text: string; notes: { quote: string; note: string }[]; font: string; noteFont: string }> = ({ text, notes, font, noteFont }) => {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  // 按在原文里出现的位置排好，重叠的后一个跳过
  const spans: { start: number; end: number; idx: number }[] = [];
  notes.forEach((n, idx) => {
    const start = text.indexOf(n.quote);
    if (start < 0) return;
    const end = start + n.quote.length;
    if (spans.some(s => start < s.end && end > s.start)) return;
    spans.push({ start, end, idx });
  });
  spans.sort((a, b) => a.start - b.start);
  const order = spans.map(s => s.idx);
  const parts: React.ReactNode[] = [];
  let pos = 0;
  spans.forEach((sp, k) => {
    if (sp.start > pos) parts.push(<span key={`t${k}`}>{text.slice(pos, sp.start)}</span>);
    parts.push(
      <span key={`m${k}`} onClick={() => setOpenIdx(openIdx === sp.idx ? null : sp.idx)} className="cursor-pointer"
        style={{ textDecoration: 'underline wavy rgba(181,70,74,0.75)', textUnderlineOffset: 4, textDecorationThickness: 1.2, background: openIdx === sp.idx ? 'rgba(181,70,74,0.08)' : undefined }}>
        {text.slice(sp.start, sp.end)}<sup className="ml-0.5" style={{ color: '#b5464a', fontSize: 10 }}>{CIRCLED[k] || '·'}</sup>
      </span>,
    );
    if (openIdx === sp.idx) parts.push(
      <span key={`n${k}`} className="block my-1 ml-3 pl-2" style={{ borderLeft: '2px solid rgba(181,70,74,0.5)', fontFamily: noteFont, fontSize: 14, color: '#7e2228' }}>{notes[sp.idx].note}</span>,
    );
    pos = sp.end;
  });
  if (pos < text.length) parts.push(<span key="tail">{text.slice(pos)}</span>);
  return (
    <>
      <div className="whitespace-pre-wrap leading-relaxed" style={{ fontFamily: font, fontSize: 15, color: T.ink }}>{parts}</div>
      {order.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {order.map((idx, k) => (
            <div key={idx} className="text-[13.5px] leading-snug" style={{ fontFamily: noteFont, color: '#7e2228' }}>
              <span className="mr-1" style={{ fontSize: 11 }}>{CIRCLED[k]}</span>{notes[idx].note}
            </div>
          ))}
        </div>
      )}
    </>
  );
};

const CapsuleTab: React.FC<{ char: any; apiConfig: any; capsules: Capsule[]; onErr: (e: any) => void; userName: string; onShared?: () => void }> = ({ char, apiConfig, capsules, onErr, userName, onShared }) => {
  const [writing, setWriting] = useState(false);
  const [title, setTitle] = useState('');
  const [mine, setMine] = useState('');
  const [openOn, setOpenOn] = useState(addMonths(3));
  const [withHim, setWithHim] = useState(true);
  const [sealing, setSealing] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const today = todayKey();
  const myFont = (() => { try { return localStorage.getItem('sully_footnote_my_font_v1') || 'kai'; } catch { return 'kai'; } })();

  const seal = () => {
    if (!mine.trim() || openOn <= today) return;
    setSealing(true);
    sealCapsule(char, apiConfig, { title, mine, openOn, withHim })
      .then(() => { setWriting(false); setTitle(''); setMine(''); })
      .catch(onErr).finally(() => setSealing(false));
  };
  const open = (c: Capsule) => {
    setOpening(c.id);
    openCapsule(char, apiConfig, c.id).then(() => setViewId(c.id)).catch(onErr).finally(() => setOpening(null));
  };
  const presets: [string, string][] = [['一个月后', addMonths(1)], ['三个月后', addMonths(3)], ['半年后', addMonths(6)], ['一年后', addMonths(12)]];
  const view = capsules.find(c => c.id === viewId) || null;
  const sorted = [...capsules].sort((a, b) => (a.opened === b.opened ? a.openOn.localeCompare(b.openOn) : a.opened ? 1 : -1));

  return (
    <>
      {!writing ? (
        <button onClick={() => setWriting(true)} className="w-full py-3 rounded-xl text-[13px] mb-4 active:scale-[0.99]" style={{ background: T.card, border: `1px dashed ${T.line}`, fontFamily: serif }}>
          写一封信给以后的自己
        </button>
      ) : (
        <div className="relative mb-5 p-4 pt-5" style={{ background: '#fffcf3', borderRadius: 3, boxShadow: '0 3px 12px rgba(60,45,30,0.12)' }}>
          <Tape color="rgba(222,190,140,0.32)" seed={6} wide />
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="给这个胶囊起个名字（可不填）"
            className="w-full bg-transparent outline-none text-[14px] font-semibold mb-2" style={{ fontFamily: serif, color: T.ink }} />
          <textarea value={mine} onChange={e => setMine(e.target.value)} rows={7} placeholder="写给那天拆开它的你……"
            className="w-full bg-transparent outline-none resize-none" style={{ fontFamily: fontCss(myFont), fontSize: 15, color: T.ink, lineHeight: '28px', backgroundImage: 'repeating-linear-gradient(transparent, transparent 27px, rgba(0,0,0,0.07) 27px, rgba(0,0,0,0.07) 28px)' }} />
          <div className="text-[10.5px] mt-3 mb-1.5" style={{ color: T.soft }}>什么时候能拆</div>
          <div className="flex flex-wrap gap-1.5 items-center">
            {presets.map(([n, k]) => (
              <button key={n} onClick={() => setOpenOn(k)} className="px-2.5 py-1 rounded-full text-[11px]"
                style={{ background: openOn === k ? T.candleSoft : 'transparent', border: `1px solid ${openOn === k ? T.candle : T.line}` }}>{n}</button>
            ))}
            <input type="date" value={openOn} min={addMonths(0)} onChange={e => setOpenOn(e.target.value)} className="text-[11px] bg-transparent outline-none px-1" style={{ color: T.ink }} />
          </div>
          <label className="flex items-start gap-2 mt-3 text-[11.5px]" style={{ color: T.ink }}>
            <input type="checkbox" className="mt-0.5" checked={withHim} onChange={e => setWithHim(e.target.checked)} />
            <span>让{char.name}看完在信上划线批注，再写一段，一起封进去<span className="block text-[10px] opacity-55">他划了哪里、写了什么，拆开那天才知道</span></span>
          </label>
          <div className="flex justify-end gap-3 mt-3">
            <button onClick={() => setWriting(false)} className="text-[12px] opacity-60">先不封</button>
            <button onClick={seal} disabled={!mine.trim() || openOn <= today || sealing} className="px-4 py-1.5 rounded-full text-[12px] text-white disabled:opacity-40" style={{ background: '#7e2228' }}>
              {sealing ? (withHim ? `${char.name}在写…` : '封存中…') : '封起来'}
            </button>
          </div>
        </div>
      )}

      {!capsules.length && !writing && <div className="text-center text-[11px] opacity-50 mt-6" style={{ fontFamily: serif }}>还没有胶囊。写一封，过些日子再拆。</div>}

      <div className="space-y-3 pb-6">
        {sorted.map((c, i) => {
          const ready = !c.opened && canOpenCapsule(c, today);
          const left = daysUntil(c.openOn);
          return (
            <div key={c.id} className="relative p-4 flex items-center gap-3"
              style={{
                background: c.opened ? 'rgba(255,252,243,0.6)' : '#f4ead6', borderRadius: 4,
                boxShadow: ready ? '0 0 0 1.5px rgba(185,135,90,0.6), 0 4px 16px rgba(185,135,90,0.25)' : '0 2px 8px rgba(60,45,30,0.10)',
                transform: `rotate(${((i * 29) % 5 - 2) * 0.4}deg)`,
                backgroundImage: c.opened ? undefined : 'linear-gradient(155deg, transparent 49.5%, rgba(120,90,50,0.10) 50%, transparent 50.5%), linear-gradient(25deg, transparent 49.5%, rgba(120,90,50,0.10) 50%, transparent 50.5%)',
              }}>
              {!c.opened ? <WaxSeal glow={ready} /> : <div className="w-11 h-11 flex items-center justify-center text-[18px] opacity-60">✉︎</div>}
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold truncate" style={{ fontFamily: serif }}>{c.title || '无题'}</div>
                <div className="text-[10.5px] mt-0.5" style={{ color: T.soft }}>
                  {new Date(c.createdAt).toLocaleDateString()} 封 · {c.opened ? `${new Date(c.openedAt || 0).toLocaleDateString()} 拆开` : ready ? '今天可以拆了' : `还要 ${left} 天（${c.openOn}）`}
                  {c.his ? ` · 里面有${char.name}的话` : ''}
                </div>
              </div>
              {c.opened ? <button onClick={() => setViewId(c.id)} className="text-[11.5px] shrink-0" style={{ color: T.candle }}>再看看</button>
                : ready ? <button onClick={() => open(c)} disabled={!!opening} className="px-3 py-1.5 rounded-full text-[11.5px] text-white shrink-0 disabled:opacity-60" style={{ background: T.candle }}>{opening === c.id ? '拆开中…' : '拆开'}</button>
                : <span className="text-[10px] shrink-0 opacity-50">封着</span>}
            </div>
          );
        })}
      </div>

      {view && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5" onClick={() => setViewId(null)}>
          <div className="absolute inset-0" style={{ background: 'rgba(40,32,24,0.4)', backdropFilter: 'blur(3px)' }} />
          <div className="relative w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()} style={{ background: '#fffcf3', borderRadius: 3, animation: 'footDrop .35s ease-out both', ['--r' as any]: '0deg' }}>
            <div className="max-h-[80vh] overflow-y-auto no-scrollbar p-5">
              <div className="text-[10px] tracking-[0.2em] mb-1" style={{ color: T.candle }}>时间胶囊 · {new Date(view.createdAt).toLocaleDateString()} 封</div>
              <div className="text-[16px] font-semibold mb-3" style={{ fontFamily: serif }}>{view.title || '无题'}</div>
              <div className="text-[10px] mb-1" style={{ color: T.soft }}>那时候的你写给今天的你{view.notes?.length ? `（${char.name}在上面划了线）` : ''}</div>
              <AnnotatedLetter text={view.mine} notes={view.notes || []} font={fontCss(myFont)} noteFont={fontCss(loadCharFont())} />
              {view.his && (
                <div className="mt-4 pt-3 border-t border-dashed" style={{ borderColor: 'rgba(0,0,0,0.14)' }}>
                  <div className="text-[10px] mb-1" style={{ color: T.soft }}>{char.name}当时偷偷封进去的</div>
                  <div className="whitespace-pre-wrap leading-relaxed" style={{ fontFamily: fontCss(loadCharFont()), fontSize: 15, color: T.ink }}>{view.his}</div>
                </div>
              )}
              {view.reaction && (
                <div className="mt-4 p-3 rounded-lg" style={{ background: T.candleSoft }}>
                  <div className="text-[10px] mb-1" style={{ color: T.soft }}>拆开的时候，{char.name}在旁边说</div>
                  <div className="leading-relaxed text-[13px]" style={{ fontFamily: serif }}>{view.reaction}</div>
                </div>
              )}
              <div className="flex justify-between mt-4 text-[11px]">
                <button onClick={() => shareCapsule(view, char.name, userName).then(() => onShared?.()).catch(onErr)} className="flex items-center gap-1"><PaperPlaneTilt size={13} />发到聊天</button>
                <button onClick={() => setViewId(null)} className="opacity-60">收起</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default FootnoteApp;
