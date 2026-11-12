/**
 * 绘图（个人二改）：NovelAI 工作台 + 参考图 + 小助手 + 相册。
 * 搬自 ST-iPhonie 的「绘图」（github.com/hey8v0/ST-iPhonie，作者 hey8v0 同意搬运），按这个 App 的样子重写：
 *  - 画：画风、提示词 / 负面、多角色和站位、模型尺寸步数采样器种子、一次 1–4 张、免费档守卫；
 *        画好的图「用这张继续」：当底图、当参考、变体、增强、放大、导演工具、用它的设置 / 种子、下载、删除；读官网 PNG 的参数
 *  - 参考：底图（图生图）+ 涂出要重画的地方（局部重绘）、角色参考（V4.5 精确参考）、Vibe（V4 / V4.5）
 *  - 助手：不带人设的绘图助手，聊画面写出图块，「画这张」或者直接说「画吧」就出图
 *  - 相册：画过的都在这，点开看参数
 * Key 用「设置 → NovelAI 生图」里那把，只在本机；请求先走自己的 Worker，Worker 旧了就直连。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import TokenImg from '../components/os/TokenImg';
import { putImageBlob, getBlobForRef, deleteBlobRefIfUnreferenced } from '../utils/blobRef';
import { shareOrDownloadBlob } from '../utils/shareExport';
import { loadNaiConfig, saveNaiConfig, activeNaiStyle, isNaiReady, type NaiStyle } from '../utils/nai';
import {
  NAI_MODELS, NAI_MODEL_NAMES, NAI_SAMPLER_NAMES, samplersFor, schedulesFor, qualityPresets, ucPresets, naiFeatures, normalizeDrawParams, defaultDrawParams,
  isFree, guardParams, buildImageRequest, naiGenerate, naiAugment, naiUpscale, naiEncodeVibe, naiSubscription, TIER_NAMES,
  DIRECTOR_TOOLS, EMOTIONS, augmentBody, upscaleBody, upscaleBy, takesReference, MAX_REFERENCES, REFERENCE_ANLAS, MAX_FREE_VIBES, VIBE_ANLAS, VIBE_KEYS,
  blobToBase64, imageSize, fitImage, baseSizeFor, referenceSizeFor, readNaiPng, FREE_PIXELS, NAI_MAX_PIXELS,
  type DrawParams, type DrawCharacter, type NaiSubscription, type BaseImage, type RefImage,
} from '../utils/naiStudio';
import { getAppApiChoice, setAppApiChoice, resolveAppApi, appApiOptions } from '../utils/appApiChoice';
import { assistantSystem, turnHint, TURN_HINTS, parseBlocks, blockToWork, ORIENT_SIZE, chatCall, translatePrompt, revisePrompt, writePrompt, type CastEntry, type ImgBlock } from '../utils/drawAssistant';

const C = { bg: '#f5f3ef', card: '#ffffff', ink: '#1f1d1a', muted: '#8a857c', faint: '#c4beb3', line: '#e9e4da', accent: '#6b5bd2', soft: '#efecfb', warn: '#c2603d', ok: '#3f8f6b' };

/* ───────── 本机存的东西 ───────── */
const LS_WORK = 'sully_draw_work_v1', LS_HIST = 'sully_draw_history_v1', LS_REFS = 'sully_draw_refs_v1', LS_CHAT = 'sully_draw_chat_v1', LS_SUB = 'sully_draw_sub_v1';
const load = <T,>(k: string, d: T): T => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 满了就算了 */ } };
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface Work { prompt: string; negative: string; characters: (DrawCharacter & { id: string })[]; params: DrawParams; count: number; guard: boolean }
interface HistItem { id: string; token: string; width: number; height: number; seed?: number; prompt: string; negative: string; characters: DrawCharacter[]; params: Partial<DrawParams>; at: number; kind: string }
interface Vibe { id: string; token: string; name: string; strength: number; ie: number; on: boolean; enc: Record<string, string> }
interface Refs { base: { token: string; strength: number; noise: number; mask?: string } | null; refs: { id: string; token: string; kind: 'character' | 'style' | 'both'; strength: number; fidelity: number }[]; vibes: Vibe[] }
interface ChatMsg {
  id: string; role: 'user' | 'assistant'; text: string; images?: string[]; drawing?: boolean; error?: string;
  /** 重 roll 出来的几个版本（text / images 是正在看的那个） */
  alts?: string[]; altImgs?: string[][]; alt?: number;
}
/** 切到第 k 个版本：正文和图跟着换 */
const showAlt = (m: ChatMsg, k: number): ChatMsg => {
  const alts = m.alts || [m.text], imgs = m.altImgs || [m.images || []];
  const i = Math.max(0, Math.min(alts.length - 1, k));
  return { ...m, alts, altImgs: imgs, alt: i, text: alts[i], images: imgs[i] || [] };
};

const defaultWork = (): Work => ({ prompt: '', negative: '', characters: [], params: defaultDrawParams(), count: 1, guard: true });
const fullPrompt = (style: NaiStyle, prompt: string) => [style.artist, prompt, style.positive].map(s => String(s || '').trim()).filter(Boolean).join(', ');
const fullNegative = (style: NaiStyle, neg: string) => [style.negative, neg].map(s => String(s || '').trim()).filter(Boolean).join(', ');
const SIZE_PRESETS: [string, number, number][] = [['竖', 832, 1216], ['横', 1216, 832], ['方', 1024, 1024], ['竖·大', 1024, 1536], ['横·大', 1536, 1024], ['方·大', 1472, 1472]];
const POS_LABEL = (i: number) => i < 0 ? '自动' : `${'ABCDE'[i % 5]}${Math.floor(i / 5) + 1}`;

/* ───────── 小零件 ───────── */
const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'solid' | 'soft' | 'ghost'; small?: boolean }> = ({ tone = 'soft', small, className = '', style, ...p }) => (
  <button {...p} className={`${small ? 'text-[11px] px-2.5 py-1' : 'text-[12px] px-3 py-1.5'} rounded-full active:scale-[0.97] transition disabled:opacity-40 ${className}`}
    style={{ ...(tone === 'solid' ? { background: C.ink, color: '#fff' } : tone === 'soft' ? { background: C.soft, color: C.accent } : { background: 'transparent', color: C.muted, border: `1px solid ${C.line}` }), ...style }} />
);
const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <label className="block"><div className="text-[10.5px] mb-1 flex justify-between" style={{ color: C.muted }}><span>{label}</span>{hint && <span style={{ color: C.faint }}>{hint}</span>}</div>{children}</label>
);
const inputCls = 'w-full rounded-xl px-3 py-2 text-[12.5px] outline-none';
const inputSty: React.CSSProperties = { background: '#faf8f4', border: `1px solid ${C.line}`, color: C.ink };
const Slider: React.FC<{ label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }> = ({ label, value, min, max, step, onChange, fmt }) => (
  <div>
    <div className="flex justify-between text-[10.5px]" style={{ color: C.muted }}><span>{label}</span><span style={{ color: C.ink }}>{fmt ? fmt(value) : value}</span></div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full" style={{ accentColor: C.accent }} />
  </div>
);
const Sheet: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="absolute inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(20,18,15,0.35)' }} onClick={onClose}>
    <div className="rounded-t-3xl p-4 max-h-[85%] overflow-y-auto" style={{ background: C.card }} onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-3"><div className="text-[14px] font-semibold" style={{ color: C.ink }}>{title}</div><button onClick={onClose} className="text-[12px]" style={{ color: C.muted }}>关闭</button></div>
      {children}
    </div>
  </div>
);
const PosGrid: React.FC<{ value: number; onChange: (v: number) => void }> = ({ value, onChange }) => (
  <div className="inline-grid grid-cols-5 gap-[3px] p-1 rounded-lg" style={{ background: '#f1eee8' }}>
    {Array.from({ length: 25 }, (_, i) => (
      <button key={i} onClick={() => onChange(value === i ? -1 : i)} className="w-4 h-4 rounded-[4px]" style={{ background: value === i ? C.accent : '#fff' }} title={POS_LABEL(i)} />
    ))}
  </div>
);

/* ───────── 涂出要重画的地方 ───────── */
const MaskPainter: React.FC<{ imageToken: string; maskToken?: string; onDone: (mask: Blob | null) => void; onClose: () => void }> = ({ imageToken, maskToken, onDone, onClose }) => {
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [brush, setBrush] = useState(40);
  const [erase, setErase] = useState(false);
  const drawing = useRef(false);
  useEffect(() => {
    (async () => {
      const b = await getBlobForRef(imageToken); if (!b) return;
      const { width, height } = await imageSize(b);
      setSize({ w: width, h: height });
      requestAnimationFrame(async () => {
        const c = cv.current; if (!c) return;
        c.width = width; c.height = height;
        const g = c.getContext('2d')!; g.clearRect(0, 0, width, height);
        if (maskToken) { const mb = await getBlobForRef(maskToken); if (mb) { const bmp = await createImageBitmap(mb); g.globalAlpha = 1; g.drawImage(bmp, 0, 0, width, height);
          // 存的是黑底白块：转成透明底的半透明涂层
          const d = g.getImageData(0, 0, width, height); for (let i = 0; i < d.data.length; i += 4) { const on = d.data[i] > 127; d.data[i] = 107; d.data[i + 1] = 91; d.data[i + 2] = 210; d.data[i + 3] = on ? 255 : 0; } g.putImageData(d, 0, 0); } }
      });
    })();
  }, [imageToken, maskToken]);
  const pt = (e: React.PointerEvent) => { const c = cv.current!, r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height, k: c.width / r.width }; };
  const dot = (e: React.PointerEvent) => {
    const c = cv.current; if (!c) return; const g = c.getContext('2d')!; const p = pt(e);
    g.globalCompositeOperation = erase ? 'destination-out' : 'source-over'; g.fillStyle = 'rgb(107,91,210)';
    g.beginPath(); g.arc(p.x, p.y, brush * p.k / 2, 0, Math.PI * 2); g.fill();
  };
  const finish = async () => {
    const c = cv.current; if (!c) return;
    const g = c.getContext('2d')!, d = g.getImageData(0, 0, c.width, c.height);
    let any = false;
    const out = document.createElement('canvas'); out.width = c.width; out.height = c.height;
    const og = out.getContext('2d')!, od = og.createImageData(c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) { const on = d.data[i + 3] > 20; if (on) any = true; const v = on ? 255 : 0; od.data[i] = od.data[i + 1] = od.data[i + 2] = v; od.data[i + 3] = 255; }
    og.putImageData(od, 0, 0);
    if (!any) return onDone(null);
    out.toBlob(b => onDone(b), 'image/png');
  };
  return (
    <div className="absolute inset-0 z-50 flex flex-col" style={{ background: '#151412' }}>
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+10px)] pb-2 text-white text-[12px]">
        <button onClick={onClose} className="opacity-70">取消</button><span>涂出要重画的地方</span><button onClick={finish} style={{ color: '#b9adff' }}>好了</button>
      </div>
      <div className="flex-1 flex items-center justify-center px-3 min-h-0">
        {size && <div className="relative max-h-full" style={{ aspectRatio: `${size.w}/${size.h}`, maxWidth: '100%' }}>
          <TokenImg value={imageToken} className="absolute inset-0 w-full h-full object-contain" />
          <canvas ref={cv} className="absolute inset-0 w-full h-full touch-none" style={{ opacity: 0.55 }}
            onPointerDown={e => { drawing.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); dot(e); }}
            onPointerMove={e => { if (drawing.current) dot(e); }} onPointerUp={() => { drawing.current = false; }} />
        </div>}
      </div>
      <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 space-y-2 text-white">
        <div className="flex gap-2 justify-center text-[12px]">
          <button onClick={() => setErase(false)} className="px-3 py-1 rounded-full" style={{ background: !erase ? '#6b5bd2' : '#2a2825' }}>涂</button>
          <button onClick={() => setErase(true)} className="px-3 py-1 rounded-full" style={{ background: erase ? '#6b5bd2' : '#2a2825' }}>擦</button>
          <button onClick={() => { const c = cv.current; c?.getContext('2d')?.clearRect(0, 0, c.width, c.height); }} className="px-3 py-1 rounded-full" style={{ background: '#2a2825' }}>全部擦掉</button>
        </div>
        <div className="flex items-center gap-2 text-[11px]"><span className="opacity-60">笔刷</span><input type="range" min={8} max={120} value={brush} onChange={e => setBrush(Number(e.target.value))} className="flex-1" style={{ accentColor: '#b9adff' }} /></div>
      </div>
    </div>
  );
};

/* ───────── 主体 ───────── */
type Tab = 'draw' | 'refs' | 'chat' | 'album';

const DrawApp: React.FC = () => {
  const { closeApp, apiConfig: mainApi, apiPresets, addToast, characters, userProfile } = useOS() as any;
  const [apiChoice, setApiChoiceState] = useState(() => getAppApiChoice('draw'));
  const apiConfig = useMemo(() => resolveAppApi(mainApi, apiPresets, apiChoice), [mainApi, apiPresets, apiChoice]);
  const [tab, setTab] = useState<Tab>(() => load<Tab>('sully_draw_tab_v1', 'draw'));
  useEffect(() => save('sully_draw_tab_v1', tab), [tab]);
  const [work, setWorkRaw] = useState<Work>(() => { const w = load<Work>(LS_WORK, defaultWork()); return { ...defaultWork(), ...w, params: normalizeDrawParams(w.params) }; });
  const setWork = useCallback((f: (w: Work) => Work) => setWorkRaw(w => { const n = f(w); save(LS_WORK, n); return n; }), []);
  const [hist, setHistRaw] = useState<HistItem[]>(() => load<HistItem[]>(LS_HIST, []));
  const setHist = useCallback((f: (h: HistItem[]) => HistItem[]) => setHistRaw(h => { const n = f(h).slice(0, 200); save(LS_HIST, n); return n; }), []);
  const [refs, setRefsRaw] = useState<Refs>(() => ({ base: null, refs: [], vibes: [], ...load<Partial<Refs>>(LS_REFS, {}) }));
  const setRefs = useCallback((f: (r: Refs) => Refs) => setRefsRaw(r => { const n = f(r); save(LS_REFS, n); return n; }), []);
  const [chat, setChatRaw] = useState<ChatMsg[]>(() => load<ChatMsg[]>(LS_CHAT, []));
  const setChat = useCallback((f: (c: ChatMsg[]) => ChatMsg[]) => setChatRaw(c => { const n = f(c).slice(-80); save(LS_CHAT, n); return n; }), []);
  const [cfg, setCfg] = useState(() => loadNaiConfig());
  const style = activeNaiStyle(cfg);
  const [sub, setSub] = useState<NaiSubscription | null>(() => load<NaiSubscription | null>(LS_SUB, null));
  const [current, setCurrent] = useState<string | null>(() => load<HistItem[]>(LS_HIST, [])[0]?.id || null);
  const [busy, setBusy] = useState<string>('');
  const [sheet, setSheet] = useState<null | 'style' | 'params' | 'director' | 'enhance' | 'variant' | 'viewer' | 'translate' | 'revise' | 'write'>(null);
  const [viewer, setViewer] = useState<HistItem | null>(null);
  const [masking, setMasking] = useState(false);
  const [note, setNote] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const f = naiFeatures(work.params.model);
  const curItem = hist.find(h => h.id === current) || null;

  // 订阅：一天查一次
  useEffect(() => {
    if (!isNaiReady(cfg)) return;
    if (sub && Date.now() - sub.checkedAt < 6 * 3600e3) return;
    naiSubscription().then(s => { setSub(s); save(LS_SUB, s); }).catch(() => { /* 查不到也能画 */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* —— 登记外貌的人：设置里给角色填过外貌 tag 的 + 你 —— */
  const cast: CastEntry[] = useMemo(() => {
    const out: CastEntry[] = [];
    for (const ch of characters || []) {
      const tags = cfg.characterTags?.[ch.id]; if (!tags?.trim()) continue;
      out.push({ name: ch.name.split(/[·・\s]/)[0], gender: /\b1girl|girl\b/.test(tags) ? '女' : '男', tags, negative: cfg.characterNegatives?.[ch.id] || '' });
    }
    if (cfg.userTags?.trim()) out.push({ name: userProfile?.name || '我', gender: /\b1boy|boy\b/.test(cfg.userTags) ? '男' : '女', tags: cfg.userTags, negative: cfg.userNegative || '' });
    return out;
  }, [characters, cfg, userProfile?.name]);

  /* —— 花费 —— */
  const effParams = useMemo(() => { const p = normalizeDrawParams(work.params); return work.guard && isFree(p, sub) !== true && sub?.unlimited ? guardParams(p) : p; }, [work.params, work.guard, sub]);
  const refCount = f.reference ? refs.refs.length : 0;
  const vibeCount = f.vibes && !refCount ? refs.vibes.filter(v => v.on).length : 0;
  const free = isFree(effParams, sub);
  const extraAnlas = refCount * REFERENCE_ANLAS + Math.max(0, vibeCount - MAX_FREE_VIBES) * VIBE_ANLAS;
  const costText = free === true && !extraAnlas ? '免费' : free === null ? '不确定' : extraAnlas ? `每张多扣 ${extraAnlas}+ Anlas` : '要扣 Anlas';

  /* —— 画 —— */
  const loadB64 = async (token: string) => { const b = await getBlobForRef(token); if (!b) throw new Error('这张图找不到了'); return b; };
  const addHist = async (blob: Blob, meta: Omit<HistItem, 'id' | 'token' | 'width' | 'height' | 'at'>) => {
    const token = await putImageBlob(blob); const { width, height } = await imageSize(blob);
    const item: HistItem = { id: uid(), token, width, height, at: Date.now(), ...meta };
    setHist(h => [item, ...h]); setCurrent(item.id); return item;
  };
  const confirmCost = (what: string) => window.confirm(`${what}\n这次会扣 Anlas，继续吗？`);

  interface RunOpts { prompt?: string; negative?: string; characters?: DrawCharacter[]; params?: Partial<DrawParams>; base?: BaseImage | null; count?: number; kind?: string; useRefs?: boolean }
  const generate = async (o: RunOpts = {}): Promise<HistItem[]> => {
    if (!isNaiReady(loadNaiConfig())) { addToast('先在 设置 → NovelAI 生图 里填 Key', 'error'); return []; }
    const promptRaw = o.prompt ?? work.prompt, negRaw = o.negative ?? work.negative, chars = o.characters ?? work.characters;
    if (!promptRaw.trim() && !chars.some(c => c.prompt?.trim())) { addToast('先写点提示词', 'info'); return []; }
    let p = normalizeDrawParams({ ...work.params, ...(o.params || {}) });
    const sty = activeNaiStyle(loadNaiConfig());
    const useRefs = o.useRefs !== false;
    const ff = naiFeatures(p.model);
    // 底图
    let base: BaseImage | null = o.base !== undefined ? o.base : null;
    if (o.base === undefined && useRefs && refs.base) {
      const b = await loadB64(refs.base.token); const s = await imageSize(b);
      const size = baseSizeFor(s.width, s.height, work.guard ? FREE_PIXELS : NAI_MAX_PIXELS);
      base = { image: await fitImage(b, size.width, size.height, 'cover'), width: size.width, height: size.height, strength: refs.base.strength, noise: refs.base.noise };
      if (refs.base.mask) { const mb = await loadB64(refs.base.mask); base.mask = await fitImage(mb, size.width, size.height, 'cover'); }
    }
    if (work.guard && !base && sub?.unlimited && isFree(p, sub) !== true) p = guardParams(p);
    // 角色参考
    const refImgs: RefImage[] = [];
    if (useRefs && ff.reference) for (const r of refs.refs) { const b = await loadB64(r.token); const s = await imageSize(b); const [w, h] = referenceSizeFor(s.width, s.height); refImgs.push({ image: await fitImage(b, w, h, 'contain'), kind: r.kind, strength: r.strength, fidelity: r.fidelity }); }
    // Vibe：没编码过的先编码（2 Anlas）
    const vibes: { encoding: string; strength: number }[] = [];
    if (useRefs && ff.vibes && !refImgs.length) {
      const key = VIBE_KEYS[p.model];
      const need = refs.vibes.filter(v => v.on && !v.enc[`${key}|${v.ie}`]);
      if (need.length && !confirmCost(`有 ${need.length} 个 Vibe 还没给这个模型编码，每个 ${VIBE_ANLAS} Anlas。`)) return [];
      for (const v of refs.vibes.filter(x => x.on)) {
        let enc = v.enc[`${key}|${v.ie}`];
        if (!enc) {
          setBusy(`给「${v.name}」编码…`);
          const b = await loadB64(v.token); const s = await imageSize(b); const sz = baseSizeFor(s.width, s.height, 1024 * 1024);
          enc = await naiEncodeVibe(await fitImage(b, sz.width, sz.height, 'cover'), p.model, v.ie);
          setRefs(r => ({ ...r, vibes: r.vibes.map(x => x.id === v.id ? { ...x, enc: { ...x.enc, [`${key}|${v.ie}`]: enc! } } : x) }));
        }
        vibes.push({ encoding: enc, strength: v.strength });
      }
    }
    const cost = isFree(p, sub) !== true || refImgs.length > 0 || vibes.length > MAX_FREE_VIBES;
    const n = Math.max(1, Math.min(4, o.count ?? work.count));
    if (cost && sub && !work.guard && !confirmCost(`${n} 张，${p.width}×${p.height}，${p.steps} 步${refImgs.length ? `，带 ${refImgs.length} 张角色参考` : ''}。`)) return [];
    const ctl = new AbortController(); abortRef.current = ctl;
    const out: HistItem[] = [];
    try {
      for (let i = 0; i < n; i++) {
        setBusy(n > 1 ? `第 ${i + 1} / ${n} 张…` : '正在画…');
        const seed = p.seed >= 0 ? (p.seed + i) % 4294967295 : -1;
        const req = buildImageRequest({ prompt: fullPrompt(sty, promptRaw), negative: fullNegative(sty, negRaw), characters: chars, params: { ...p, seed }, vibes, base, refs: refImgs });
        const blob = await naiGenerate(req.body, ctl.signal);
        out.push(await addHist(blob, { seed: req.seed, prompt: promptRaw, negative: negRaw, characters: chars.map(({ prompt, negative, position, center, name }) => ({ prompt, negative, position, center, name })), params: { ...req.params, seed: req.seed }, kind: o.kind || (base ? (base.mask ? '局部重绘' : '图生图') : '生成') }));
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') addToast(e?.message || '没画成', 'error');
    } finally { setBusy(''); abortRef.current = null; }
    return out;
  };

  /* —— 用这张继续 —— */
  const fromItem = (h: HistItem) => ({ prompt: h.prompt, negative: h.negative, characters: h.characters, params: { ...h.params, seed: -1 } as Partial<DrawParams> });
  const variant = async (h: HistItem, level: number, count: number) => {
    const b = await loadB64(h.token); const s = baseSizeFor(h.width, h.height, work.guard ? FREE_PIXELS : NAI_MAX_PIXELS);
    await generate({ ...fromItem(h), base: { image: await fitImage(b, s.width, s.height, 'cover'), width: s.width, height: s.height, strength: [.5, .7, .8][level], noise: .1 }, count, kind: '变体', useRefs: false });
  };
  const enhance = async (h: HistItem, times: number, level: number) => {
    const b = await loadB64(h.token);
    let w = Math.round(h.width * times / 64) * 64, hh = Math.round(h.height * times / 64) * 64;
    if (w * hh > NAI_MAX_PIXELS) { const k = Math.sqrt(NAI_MAX_PIXELS / (w * hh)); w = Math.floor(w * k / 64) * 64; hh = Math.floor(hh * k / 64) * 64; }
    if (!confirmCost(`增强到 ${w}×${hh}。`)) return;
    await generate({ ...fromItem(h), params: { ...h.params, seed: -1, steps: 28 }, base: { image: await fitImage(b, w, hh, 'cover'), width: w, height: hh, strength: [.2, .4, .5, .6, .7][level - 1], noise: level === 5 ? .1 : 0, enhance: true }, count: 1, kind: '增强', useRefs: false });
  };
  const upscale = async (h: HistItem) => {
    if (!upscaleBy(h.width, h.height)) return addToast('这张已经够大了，再放大会超过 4096', 'info');
    if (!confirmCost('NovelAI 放大 2 倍。')) return;
    setBusy('放大中…');
    try { const blob = await naiUpscale(upscaleBody(await blobToBase64(await loadB64(h.token)))); await addHist(blob, { ...fromItem(h), seed: h.seed, kind: '放大' }); }
    catch (e: any) { addToast(e?.message || '没放大成', 'error'); } finally { setBusy(''); }
  };
  const director = async (h: HistItem, tool: string, mood: string, words: string, defry: number) => {
    if (!confirmCost(`导演工具「${DIRECTOR_TOOLS[tool]}」。`)) return;
    setBusy(`${DIRECTOR_TOOLS[tool]}…`);
    try {
      const blobs = await naiAugment(augmentBody({ tool, image: await blobToBase64(await loadB64(h.token)), width: h.width, height: h.height, prompt: words, mood, defry }));
      for (const b of blobs) await addHist(b, { ...fromItem(h), seed: h.seed, kind: DIRECTOR_TOOLS[tool] });
    } catch (e: any) { addToast(e?.message || '没做成', 'error'); } finally { setBusy(''); }
  };
  const useSettings = (h: HistItem) => { setWork(w => ({ ...w, prompt: h.prompt, negative: h.negative, characters: h.characters.map(c => ({ ...c, id: uid() })), params: normalizeDrawParams({ ...w.params, ...h.params, seed: -1 }) })); addToast('设置填回工作台了', 'success'); setTab('draw'); };
  const useSeed = (h: HistItem) => { if (h.seed === undefined) return; setWork(w => ({ ...w, params: { ...w.params, seed: h.seed! } })); addToast(`种子 ${h.seed}`, 'success'); };
  const removeItem = async (h: HistItem) => {
    if (!window.confirm('删掉这张图？')) return;
    setHist(list => list.filter(x => x.id !== h.id)); if (current === h.id) setCurrent(hist.find(x => x.id !== h.id)?.id || null);
    setTimeout(() => { void deleteBlobRefIfUnreferenced(h.token); }, 500);
  };
  const download = async (h: HistItem) => { const b = await loadB64(h.token); await shareOrDownloadBlob({ blob: b, fileName: `draw-${h.seed ?? h.id}.png`, preferDownloadOnWeb: true }); };

  /* —— 读图 —— */
  const readPng = async (file: File) => {
    const back = await readNaiPng(file).catch(() => null);
    const token = await putImageBlob(file); const { width, height } = await imageSize(file);
    const item: HistItem = { id: uid(), token, width, height, at: Date.now(), seed: back?.params.seed, prompt: back?.prompt || '', negative: back?.negative || '', characters: back?.characters || [], params: back?.params || {}, kind: '读图' };
    setHist(h => [item, ...h]); setCurrent(item.id);
    if (back) { useSettings(item); addToast('读出了提示词和参数', 'success'); } else addToast('这张图里没有 NovelAI 的参数，只放进了相册', 'info');
  };

  /* —— 助手 —— */
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat.length, tab]);
  const drawBlock = async (msgId: string, b: ImgBlock) => {
    const w = blockToWork(b, cast); const [width, height] = ORIENT_SIZE[b.orient];
    const altAt = chatRef.current.find(m => m.id === msgId)?.alt ?? 0; // 画的时候是哪个版本，图就挂在哪个版本上
    setChat(c => c.map(m => m.id === msgId ? { ...m, drawing: true } : m));
    try {
      const items = await generate({ prompt: w.prompt, negative: work.negative, characters: w.characters, params: { width, height, seed: -1 }, count: 1, kind: '助手', useRefs: false });
      const ids = items.map(i => i.id);
      setChat(c => c.map(m => {
        if (m.id !== msgId) return m;
        const base = showAlt(m, m.alt ?? 0); const imgs = (base.altImgs || []).map(x => x.slice());
        imgs[altAt] = [...(imgs[altAt] || []), ...ids];
        return showAlt({ ...base, altImgs: imgs, drawing: false }, base.alt ?? 0);
      }));
    } catch (e: any) { setChat(c => c.map(m => m.id === msgId ? { ...m, drawing: false } : m)); addToast(e?.message || '没画成', 'error'); }
  };
  const toWorkbench = (b: ImgBlock) => {
    const w = blockToWork(b, cast); const [width, height] = ORIENT_SIZE[b.orient];
    setWork(x => ({ ...x, prompt: w.prompt, characters: w.characters.map(c => ({ ...c, id: uid() })), params: { ...x.params, width, height } }));
    setTab('draw'); addToast('放进工作台了', 'success');
  };
  const chatRef = useRef(chat); chatRef.current = chat;
  const chatAbortRef = useRef<AbortController | null>(null);
  /** 按 history（最后一条是用户的话）回一次；replaceId 给了就是重 roll：新回复存成那条的另一个版本 */
  const reply = async (history: ChatMsg[], replaceId?: string) => {
    const lastUser = [...history].reverse().find(m => m.role === 'user'); if (!lastUser) return;
    setChatBusy(true);
    const ac = new AbortController(); chatAbortRef.current = ac;
    try {
      const hint = turnHint(lastUser.text);
      const sys = assistantSystem(cast, style.name, NAI_MODEL_NAMES[work.params.model] || work.params.model) + (hint ? `\n\n${TURN_HINTS[hint]}` : '');
      const msgs = history.filter(m => !m.error && m.text.trim()).slice(-24).map(m => ({ role: m.role, content: m.text }));
      const out = await chatCall(apiConfig, [{ role: 'system', content: sys }, ...msgs], '绘图助手', 1800, replaceId ? 0.9 : 0.7, ac.signal) || '（没回出东西）';
      let targetId = replaceId || '';
      if (replaceId) {
        setChat(c => c.map(m => {
          if (m.id !== replaceId) return m;
          const base = showAlt(m, m.alt ?? 0);
          return showAlt({ ...base, error: undefined, alts: [...base.alts!, out], altImgs: [...base.altImgs!, []] }, base.alts!.length);
        }));
      } else {
        const aMsg: ChatMsg = { id: uid(), role: 'assistant', text: out, alts: [out], altImgs: [[]], alt: 0 };
        targetId = aMsg.id; setChat(() => [...history, aMsg]);
      }
      const { blocks } = parseBlocks(out);
      if (hint === 'draw' && blocks[0]) setTimeout(() => void drawBlock(targetId, blocks[0]), 0);
    } catch (e: any) {
      if (ac.signal.aborted || e?.name === 'AbortError') { if (!replaceId) setChat(() => history); }
      else if (replaceId) { addToast(e?.message || '重 roll 失败', 'error'); }
      else setChat(() => [...history, { id: uid(), role: 'assistant', text: '', error: e?.message || '出错了' }]);
    } finally { setChatBusy(false); chatAbortRef.current = null; }
  };
  const send = async () => {
    const text = chatInput.trim(); if (!text || chatBusy) return;
    setChatInput('');
    // 上一条是报错的话，先把它拿掉
    const base = chatRef.current.filter((m, i, a) => !(m.error && i === a.length - 1));
    const history = [...base, { id: uid(), role: 'user' as const, text }];
    setChat(() => history);
    await reply(history);
  };
  const stopReply = () => chatAbortRef.current?.abort();
  /** 重 roll：这条助手回复再出一个版本（旧的留着，可以左右翻） */
  const reroll = (id: string) => {
    if (chatBusy) return;
    const i = chatRef.current.findIndex(m => m.id === id); if (i < 0) return;
    const m = chatRef.current[i];
    if (m.error) { const h = chatRef.current.slice(0, i); setChat(() => h); void reply(h); return; }
    void reply(chatRef.current.slice(0, i), id);
  };
  const flipAlt = (id: string, d: number) => setChat(c => c.map(m => m.id === id ? showAlt(m, (m.alt ?? 0) + d) : m));
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [actFor, setActFor] = useState<string | null>(null);
  /** 改完：助手的直接改当前版本；用户的可以只改，也可以改完从这里重新回复（后面的对话会去掉） */
  const saveEdit = (resend: boolean) => {
    if (!editing) return;
    const { id, text } = editing; const i = chatRef.current.findIndex(m => m.id === id); if (i < 0) return setEditing(null);
    const m = chatRef.current[i];
    if (m.role === 'assistant') {
      setChat(c => c.map(x => { if (x.id !== id) return x; const b = showAlt(x, x.alt ?? 0); const alts = b.alts!.slice(); alts[b.alt!] = text; return showAlt({ ...b, alts }, b.alt!); }));
    } else if (resend) {
      const h = [...chatRef.current.slice(0, i), { ...m, text }]; setChat(() => h); void reply(h);
    } else setChat(c => c.map(x => x.id === id ? { ...x, text } : x));
    setEditing(null); setActFor(null);
  };
  const delMsg = (id: string) => { setChat(c => c.filter(m => m.id !== id)); setActFor(null); };
  const copyMsg = (t: string) => { void navigator.clipboard?.writeText(t).then(() => addToast('复制了', 'success')).catch(() => addToast('复制不了，长按文字手动选', 'info')); setActFor(null); };

  /* —— 提示词小工具 —— */
  const [toolText, setToolText] = useState(''); const [wish, setWish] = useState(''); const [undo, setUndo] = useState<string | null>(null);
  const runTool = async (kind: 'translate' | 'revise' | 'write') => {
    setBusy(kind === 'translate' ? '翻译中…' : '在写…');
    try {
      if (kind === 'translate') setToolText(await translatePrompt(apiConfig, work.prompt));
      else if (kind === 'revise') { const out = await revisePrompt(apiConfig, work.prompt, wish); setUndo(work.prompt); setWork(w => ({ ...w, prompt: out })); setSheet(null); }
      else { const out = await writePrompt(apiConfig, wish); setUndo(work.prompt); setWork(w => ({ ...w, prompt: out })); setSheet(null); }
    } catch (e: any) { addToast(e?.message || '没写成', 'error'); } finally { setBusy(''); }
  };

  /* —— 文件选择 —— */
  const fileRef = useRef<HTMLInputElement>(null);
  const filePurpose = useRef<'read' | 'base' | 'ref' | 'vibe'>('read');
  const pickFile = (p: typeof filePurpose.current) => { filePurpose.current = p; fileRef.current?.click(); };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    const p = filePurpose.current;
    if (p === 'read') return readPng(file);
    const token = await putImageBlob(file);
    if (p === 'base') setRefs(r => ({ ...r, base: { token, strength: .7, noise: 0 } }));
    else if (p === 'ref') setRefs(r => ({ ...r, refs: [...r.refs, { id: uid(), token, kind: 'character', strength: .6, fidelity: .5 }].slice(0, MAX_REFERENCES) }));
    else setRefs(r => ({ ...r, vibes: [...r.vibes, { id: uid(), token, name: file.name.replace(/\.[^.]+$/, '').slice(0, 20) || 'Vibe', strength: .6, ie: work.params.model === 'nai-diffusion-4-5-full' ? .7 : 1, on: true, enc: {} }] }));
  };

  /* —— 界面 —— */
  const P = work.params;
  const setP = (patch: Partial<DrawParams>) => setWork(w => ({ ...w, params: normalizeDrawParams({ ...w.params, ...patch }) }));
  const [dirTool, setDirTool] = useState('bg-removal'); const [dirMood, setDirMood] = useState('happy'); const [dirWords, setDirWords] = useState(''); const [dirDefry, setDirDefry] = useState(0);
  const [enhTimes, setEnhTimes] = useState(1.5); const [enhLevel, setEnhLevel] = useState(3); const [varLevel, setVarLevel] = useState(1); const [varCount, setVarCount] = useState(1);

  const header = (
    <div className="shrink-0 px-4 pt-[calc(env(safe-area-inset-top)+8px)] pb-2" style={{ background: C.bg }}>
      <div className="flex items-center justify-between">
        <button onClick={closeApp} className="text-[13px]" style={{ color: C.muted }}>‹ 返回</button>
        <div className="text-[15px] font-semibold tracking-wide" style={{ color: C.ink, fontFamily: `'Noto Serif SC', serif` }}>绘图</div>
        <div className="text-[10px] text-right" style={{ color: C.faint }}>{sub ? `${TIER_NAMES[sub.tier] || ''}${sub.anlas ? ` · ${sub.anlas} Anlas` : ''}` : ''}</div>
      </div>
      <div className="flex gap-1 mt-2 p-1 rounded-full" style={{ background: '#ece8e0' }}>
        {([['draw', '画'], ['refs', '参考'], ['chat', '助手'], ['album', '相册']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className="flex-1 py-1.5 rounded-full text-[12px] transition" style={tab === k ? { background: C.card, color: C.ink, fontWeight: 600, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } : { color: C.muted }}>
            {l}{k === 'refs' && (refs.base || refs.refs.length || refs.vibes.some(v => v.on)) ? ' ·' : ''}
          </button>
        ))}
      </div>
    </div>
  );

  const toolsFor = (h: HistItem) => (
    <div className="grid grid-cols-4 gap-1.5 mt-2">
      {[
        ['当底图', () => { setRefs(r => ({ ...r, base: { token: h.token, strength: .7, noise: 0 } })); addToast('放进参考 → 底图', 'success'); }, false],
        ['当参考', () => { setRefs(r => ({ ...r, refs: [...r.refs, { id: uid(), token: h.token, kind: 'character' as const, strength: .6, fidelity: .5 }].slice(0, MAX_REFERENCES) })); addToast('放进参考 → 角色参考', 'success'); }, false],
        ['变体', () => setSheet('variant'), true],
        ['增强', () => setSheet('enhance'), true],
        ['放大', () => upscale(h), true],
        ['导演工具', () => setSheet('director'), true],
        ['用它的设置', () => useSettings(h), false],
        ['用它的种子', () => useSeed(h), false],
      ].map(([l, fn, paid]) => (
        <button key={l as string} disabled={!!busy} onClick={fn as () => void} className="relative text-[11px] py-2 rounded-xl disabled:opacity-40" style={{ background: '#f4f1eb', color: C.ink }}>
          {l as string}{paid && <span className="absolute top-0.5 right-1 text-[8px]" style={{ color: C.warn }}>¤</span>}
        </button>
      ))}
    </div>
  );

  return (
    <div className="h-full w-full flex flex-col relative overflow-hidden" style={{ background: C.bg, color: C.ink }}>
      {header}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />

      {/* ───── 画 ───── */}
      {tab === 'draw' && (
        <div className="flex-1 overflow-y-auto px-4 pb-28">
          <div className="rounded-3xl overflow-hidden relative" style={{ background: C.card, border: `1px solid ${C.line}` }}>
            <div className="flex items-center justify-center" style={{ ...(curItem ? { aspectRatio: `${curItem.width}/${curItem.height}`, maxHeight: '56vh' } : { height: 180 }), background: 'repeating-conic-gradient(#f3f0ea 0% 25%, #fbfaf7 0% 50%) 50% / 18px 18px', width: '100%' }}>
              {curItem ? <button className="w-full h-full" onClick={() => { setViewer(curItem); setSheet('viewer'); }}><TokenImg value={curItem.token} className="w-full h-full object-contain" /></button>
                : <div className="text-[12px] text-center px-8" style={{ color: C.faint }}>写好提示词，点下面的「画」。<br />画过的图都在这里和相册里。</div>}
            </div>
            {busy && <div className="absolute inset-x-0 bottom-0 px-3 py-2 text-[11.5px] flex items-center justify-between" style={{ background: 'rgba(31,29,26,0.72)', color: '#fff' }}>
              <span>{busy}</span>{abortRef.current && <button onClick={() => abortRef.current?.abort()} className="opacity-80">停下</button>}
            </div>}
          </div>
          {hist.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto mt-2 pb-1">
              {hist.slice(0, 30).map(h => (
                <button key={h.id} onClick={() => setCurrent(h.id)} className="shrink-0 w-12 h-12 rounded-xl overflow-hidden" style={{ outline: h.id === current ? `2px solid ${C.accent}` : 'none', outlineOffset: 1 }}>
                  <TokenImg value={h.token} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
          {curItem && <>
            <div className="flex items-center justify-between mt-2 text-[10.5px]" style={{ color: C.muted }}>
              <span>用这张继续 · {curItem.kind}{curItem.seed !== undefined ? ` · 种子 ${curItem.seed}` : ''}</span>
              <span className="flex gap-3"><button onClick={() => download(curItem)}>下载</button><button onClick={() => removeItem(curItem)} style={{ color: C.warn }}>删除</button></span>
            </div>
            {toolsFor(curItem)}
          </>}

          {/* 提示词 */}
          <div className="mt-4 rounded-3xl p-3.5 space-y-3" style={{ background: C.card, border: `1px solid ${C.line}` }}>
            <div className="flex items-center gap-2">
              <button onClick={() => setSheet('style')} className="flex-1 min-w-0 text-left px-3 py-1.5 rounded-full text-[12px] truncate" style={{ background: C.soft, color: C.accent }}>画风 · {style.name} ▾</button>
              <Btn small tone="ghost" onClick={() => pickFile('read')}>读图</Btn>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10.5px]" style={{ color: C.muted }}>提示词</span>
                <span className="flex gap-2 text-[10.5px]" style={{ color: C.accent }}>
                  <button onClick={() => { setToolText(''); setSheet('translate'); void runTool('translate'); }} disabled={!work.prompt.trim()}>看中文</button>
                  <button onClick={() => { setWish(''); setSheet('revise'); }} disabled={!work.prompt.trim()}>按我说的改</button>
                  <button onClick={() => { setWish(''); setSheet('write'); }}>帮我写</button>
                  {undo !== null && <button onClick={() => { setWork(w => ({ ...w, prompt: undo })); setUndo(null); }} style={{ color: C.muted }}>还原</button>}
                </span>
              </div>
              <textarea value={work.prompt} onChange={e => setWork(w => ({ ...w, prompt: e.target.value }))} rows={4} placeholder="英文 tag，逗号分隔；画风的画师串和固定 tag 会自己加" className={inputCls} style={inputSty} />
            </div>
            <Field label="负面"><textarea value={work.negative} onChange={e => setWork(w => ({ ...w, negative: e.target.value }))} rows={2} placeholder="画风的固定负面会自己加" className={inputCls} style={inputSty} /></Field>

            {/* 角色 */}
            {f.captions && <div>
              <div className="flex items-center justify-between mb-1.5"><span className="text-[10.5px]" style={{ color: C.muted }}>角色（最多 {f.characters} 个，站位：A–E 左到右，1–5 上到下）</span></div>
              <div className="space-y-2">
                {work.characters.map((c, i) => (
                  <div key={c.id} className="rounded-2xl p-2.5" style={{ background: '#faf8f4', border: `1px solid ${C.line}` }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <input value={c.name || ''} onChange={e => setWork(w => ({ ...w, characters: w.characters.map(x => x.id === c.id ? { ...x, name: e.target.value } : x) }))} placeholder={`角色 ${i + 1}`} className="flex-1 bg-transparent text-[12px] font-medium outline-none" style={{ color: C.ink }} />
                      <span className="text-[10px]" style={{ color: C.muted }}>{POS_LABEL(c.position ?? -1)}</span>
                      <button onClick={() => setWork(w => ({ ...w, characters: w.characters.map(x => x.id === c.id ? { ...x, enabled: x.enabled === false } : x) }))} className="text-[10px]" style={{ color: c.enabled === false ? C.faint : C.ok }}>{c.enabled === false ? '关' : '开'}</button>
                      <button onClick={() => setWork(w => ({ ...w, characters: w.characters.filter(x => x.id !== c.id) }))} className="text-[10px]" style={{ color: C.warn }}>删</button>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1 space-y-1.5">
                        <textarea value={c.prompt} onChange={e => setWork(w => ({ ...w, characters: w.characters.map(x => x.id === c.id ? { ...x, prompt: e.target.value } : x) }))} rows={2} placeholder="这个人的 tag" className={inputCls} style={{ ...inputSty, background: '#fff' }} />
                        <input value={c.negative || ''} onChange={e => setWork(w => ({ ...w, characters: w.characters.map(x => x.id === c.id ? { ...x, negative: e.target.value } : x) }))} placeholder="他自己的负面" className={inputCls} style={{ ...inputSty, background: '#fff' }} />
                      </div>
                      <PosGrid value={c.position ?? -1} onChange={v => setWork(w => ({ ...w, characters: w.characters.map(x => x.id === c.id ? { ...x, position: v } : x) }))} />
                    </div>
                  </div>
                ))}
              </div>
              {work.characters.length < f.characters && <div className="flex flex-wrap gap-1.5 mt-2">
                {cast.map(c => <Btn key={c.name} small onClick={() => setWork(w => ({ ...w, characters: [...w.characters, { id: uid(), name: c.name, prompt: c.tags, negative: c.negative, position: -1 }] }))}>+ {c.name}</Btn>)}
                <Btn small tone="ghost" onClick={() => setWork(w => ({ ...w, characters: [...w.characters, { id: uid(), name: '', prompt: '', negative: '', position: -1 }] }))}>+ 空白</Btn>
              </div>}
            </div>}

            <button onClick={() => setSheet('params')} className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-[11.5px]" style={{ background: '#f4f1eb', color: C.ink }}>
              <span>{NAI_MODEL_NAMES[P.model]} · {P.width}×{P.height} · {P.steps} 步 · {NAI_SAMPLER_NAMES[P.sampler]}{P.seed >= 0 ? ` · 种子 ${P.seed}` : ''}</span><span style={{ color: C.muted }}>参数 ›</span>
            </button>
          </div>
        </div>
      )}

      {/* ───── 参考 ───── */}
      {tab === 'refs' && (
        <div className="flex-1 overflow-y-auto px-4 pb-28 space-y-3">
          <div className="rounded-3xl p-3.5" style={{ background: C.card, border: `1px solid ${C.line}` }}>
            <div className="flex items-center justify-between"><div className="text-[13px] font-semibold">底图</div><div className="text-[10.5px]" style={{ color: C.muted }}>{refs.base ? (refs.base.mask ? '局部重绘' : '图生图') : '没放'}</div></div>
            <div className="text-[10.5px] mt-0.5 mb-2" style={{ color: C.faint }}>按这张图的构图和颜色重画。涂一块就只重画涂的地方。</div>
            {refs.base ? <>
              <div className="flex gap-3">
                <div className="w-24 h-24 rounded-2xl overflow-hidden shrink-0 relative" style={{ background: '#f1eee8' }}>
                  <TokenImg value={refs.base.token} className="w-full h-full object-cover" />
                  {refs.base.mask && <TokenImg value={refs.base.mask} className="absolute inset-0 w-full h-full object-cover mix-blend-screen opacity-50" />}
                </div>
                <div className="flex-1 space-y-2">
                  <Slider label="强度（越高越不像原图）" value={refs.base.strength} min={0.01} max={refs.base.mask ? 1 : 0.99} step={0.01} onChange={v => setRefs(r => ({ ...r, base: r.base && { ...r.base, strength: v } }))} />
                  {!refs.base.mask && <Slider label="噪声" value={refs.base.noise} min={0} max={0.99} step={0.01} onChange={v => setRefs(r => ({ ...r, base: r.base && { ...r.base, noise: v } }))} />}
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <Btn small onClick={() => setMasking(true)}>{refs.base.mask ? '改涂的地方' : '涂出要重画的地方'}</Btn>
                {refs.base.mask && <Btn small tone="ghost" onClick={() => setRefs(r => ({ ...r, base: r.base && { ...r.base, mask: undefined } }))}>不涂了</Btn>}
                <Btn small tone="ghost" onClick={() => setRefs(r => ({ ...r, base: null }))}>拿掉</Btn>
              </div>
            </> : <div className="flex gap-2"><Btn small onClick={() => pickFile('base')}>从手机选</Btn>{curItem && <Btn small tone="ghost" onClick={() => setRefs(r => ({ ...r, base: { token: curItem.token, strength: .7, noise: 0 } }))}>用刚画的那张</Btn>}</div>}
          </div>

          <div className="rounded-3xl p-3.5" style={{ background: C.card, border: `1px solid ${C.line}`, opacity: f.reference ? 1 : 0.55 }}>
            <div className="flex items-center justify-between"><div className="text-[13px] font-semibold">角色参考</div><div className="text-[10.5px]" style={{ color: C.muted }}>{refs.refs.length} / {MAX_REFERENCES}</div></div>
            <div className="text-[10.5px] mt-0.5 mb-2" style={{ color: C.faint }}>{f.reference ? `照着画这个人 / 这个画风。每张参考每张图多扣 ${REFERENCE_ANLAS} Anlas；用参考时不带 Vibe。` : '只有 V4.5 能用，换到 V4.5 才会带上。'}</div>
            <div className="space-y-2">
              {refs.refs.map(r => (
                <div key={r.id} className="flex gap-3 items-start">
                  <TokenImg value={r.token} className="w-16 h-16 rounded-xl object-cover shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="flex gap-1">{(['character', 'style', 'both'] as const).map(k => <button key={k} onClick={() => setRefs(x => ({ ...x, refs: x.refs.map(y => y.id === r.id ? { ...y, kind: k } : y) }))} className="text-[10.5px] px-2 py-0.5 rounded-full" style={r.kind === k ? { background: C.ink, color: '#fff' } : { background: '#f1eee8', color: C.muted }}>{k === 'character' ? '角色' : k === 'style' ? '画风' : '角色+画风'}</button>)}
                      <button onClick={() => setRefs(x => ({ ...x, refs: x.refs.filter(y => y.id !== r.id) }))} className="ml-auto text-[10.5px]" style={{ color: C.warn }}>删</button></div>
                    <Slider label="强度" value={r.strength} min={-1} max={1} step={0.05} onChange={v => setRefs(x => ({ ...x, refs: x.refs.map(y => y.id === r.id ? { ...y, strength: v } : y) }))} />
                    <Slider label="保真度" value={r.fidelity} min={-1} max={1} step={0.05} onChange={v => setRefs(x => ({ ...x, refs: x.refs.map(y => y.id === r.id ? { ...y, fidelity: v } : y) }))} />
                  </div>
                </div>
              ))}
            </div>
            {refs.refs.length < MAX_REFERENCES && <div className="flex gap-2 mt-2"><Btn small onClick={() => pickFile('ref')}>+ 从手机选</Btn>{curItem && <Btn small tone="ghost" onClick={() => setRefs(r => ({ ...r, refs: [...r.refs, { id: uid(), token: curItem.token, kind: 'character', strength: .6, fidelity: .5 }] }))}>+ 刚画的那张</Btn>}</div>}
          </div>

          <div className="rounded-3xl p-3.5" style={{ background: C.card, border: `1px solid ${C.line}`, opacity: f.vibes ? 1 : 0.55 }}>
            <div className="flex items-center justify-between"><div className="text-[13px] font-semibold">Vibe 氛围转移</div><div className="text-[10.5px]" style={{ color: C.muted }}>{refs.vibes.filter(v => v.on).length} 个开着</div></div>
            <div className="text-[10.5px] mt-0.5 mb-2" style={{ color: C.faint }}>{f.vibes ? `借图的氛围和画风。第一次用每个模型要编码一次（${VIBE_ANLAS} Anlas），超过 ${MAX_FREE_VIBES} 个每个多 ${VIBE_ANLAS} Anlas。` : 'V4 / V4.5 才能用；V5 不支持 Vibe。'}</div>
            <div className="space-y-2">
              {refs.vibes.map(v => (
                <div key={v.id} className="flex gap-3 items-start">
                  <TokenImg value={v.token} className="w-14 h-14 rounded-xl object-cover shrink-0" style={{ opacity: v.on ? 1 : 0.4 }} />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 text-[11px]">
                      <input value={v.name} onChange={e => setRefs(x => ({ ...x, vibes: x.vibes.map(y => y.id === v.id ? { ...y, name: e.target.value } : y) }))} className="flex-1 bg-transparent outline-none font-medium" />
                      <button onClick={() => setRefs(x => ({ ...x, vibes: x.vibes.map(y => y.id === v.id ? { ...y, on: !y.on } : y) }))} style={{ color: v.on ? C.ok : C.faint }}>{v.on ? '开' : '关'}</button>
                      <button onClick={() => setRefs(x => ({ ...x, vibes: x.vibes.filter(y => y.id !== v.id) }))} style={{ color: C.warn }}>删</button>
                    </div>
                    <Slider label="强度" value={v.strength} min={0} max={1} step={0.05} onChange={n => setRefs(x => ({ ...x, vibes: x.vibes.map(y => y.id === v.id ? { ...y, strength: n } : y) }))} />
                    <Slider label="提取信息量" value={v.ie} min={0.01} max={1} step={0.01} onChange={n => setRefs(x => ({ ...x, vibes: x.vibes.map(y => y.id === v.id ? { ...y, ie: n } : y) }))} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2"><Btn small onClick={() => pickFile('vibe')}>+ 加一张</Btn></div>
          </div>
        </div>
      )}

      {/* ───── 助手 ───── */}
      {tab === 'chat' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="shrink-0 px-4 pb-2 flex items-center gap-2 text-[11px]" style={{ color: C.muted }}>
            <span className="shrink-0">用</span>
            <select value={apiChoice} onChange={e => { setApiChoiceState(e.target.value); setAppApiChoice('draw', e.target.value); }} className="flex-1 min-w-0 rounded-xl px-2 py-1 text-[11px] outline-none" style={inputSty}>
              {appApiOptions(mainApi, apiPresets).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="shrink-0" style={{ color: C.faint }}>写提示词 / 聊天</span>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-3">
            {!chat.length && <div className="text-[12px] leading-relaxed mt-6 text-center px-6" style={{ color: C.muted }}>
              跟我说想画什么，可以先聊构图、画风、颜色。<br />方案定了说「画吧」，我就直接画出来。<br />
              <span style={{ color: C.faint }}>比如：「给我的 App 画个图标，深蓝夜空里一部发光的小手机」</span>
            </div>}
            {chat.map((m, mi) => {
              const { parts } = m.role === 'assistant' ? parseBlocks(m.text) : { parts: [m.text] };
              const nAlt = m.alts?.length || 1, isLast = mi === chat.length - 1;
              const open = actFor === m.id;
              const actions = (
                <div className={`flex items-center gap-3 text-[11px] mt-1 ${m.role === 'user' ? 'justify-end' : ''}`} style={{ color: C.muted }}>
                  {m.role === 'assistant' && nAlt > 1 && <span className="flex items-center gap-1.5"><button disabled={(m.alt ?? 0) <= 0} onClick={() => flipAlt(m.id, -1)} className="px-1 disabled:opacity-30">‹</button>{(m.alt ?? 0) + 1}/{nAlt}<button disabled={(m.alt ?? 0) >= nAlt - 1} onClick={() => flipAlt(m.id, 1)} className="px-1 disabled:opacity-30">›</button></span>}
                  {m.role === 'user' && isLast && !chatBusy && <button onClick={() => void reply(chatRef.current)} style={{ color: C.accent }}>让它回这条</button>}
                  {m.role === 'assistant' && (isLast || open) && <button disabled={chatBusy} onClick={() => reroll(m.id)} className="disabled:opacity-40">{m.error ? '重试' : '重 roll'}</button>}
                  {open && <>
                    {!m.error && <button onClick={() => setEditing({ id: m.id, text: m.text })}>编辑</button>}
                    {!m.error && <button onClick={() => copyMsg(m.text)}>复制</button>}
                    <button onClick={() => delMsg(m.id)} style={{ color: C.warn }}>删除</button>
                  </>}
                  {!open && !m.error && <button onClick={() => setActFor(m.id)} style={{ color: C.faint }}>···</button>}
                  {open && <button onClick={() => setActFor(null)} style={{ color: C.faint }}>收起</button>}
                </div>
              );
              if (editing?.id === m.id) return (
                <div key={m.id} className="rounded-2xl p-2.5 space-y-2" style={{ background: C.card, border: `1px solid ${C.accent}` }}>
                  <textarea value={editing.text} onChange={e => setEditing({ id: m.id, text: e.target.value })} rows={Math.min(14, Math.max(3, editing.text.split('\n').length + 1))} className="w-full rounded-xl px-2.5 py-2 text-[12.5px] outline-none resize-y font-[inherit]" style={inputSty} autoFocus />
                  <div className="flex gap-2 justify-end">
                    <Btn small tone="ghost" onClick={() => setEditing(null)}>取消</Btn>
                    <Btn small onClick={() => saveEdit(false)}>{m.role === 'user' ? '只改字' : '保存'}</Btn>
                    {m.role === 'user' && <Btn small tone="solid" disabled={chatBusy} onClick={() => saveEdit(true)}>改完重新回复</Btn>}
                  </div>
                  {m.role === 'user' && <div className="text-[10.5px]" style={{ color: C.faint }}>「改完重新回复」会去掉这条后面的对话。</div>}
                  {m.role === 'assistant' && <div className="text-[10.5px]" style={{ color: C.faint }}>出图块里的 tag 也能直接改，保存后点「画这张」就按改过的画。</div>}
                </div>
              );
              return (
                <div key={m.id} className={m.role === 'user' ? 'flex flex-col items-end' : ''}>
                  {m.role === 'user' ? <div onClick={() => setActFor(open ? null : m.id)} className="max-w-[80%] px-3.5 py-2 rounded-2xl rounded-br-md text-[13px] whitespace-pre-wrap" style={{ background: C.ink, color: '#fff' }}>{m.text}</div> : (
                    <div className="space-y-2 max-w-[92%]">
                      {m.error && <div className="text-[12px] px-3 py-2 rounded-2xl" style={{ background: '#fbecE6', color: C.warn }}>{m.error}</div>}
                      {parts.map((p, i) => typeof p === 'string' ? (p.trim() ? <div key={i} onClick={() => setActFor(open ? null : m.id)} className="text-[13px] leading-relaxed whitespace-pre-wrap px-3.5 py-2 rounded-2xl rounded-bl-md" style={{ background: C.card, border: `1px solid ${C.line}` }}>{p.trim()}</div> : null) : (
                        <div key={i} className="rounded-2xl p-3 text-[11px]" style={{ background: C.soft, border: `1px solid #ddd6fa` }}>
                          <div className="flex justify-between mb-1" style={{ color: C.accent }}><span>出图块 · {p.orient === 'landscape' ? '横' : p.orient === 'square' ? '方' : '竖'}</span><span>{p.chars.length} 个角色</span></div>
                          <div className="font-mono text-[10.5px] leading-snug" style={{ color: C.ink }}>{p.scene}</div>
                          {p.chars.map((c, j) => <div key={j} className="mt-1 text-[10.5px]" style={{ color: C.muted }}><b style={{ color: C.ink }}>{c.name}</b> {POS_LABEL(c.position)} · {c.tags}</div>)}
                          <div className="flex gap-2 mt-2 flex-wrap">
                            <Btn small tone="solid" disabled={!!busy || m.drawing} onClick={() => drawBlock(m.id, p)}>{m.drawing ? '在画…' : m.images?.length ? '再画一张' : '画这张'}</Btn>
                            <Btn small onClick={() => toWorkbench(p)}>放进工作台</Btn>
                            <Btn small tone="ghost" onClick={() => setEditing({ id: m.id, text: m.text })}>改 tag</Btn>
                          </div>
                        </div>
                      ))}
                      {!!m.images?.length && <div className="flex gap-2 flex-wrap">{m.images.map(id => { const h = hist.find(x => x.id === id); return h ? <button key={id} onClick={() => { setViewer(h); setSheet('viewer'); }} className="w-40 rounded-2xl overflow-hidden" style={{ aspectRatio: `${h.width}/${h.height}` }}><TokenImg value={h.token} className="w-full h-full object-cover" /></button> : null; })}</div>}
                      {m.drawing && <div className="text-[11px]" style={{ color: C.muted }}>{busy || '在画…'}</div>}
                    </div>
                  )}
                  {actions}
                </div>
              );
            })}
            {chatBusy && <div className="flex items-center gap-3 text-[12px]" style={{ color: C.muted }}>在想…<button onClick={stopReply} className="px-2.5 py-0.5 rounded-full text-[11px]" style={{ border: `1px solid ${C.line}` }}>停下</button></div>}
            <div ref={chatEnd} />
          </div>
          <div className="shrink-0 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+10px)] flex gap-2 items-end" style={{ background: C.bg, borderTop: `1px solid ${C.line}` }}>
            {chat.length > 0 && <button onClick={() => { if (window.confirm('清空和助手的对话？（画好的图还在相册）')) setChat(() => []); }} className="text-[11px] pb-2" style={{ color: C.faint }}>清空</button>}
            <textarea value={chatInput} onChange={e => setChatInput(e.target.value)} rows={1} placeholder="想画什么…" className="flex-1 rounded-2xl px-3 py-2 text-[13px] outline-none resize-none max-h-28" style={inputSty}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
            <Btn tone="solid" onClick={send} disabled={chatBusy || !chatInput.trim()}>发送</Btn>
          </div>
        </div>
      )}

      {/* ───── 相册 ───── */}
      {tab === 'album' && (
        <div className="flex-1 overflow-y-auto px-3 pb-8">
          {!hist.length ? <div className="text-[12px] text-center mt-10" style={{ color: C.faint }}>还没画过。</div> : (
            <div className="grid grid-cols-3 gap-1.5">
              {hist.map(h => (
                <button key={h.id} onClick={() => { setViewer(h); setSheet('viewer'); }} className="relative aspect-square rounded-xl overflow-hidden" style={{ background: '#ece8e0' }}>
                  <TokenImg value={h.token} className="w-full h-full object-cover" />
                  {h.kind !== '生成' && <span className="absolute left-1 bottom-1 text-[8.5px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(31,29,26,0.6)', color: '#fff' }}>{h.kind}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 底栏：生成 */}
      {(tab === 'draw' || tab === 'refs') && (
        <div className="absolute inset-x-0 bottom-0 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+10px)]" style={{ background: `linear-gradient(180deg, transparent, ${C.bg} 30%)` }}>
          <div className="flex items-center gap-2 rounded-full p-1.5 pl-3" style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: '0 6px 24px rgba(31,29,26,0.08)' }}>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4].map(n => <button key={n} onClick={() => setWork(w => ({ ...w, count: n }))} className="w-6 h-6 rounded-full text-[11px]" style={work.count === n ? { background: C.ink, color: '#fff' } : { color: C.muted }}>{n}</button>)}
            </div>
            <button onClick={() => setWork(w => ({ ...w, guard: !w.guard }))} className="text-[10px] leading-tight text-left flex-1 min-w-0" style={{ color: free === true && !extraAnlas ? C.ok : C.warn }}>
              <div className="truncate">{costText}</div><div className="truncate" style={{ color: C.faint }}>{work.guard ? '守卫开：自动压到免费档' : '守卫关'}</div>
            </button>
            <button onClick={() => busy ? abortRef.current?.abort() : void generate()} className="px-5 py-2 rounded-full text-[13px] font-semibold" style={{ background: busy ? C.muted : C.accent, color: '#fff' }}>{busy ? '停下' : '画'}</button>
          </div>
          {note && <div className="text-[10px] mt-1 text-center" style={{ color: C.muted }}>{note}</div>}
        </div>
      )}

      {/* ───── 弹层 ───── */}
      {masking && refs.base && <MaskPainter imageToken={refs.base.token} maskToken={refs.base.mask} onClose={() => setMasking(false)}
        onDone={async b => { setMasking(false); if (!b) return setRefs(r => ({ ...r, base: r.base && { ...r.base, mask: undefined } })); const t = await putImageBlob(b); setRefs(r => ({ ...r, base: r.base && { ...r.base, mask: t, strength: 1 } })); }} />}

      {sheet === 'style' && <Sheet title="画风" onClose={() => setSheet(null)}>
        <div className="space-y-2">
          {cfg.styles.map(s => (
            <button key={s.id} onClick={() => { const n = { ...cfg, activeStyle: s.id }; saveNaiConfig(n); setCfg(n); setSheet(null); }} className="w-full text-left rounded-2xl p-3" style={{ background: s.id === style.id ? C.soft : '#faf8f4', border: `1px solid ${s.id === style.id ? '#d8d0fb' : C.line}` }}>
              <div className="text-[12.5px] font-medium">{s.name}</div>
              <div className="text-[10.5px] truncate" style={{ color: C.muted }}>{s.artist || '（没写画师串）'}</div>
            </button>
          ))}
          <div className="text-[10.5px]" style={{ color: C.faint }}>画风在「设置 → NovelAI 生图」里编辑，和聊天拍照共用。</div>
        </div>
      </Sheet>}

      {sheet === 'params' && <Sheet title="参数" onClose={() => setSheet(null)}>
        <div className="space-y-3">
          <Field label="模型"><select value={P.model} onChange={e => setP({ model: e.target.value })} className={inputCls} style={inputSty}>{NAI_MODELS.map(m => <option key={m} value={m}>{NAI_MODEL_NAMES[m]}</option>)}</select></Field>
          <div>
            <div className="text-[10.5px] mb-1" style={{ color: C.muted }}>尺寸</div>
            <div className="flex flex-wrap gap-1.5">{SIZE_PRESETS.map(([l, w, h]) => <button key={l} onClick={() => setP({ width: w, height: h })} className="text-[11px] px-2.5 py-1 rounded-full" style={P.width === w && P.height === h ? { background: C.ink, color: '#fff' } : { background: '#f1eee8', color: C.muted }}>{l} {w}×{h}</button>)}</div>
            <div className="flex gap-2 mt-2"><input type="number" step={64} value={P.width} onChange={e => setP({ width: Number(e.target.value) })} className={inputCls} style={inputSty} /><span className="self-center" style={{ color: C.faint }}>×</span><input type="number" step={64} value={P.height} onChange={e => setP({ height: Number(e.target.value) })} className={inputCls} style={inputSty} /></div>
          </div>
          <Slider label="步数" value={P.steps} min={1} max={50} step={1} onChange={v => setP({ steps: v })} />
          <Slider label="Scale (CFG)" value={P.scale} min={0} max={10} step={0.1} onChange={v => setP({ scale: v })} />
          {!f.v5 && <Slider label="Rescale" value={P.cfgRescale} min={0} max={1} step={0.02} onChange={v => setP({ cfgRescale: v })} />}
          <div className="grid grid-cols-2 gap-2">
            <Field label="采样器"><select value={P.sampler} onChange={e => setP({ sampler: e.target.value })} className={inputCls} style={inputSty}>{samplersFor(P.model).map(s => <option key={s} value={s}>{NAI_SAMPLER_NAMES[s]}</option>)}</select></Field>
            {schedulesFor(P.model, P.sampler).length > 0 && <Field label="噪声调度"><select value={P.schedule} onChange={e => setP({ schedule: e.target.value })} className={inputCls} style={inputSty}>{schedulesFor(P.model, P.sampler).map(s => <option key={s} value={s}>{s}</option>)}</select></Field>}
            <Field label="质量标签"><select value={P.quality} onChange={e => setP({ quality: e.target.value })} className={inputCls} style={inputSty}>{qualityPresets(P.model).map(q => <option key={q.id} value={q.id}>{q.name}</option>)}</select></Field>
            <Field label="负面预设"><select value={P.ucPreset} onChange={e => setP({ ucPreset: e.target.value })} className={inputCls} style={inputSty}>{ucPresets(P.model).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            {f.mode && <Field label="模式"><select value={P.mode} onChange={e => setP({ mode: e.target.value as DrawParams['mode'] })} className={inputCls} style={inputSty}><option value="anime">动漫</option><option value="furry">福瑞</option><option value="background">背景</option></select></Field>}
            {f.effort && <Field label="努力程度"><select value={P.effort} onChange={e => setP({ effort: e.target.value as DrawParams['effort'] })} className={inputCls} style={inputSty}><option value="high">高</option><option value="medium">中（快、步数固定）</option></select></Field>}
            {f.smea && <Field label="SMEA"><select value={P.smea} onChange={e => setP({ smea: e.target.value as DrawParams['smea'] })} className={inputCls} style={inputSty}><option value="auto">自动</option><option value="on">开</option><option value="dyn">DYN</option><option value="off">关</option></select></Field>}
          </div>
          <div className="flex flex-wrap gap-3 text-[11.5px]">
            {f.variety && <label className="flex items-center gap-1.5"><input type="checkbox" checked={P.variety} onChange={e => setP({ variety: e.target.checked })} />Variety+</label>}
            {f.transparent && <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!P.transparent} onChange={e => setP({ transparent: e.target.checked })} />透明背景</label>}
            {f.decrisper && <label className="flex items-center gap-1.5"><input type="checkbox" checked={P.decrisper} onChange={e => setP({ decrisper: e.target.checked })} />Decrisper</label>}
          </div>
          <Field label="种子" hint="-1 = 每张随机；固定时一次几张依次 +1">
            <div className="flex gap-2"><input type="number" value={P.seed} onChange={e => setP({ seed: Number(e.target.value) })} className={inputCls} style={inputSty} /><Btn small tone="ghost" onClick={() => setP({ seed: -1 })}>随机</Btn></div>
          </Field>
          <div className="text-[10.5px] leading-relaxed" style={{ color: C.faint }}>Opus 免费档：一次一张、不超过 28 步、不超过 1024×1024。守卫开着时超了会自动压回去。{sub?.usage ? ` V5 额度还剩 ${sub.usage.percent}%。` : ''}</div>
        </div>
      </Sheet>}

      {sheet === 'variant' && curItem && <Sheet title="变体" onClose={() => setSheet(null)}>
        <div className="text-[11px] mb-2" style={{ color: C.muted }}>照这张原来的提示词，以它为底图再画。</div>
        <div className="flex gap-1.5 mb-3">{['小', '中', '大'].map((l, i) => <button key={l} onClick={() => setVarLevel(i)} className="flex-1 py-2 rounded-xl text-[12px]" style={varLevel === i ? { background: C.ink, color: '#fff' } : { background: '#f1eee8' }}>变化{l}</button>)}</div>
        <div className="flex gap-1.5 mb-3 items-center text-[11px]"><span style={{ color: C.muted }}>张数</span>{[1, 2, 3, 4].map(n => <button key={n} onClick={() => setVarCount(n)} className="w-7 h-7 rounded-full" style={varCount === n ? { background: C.ink, color: '#fff' } : { background: '#f1eee8' }}>{n}</button>)}</div>
        <Btn tone="solid" className="w-full" onClick={() => { setSheet(null); void variant(curItem, varLevel, varCount); }}>画</Btn>
      </Sheet>}

      {sheet === 'enhance' && curItem && <Sheet title="增强" onClose={() => setSheet(null)}>
        <div className="text-[11px] mb-2" style={{ color: C.muted }}>先放大，再用原来的提示词轻轻重画一遍补细节（28 步）。</div>
        <div className="flex gap-1.5 mb-3">{[1, 1.5, 2].map(t => <button key={t} onClick={() => setEnhTimes(t)} className="flex-1 py-2 rounded-xl text-[12px]" style={enhTimes === t ? { background: C.ink, color: '#fff' } : { background: '#f1eee8' }}>{t} 倍</button>)}</div>
        <Slider label="幅度" value={enhLevel} min={1} max={5} step={1} onChange={setEnhLevel} />
        <Btn tone="solid" className="w-full mt-3" onClick={() => { setSheet(null); void enhance(curItem, enhTimes, enhLevel); }}>增强</Btn>
      </Sheet>}

      {sheet === 'director' && curItem && <Sheet title="导演工具" onClose={() => setSheet(null)}>
        <div className="grid grid-cols-4 gap-1.5 mb-3">{Object.entries(DIRECTOR_TOOLS).map(([k, l]) => <button key={k} onClick={() => setDirTool(k)} className="py-2 rounded-xl text-[11px]" style={dirTool === k ? { background: C.ink, color: '#fff' } : { background: '#f1eee8' }}>{l}</button>)}</div>
        {dirTool === 'emotion' && <div className="flex flex-wrap gap-1 mb-2">{EMOTIONS.map(([k, l]) => <button key={k} onClick={() => setDirMood(k)} className="text-[10.5px] px-2 py-0.5 rounded-full" style={dirMood === k ? { background: C.accent, color: '#fff' } : { background: '#f1eee8', color: C.muted }}>{l}</button>)}</div>}
        {(dirTool === 'emotion' || dirTool === 'colorize') && <>
          <input value={dirWords} onChange={e => setDirWords(e.target.value)} placeholder={dirTool === 'colorize' ? '想要的颜色（英文，可不写）' : '补充（英文，可不写）'} className={inputCls + ' mb-2'} style={inputSty} />
          <Slider label="去瑕疵" value={dirDefry} min={0} max={5} step={1} onChange={setDirDefry} />
        </>}
        <Btn tone="solid" className="w-full mt-3" onClick={() => { setSheet(null); void director(curItem, dirTool, dirMood, dirWords, dirDefry); }}>{DIRECTOR_TOOLS[dirTool]}</Btn>
      </Sheet>}

      {sheet === 'translate' && <Sheet title="看中文" onClose={() => setSheet(null)}>
        <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ color: C.ink }}>{toolText || (busy ? '翻译中…' : '')}</div>
      </Sheet>}
      {(sheet === 'revise' || sheet === 'write') && <Sheet title={sheet === 'revise' ? '按我说的改' : '帮我写'} onClose={() => setSheet(null)}>
        <textarea value={wish} onChange={e => setWish(e.target.value)} rows={3} placeholder={sheet === 'revise' ? '比如：背景换成晚上，他的表情再坏一点' : '用中文说想画什么，越具体越好'} className={inputCls} style={inputSty} />
        <Btn tone="solid" className="w-full mt-3" disabled={!!busy || (sheet === 'write' && !wish.trim())} onClick={() => runTool(sheet)}>{busy || (sheet === 'revise' ? '改' : '写')}</Btn>
      </Sheet>}

      {sheet === 'viewer' && viewer && <div className="absolute inset-0 z-50 flex flex-col" style={{ background: '#121110' }}>
        <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+10px)] pb-2 text-[12px] text-white">
          <button onClick={() => setSheet(null)} className="opacity-70">‹ 返回</button><span className="opacity-70">{viewer.kind} · {viewer.width}×{viewer.height}</span>
          <span className="flex gap-3"><button onClick={() => download(viewer)}>下载</button><button onClick={() => { void removeItem(viewer); setSheet(null); }} style={{ color: '#f0a08a' }}>删除</button></span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center justify-center px-2"><TokenImg value={viewer.token} className="max-w-full max-h-[70vh] object-contain" /></div>
          <div className="px-4 py-3 space-y-2 text-[11px] text-white/80">
            <div className="flex gap-2"><Btn small onClick={() => { setCurrent(viewer.id); setSheet(null); setTab('draw'); }}>在工作台继续</Btn><Btn small tone="ghost" style={{ color: '#ddd', borderColor: '#444' }} onClick={() => { useSettings(viewer); setSheet(null); }}>用它的设置</Btn></div>
            {viewer.prompt && <div><div className="text-white/45 mb-0.5">提示词</div><div className="font-mono text-[10.5px] leading-snug break-words">{viewer.prompt}</div></div>}
            {viewer.characters?.map((c, i) => <div key={i}><div className="text-white/45 mb-0.5">{c.name || `角色 ${i + 1}`} · {POS_LABEL(c.position ?? -1)}</div><div className="font-mono text-[10.5px] break-words">{c.prompt}</div></div>)}
            {viewer.negative && <div><div className="text-white/45 mb-0.5">负面</div><div className="font-mono text-[10.5px] break-words">{viewer.negative}</div></div>}
            <div className="text-white/45">{[NAI_MODEL_NAMES[viewer.params.model || ''], viewer.params.steps && `${viewer.params.steps} 步`, viewer.params.sampler && NAI_SAMPLER_NAMES[viewer.params.sampler], viewer.seed !== undefined && `种子 ${viewer.seed}`, new Date(viewer.at).toLocaleString()].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
      </div>}
    </div>
  );
};

export default DrawApp;
