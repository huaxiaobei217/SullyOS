/**
 * 书影架 · 演出模式（一句一屏）
 * 点一下走一拍；点左边四分之一退一拍；上滑看回看；下滑或左上角退出。
 * 背景是按原文布景 / 时段现画的水墨（远景 + 近景，主体压在下面一角，中间留白给字），
 * 雨雪雷、灯火、情绪是叠在上面的效果；声景复用哄睡白噪音的合成器，按场景慢慢换。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ShelfBook, ShelfChapter } from '../../utils/shelf';
import { compileChapter, harvestNames, atmoAtEnd, dwellMs, soundFor, EMPTY_ATMO, type Atmo, type Beat } from '../../utils/shelfStage';
import { startNoise, type NoisePlayer } from '../../utils/sleepNoise';

const PREF_KEY = 'sully_shelf_stage_v1';
interface Prefs { auto: boolean; sound: boolean; typewriter: boolean; volume: number }
const loadPrefs = (): Prefs => { try { return { auto: false, sound: false, typewriter: false, volume: 0.35, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return { auto: false, sound: false, typewriter: false, volume: 0.35 }; } };
const savePrefs = (p: Prefs) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* ignore */ } };

const SERIF = '"Noto Serif SC","Source Han Serif SC","Songti SC",STSong,serif';
const BRUSH = '"Zhi Mang Xing","Ma Shan Zheng","Long Cang","STXingkai","Noto Serif SC",serif';
const CINNABAR = '#b23a2a';
/** 行书字体（章名、拟声、海报用）：第一次进演出模式时从 Google Fonts 拿，拿不到就退回宋体 */
const ensureBrushFont = () => {
  if (document.getElementById('sully-stage-fonts')) return;
  const l = document.createElement('link');
  l.id = 'sully-stage-fonts'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Zhi+Mang+Xing&family=Ma+Shan+Zheng&display=swap';
  document.head.appendChild(l);
};

/* ───────── 水墨布景 ───────── */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashStr = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

function paintScenery(cv: HTMLCanvasElement, atmo: Atmo, seed: number, dark: boolean) {
  const w = cv.width, h = cv.height;
  const g = cv.getContext('2d'); if (!g) return;
  const r = rng(seed);
  // 纸
  const bg = g.createLinearGradient(0, 0, 0, h);
  if (dark) { bg.addColorStop(0, '#171a21'); bg.addColorStop(1, '#22262e'); }
  else if (atmo.time === 'dusk') { bg.addColorStop(0, '#f3e4cf'); bg.addColorStop(1, '#ead6bd'); }
  else if (atmo.time === 'dawn') { bg.addColorStop(0, '#eef0ec'); bg.addColorStop(1, '#f2ede2'); }
  else { bg.addColorStop(0, '#f4efe3'); bg.addColorStop(1, '#ebe3d2'); }
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  // 纸纹
  for (let i = 0; i < 260; i++) { g.fillStyle = dark ? `rgba(255,255,255,${r() * 0.025})` : `rgba(90,70,40,${r() * 0.03})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
  const ink = (a: number) => dark ? `rgba(196,206,224,${a})` : `rgba(28,28,34,${a})`;
  const wash = (yTop: number, yBot: number, a: number) => { const gr = g.createLinearGradient(0, yTop, 0, yBot); gr.addColorStop(0, ink(a)); gr.addColorStop(1, ink(0)); return gr; };
  const ridge = (base: number, amp: number, a: number, freq = 1) => {
    const ph = [r() * 6, r() * 6, r() * 6];
    g.beginPath(); g.moveTo(0, h);
    let minY = h;
    for (let x = 0; x <= w; x += 2) {
      const t = x / w;
      const y = base - amp * (0.55 * Math.sin(t * 3.1 * freq + ph[0]) + 0.3 * Math.sin(t * 7.3 * freq + ph[1]) + 0.15 * Math.sin(t * 17 * freq + ph[2])) - amp * 0.4 * Math.exp(-Math.pow((t - 0.25 - r() * 0.002) * 3, 2));
      minY = Math.min(minY, y); g.lineTo(x, y);
    }
    g.lineTo(w, h); g.closePath(); g.fillStyle = wash(minY, minY + amp * 2.4, a); g.fill();
  };
  const side = r() < 0.5 ? -1 : 1; // 主体压在左下还是右下
  const cx = side < 0 ? w * 0.18 : w * 0.82;
  const stroke = (x1: number, y1: number, x2: number, y2: number, wd: number, a: number) => { g.strokeStyle = ink(a); g.lineWidth = wd; g.lineCap = 'round'; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };

  const scene = atmo.scene;
  if (scene === 'sea' || scene === 'river') {
    ridge(h * 0.68, h * 0.05, 0.16, 0.8);
    for (let i = 0; i < (scene === 'sea' ? 26 : 16); i++) {
      const y = h * (0.76 + r() * 0.22), x = r() * w, len = w * (0.08 + r() * 0.2);
      g.strokeStyle = ink(0.12 + r() * 0.16); g.lineWidth = 1 + r() * 1.5; g.beginPath(); g.moveTo(x, y);
      g.quadraticCurveTo(x + len / 2, y - 3 - r() * 4, x + len, y); g.stroke();
    }
    if (scene === 'river') { g.fillStyle = ink(0.5); g.beginPath(); g.ellipse(cx, h * 0.83, w * 0.06, h * 0.008, 0, 0, Math.PI * 2); g.fill(); stroke(cx, h * 0.83, cx + side * -w * 0.02, h * 0.77, 1.2, 0.5); }
  } else if (scene === 'forest' || scene === 'bamboo') {
    ridge(h * 0.72, h * 0.05, 0.12);
    for (let i = 0; i < (scene === 'bamboo' ? 7 : 6); i++) {
      const x = cx + side * (i - 2) * w * 0.045 + (r() - 0.5) * w * 0.03, top = h * (0.45 + r() * 0.15);
      if (scene === 'bamboo') {
        for (let y = h; y > top; y -= h * 0.06) stroke(x, y, x + (r() - 0.5) * 2, y - h * 0.055, 3 + r() * 2, 0.45 + r() * 0.2);
        for (let k = 0; k < 6; k++) { const ly = top + r() * h * 0.2, lx = x + (r() - 0.5) * 6; stroke(lx, ly, lx + side * -1 * (10 + r() * 16), ly + 4 + r() * 8, 3, 0.4); }
      } else {
        stroke(x, h, x + (r() - 0.5) * 8, top, 2.5 + r() * 2.5, 0.5);
        for (let k = 0; k < 40; k++) { g.fillStyle = ink(0.06 + r() * 0.12); g.beginPath(); g.arc(x + (r() - 0.5) * w * 0.12, top + (r() - 0.3) * h * 0.12, 3 + r() * 7, 0, Math.PI * 2); g.fill(); }
      }
    }
  } else if (scene === 'city') {
    ridge(h * 0.62, h * 0.03, 0.08);
    let x = 0;
    while (x < w) {
      const bw = w * (0.05 + r() * 0.09), bh = h * (0.12 + r() * 0.26);
      g.fillStyle = ink(0.1 + r() * 0.14); g.fillRect(x, h - bh, bw - 2, bh);
      if (dark) for (let k = 0; k < 8; k++) if (r() < 0.5) { g.fillStyle = `rgba(255,214,140,${0.25 + r() * 0.4})`; g.fillRect(x + 3 + r() * (bw - 10), h - bh + 4 + r() * (bh - 10), 2, 2); }
      x += bw;
    }
  } else if (scene === 'indoor') {
    // 一扇窗：窗棂 + 半边帘子
    const wx = side < 0 ? w * 0.08 : w * 0.6, wy = h * 0.58, ww = w * 0.32, wh = h * 0.3;
    g.strokeStyle = ink(0.35); g.lineWidth = 2.5; g.strokeRect(wx, wy, ww, wh);
    stroke(wx + ww / 2, wy, wx + ww / 2, wy + wh, 1.6, 0.3); stroke(wx, wy + wh / 2, wx + ww, wy + wh / 2, 1.6, 0.3);
    if (dark) { g.fillStyle = 'rgba(210,220,255,0.06)'; g.fillRect(wx, wy, ww, wh); g.fillStyle = 'rgba(235,235,215,0.5)'; g.beginPath(); g.arc(wx + ww * 0.72, wy + wh * 0.28, 7, 0, Math.PI * 2); g.fill(); }
    for (let k = 0; k < 6; k++) stroke(wx + (side < 0 ? ww : 0) + side * k * 4, wy - 6, wx + (side < 0 ? ww : 0) + side * k * 5, wy + wh + 10, 1, 0.12);
    stroke(0, h * 0.94, w, h * 0.94, 2, 0.18);
  } else if (scene === 'garden') {
    ridge(h * 0.7, h * 0.06, 0.12);
    // 亭子屋檐
    g.strokeStyle = ink(0.55); g.lineWidth = 3; g.beginPath();
    g.moveTo(cx - w * 0.14, h * 0.74); g.quadraticCurveTo(cx, h * 0.66, cx + w * 0.14, h * 0.74); g.stroke();
    stroke(cx - w * 0.1, h * 0.735, cx - w * 0.1, h * 0.9, 2.5, 0.5); stroke(cx + w * 0.1, h * 0.735, cx + w * 0.1, h * 0.9, 2.5, 0.5);
    g.fillStyle = ink(0.3); g.beginPath(); g.ellipse(cx - side * w * 0.22, h * 0.92, w * 0.07, h * 0.03, 0, 0, Math.PI * 2); g.fill();
  } else if (scene === 'desert') {
    for (let i = 0; i < 3; i++) ridge(h * (0.7 + i * 0.08), h * 0.04, 0.08 + i * 0.05, 0.6);
  } else if (scene === 'village') {
    ridge(h * 0.68, h * 0.06, 0.13);
    for (let i = 0; i < 3; i++) { const x = cx + side * i * w * 0.08, y = h * 0.86; g.fillStyle = ink(0.3); g.beginPath(); g.moveTo(x - 22, y); g.lineTo(x, y - 14); g.lineTo(x + 22, y); g.fill(); g.fillRect(x - 16, y, 32, 14); }
    for (let i = 0; i < 12; i++) stroke(0, h * (0.93 + i * 0.006), w, h * (0.93 + i * 0.006), 0.6, 0.06);
  } else if (scene === 'campus') {
    ridge(h * 0.72, h * 0.03, 0.08);
    g.fillStyle = ink(0.22); g.fillRect(cx - w * 0.2, h * 0.7, w * 0.4, h * 0.3);
    for (let k = 0; k < 10; k++) { g.fillStyle = dark ? 'rgba(255,214,140,0.35)' : ink(0.12); g.fillRect(cx - w * 0.18 + (k % 5) * w * 0.075, h * 0.73 + Math.floor(k / 5) * h * 0.06, w * 0.04, h * 0.03); }
  } else if (scene === 'mountain') {
    ridge(h * 0.58, h * 0.12, 0.16, 0.9);
    ridge(h * 0.72, h * 0.1, 0.32, 1.3);
    // 一棵松
    const tx = cx, ty = h * 0.78;
    stroke(tx, ty + 30, tx - side * 6, ty - 20, 3, 0.65);
    for (let k = 0; k < 4; k++) stroke(tx - side * 6, ty - 16 + k * 9, tx - side * 6 + side * -(14 + k * 4), ty - 18 + k * 9, 3.5, 0.5);
  } else {
    // 没认出布景：只留远山淡影
    ridge(h * 0.74, h * 0.06, 0.07, 0.8);
  }
  if (atmo.time === 'night' && scene !== 'indoor') { g.fillStyle = 'rgba(236,236,214,0.75)'; g.beginPath(); g.arc(w * (side < 0 ? 0.78 : 0.22), h * 0.16, Math.min(w, h) * 0.035, 0, Math.PI * 2); g.fill(); }
  if (atmo.time === 'dusk') { const sg = g.createRadialGradient(w * 0.5, h * 0.62, 2, w * 0.5, h * 0.62, w * 0.6); sg.addColorStop(0, 'rgba(214,120,70,0.18)'); sg.addColorStop(1, 'rgba(214,120,70,0)'); g.fillStyle = sg; g.fillRect(0, 0, w, h); }
}

const Scenery: React.FC<{ atmo: Atmo; seed: number; dark: boolean }> = ({ atmo, seed, dark }) => {
  const key = `${atmo.scene}|${atmo.time}|${dark}`;
  const [layers, setLayers] = useState<{ key: string; url: string }[]>([]);
  useEffect(() => {
    const cv = document.createElement('canvas');
    const W = Math.round((window.innerWidth || 390) / 3), H = Math.round((window.innerHeight || 800) / 3);
    cv.width = W; cv.height = H;
    paintScenery(cv, atmo, seed ^ hashStr(key), dark);
    const url = cv.toDataURL('image/png');
    setLayers(prev => [...prev.filter(l => l.key !== key).slice(-1), { key, url }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, seed]);
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {layers.map((l, i) => (
        <div key={l.key} className={`absolute -inset-[4%] ${i === layers.length - 1 && layers.length > 1 ? 'stage-fade' : ''}`}>
          <div className="absolute inset-0 stage-drift" style={{ backgroundImage: `url(${l.url})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(0.4px)' }} />
        </div>
      ))}
    </div>
  );
};

/* 雨 / 雪 / 雷：叠一层小画布 */
const WeatherFx: React.FC<{ weather: Atmo['weather']; dark: boolean }> = ({ weather, dark }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const cv = ref.current; if (!cv || !weather || weather === 'fog' || weather === 'wind') return;
    const g = cv.getContext('2d')!; let raf = 0;
    const W = cv.width = cv.clientWidth, H = cv.height = cv.clientHeight;
    const n = weather === 'storm' ? 140 : weather === 'rain' ? 80 : 70;
    const ps = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, v: weather === 'snow' ? 0.4 + Math.random() * 0.8 : 9 + Math.random() * 7, s: Math.random() }));
    const col = dark ? 'rgba(200,210,230,' : 'rgba(60,64,80,';
    const tick = () => {
      g.clearRect(0, 0, W, H);
      for (const p of ps) {
        if (weather === 'snow') { p.y += p.v; p.x += Math.sin((p.y + p.s * 100) / 40) * 0.4; g.fillStyle = col + (0.35 + p.s * 0.4) + ')'; g.beginPath(); g.arc(p.x, p.y, 1 + p.s * 1.6, 0, Math.PI * 2); g.fill(); }
        else { p.y += p.v; p.x -= p.v * 0.18; g.strokeStyle = col + (0.12 + p.s * 0.2) + ')'; g.lineWidth = 1; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + p.v * 0.18, p.y - p.v * 1.6); g.stroke(); }
        if (p.y > H + 10) { p.y = -10; p.x = Math.random() * (W + 60); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [weather, dark]);
  useEffect(() => {
    if (weather !== 'storm') return;
    let t: ReturnType<typeof setTimeout>;
    const next = () => { t = setTimeout(() => { setFlash(true); setTimeout(() => setFlash(false), 120); setTimeout(() => { setFlash(true); setTimeout(() => setFlash(false), 90); }, 220); next(); }, 7000 + Math.random() * 9000); };
    next();
    return () => clearTimeout(t);
  }, [weather]);
  return (
    <>
      <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" />
      {weather === 'fog' && <div className="absolute inset-0 pointer-events-none" style={{ background: dark ? 'linear-gradient(to top, rgba(160,170,190,0.25), transparent 70%)' : 'linear-gradient(to top, rgba(255,255,255,0.65), transparent 75%)' }} />}
      {flash && <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(235,240,255,0.55)' }} />}
    </>
  );
};

const LightFx: React.FC<{ light: Atmo['light']; mood: Atmo['mood']; dark: boolean }> = ({ light, mood, dark }) => (
  <>
    {light && (
      <div className={`absolute inset-0 pointer-events-none ${light === 'candle' || light === 'fire' ? 'stage-flicker' : ''}`} style={{
        background: light === 'neon'
          ? 'radial-gradient(circle at 80% 85%, rgba(255,80,170,0.18), transparent 45%), radial-gradient(circle at 15% 80%, rgba(60,200,255,0.14), transparent 45%)'
          : `radial-gradient(circle at 50% 92%, rgba(255,${light === 'lamp' ? 210 : 160},${light === 'lamp' ? 140 : 80},${dark ? 0.28 : 0.18}), transparent 60%)`,
      }} />
    )}
    {mood === 'tense' && <div className="absolute inset-0 pointer-events-none stage-vignette" style={{ boxShadow: `inset 0 0 120px 40px ${dark ? 'rgba(0,0,0,0.7)' : 'rgba(20,16,12,0.35)'}` }} />}
    {mood === 'sad' && <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(90,110,150,0.10)' }} />}
    {mood === 'warm' && <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(230,170,110,0.08)' }} />}
  </>
);

const CN_NUM = '零一二三四五六七八九十';
const chapterSeal = (title: string, ch: number) => {
  const m = title.match(/第[零〇一二三四五六七八九十百千两0-9]+[章节回卷幕]/);
  if (m) return m[0];
  const n = ch + 1;
  return n <= 10 ? `第${CN_NUM[n]}章` : `第${n}章`;
};

/* ───────── 演出页 ───────── */
const StageMode: React.FC<{
  book: ShelfBook; chapters: ShelfChapter[]; startCh: number; startPara: number;
  onExit: (ch: number, para: number) => void;
  onProgress: (ch: number, para: number) => void;
  onChapterDone: (ch: number) => void;
}> = ({ book, chapters, startCh, startPara, onExit, onProgress, onChapterDone }) => {
  const [prefs, setPrefsState] = useState(loadPrefs);
  const setPrefs = (p: Partial<Prefs>) => setPrefsState(prev => { const n = { ...prev, ...p }; savePrefs(n); return n; });
  const [ch, setCh] = useState(startCh);
  const [carry, setCarry] = useState<Atmo>(() => startCh > 0 && chapters[startCh - 1] ? atmoAtEnd(chapters[startCh - 1].paras) : EMPTY_ATMO);
  const beats = useMemo(() => {
    const c = chapters[ch]; if (!c) return [] as Beat[];
    const seen = chapters.slice(Math.max(0, ch - 20), ch + 1).map(x => x.paras.join('\n'));
    return compileChapter(c.title, c.paras, harvestNames(seen), carry);
  }, [ch, chapters, carry]);
  const [idx, setIdx] = useState(() => {
    if (!startPara) return 0;
    const c = chapters[startCh]; if (!c) return 0;
    const seen = chapters.slice(Math.max(0, startCh - 20), startCh + 1).map(x => x.paras.join('\n'));
    const bs = compileChapter(c.title, c.paras, harvestNames(seen));
    const k = bs.findIndex(b => b.kind !== 'title' && b.para >= startPara);
    return k < 0 ? 0 : k;
  });
  const beat = beats[Math.min(idx, beats.length - 1)];
  const atmo = beat?.atmo || EMPTY_ATMO;
  const dark = atmo.time === 'night';
  const seed = useMemo(() => hashStr(book.id + ':' + ch), [book.id, ch]);
  const [revealed, setRevealed] = useState(Infinity);
  const [showHist, setShowHist] = useState(false);
  const [chrome, setChrome] = useState(true);
  const chromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pokeChrome = () => { setChrome(true); if (chromeTimer.current) clearTimeout(chromeTimer.current); chromeTimer.current = setTimeout(() => setChrome(false), 3500); };
  useEffect(() => { ensureBrushFont(); pokeChrome(); return () => { if (chromeTimer.current) clearTimeout(chromeTimer.current); }; }, []);

  // 逐字
  useEffect(() => {
    if (!beat || !prefs.typewriter || beat.kind === 'title' || beat.kind === 'break' || beat.kind === 'poster') { setRevealed(Infinity); return; }
    setRevealed(0);
    const n = beat.text.length; let k = 0;
    const t = setInterval(() => { k += 1; setRevealed(k); if (k >= n) clearInterval(t); }, beat.fx === 'slow' ? 70 : 34);
    return () => clearInterval(t);
  }, [beat, prefs.typewriter]);
  const revealing = beat && revealed < beat.text.length;

  // 进度
  const lastSave = useRef(0);
  useEffect(() => {
    if (!beat) return;
    if (Date.now() - lastSave.current > 1200 || idx === beats.length - 1) { lastSave.current = Date.now(); onProgress(ch, beat.para); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, ch]);

  const next = () => {
    if (revealing) { setRevealed(Infinity); return; }
    if (idx < beats.length - 1) { setIdx(idx + 1); return; }
    onChapterDone(ch);
    if (ch < chapters.length - 1) { setCarry(beat?.atmo ? { ...beat.atmo, mood: null, moodLeft: 0 } : EMPTY_ATMO); setCh(ch + 1); setIdx(0); }
  };
  const prev = () => {
    if (idx > 0) { setIdx(idx - 1); return; }
    if (ch > 0) {
      const c = chapters[ch - 1];
      const seen = chapters.slice(Math.max(0, ch - 21), ch).map(x => x.paras.join('\n'));
      const bs = compileChapter(c.title, c.paras, harvestNames(seen));
      setCarry(EMPTY_ATMO); setCh(ch - 1); setIdx(Math.max(0, bs.length - 1));
    }
  };
  const nextRef = useRef(next); nextRef.current = next;

  // 自动播放
  useEffect(() => {
    if (!prefs.auto || !beat || showHist) return;
    const extra = prefs.typewriter ? beat.text.length * 34 : 0;
    const t = setTimeout(() => nextRef.current(), dwellMs(beat) + extra);
    return () => clearTimeout(t);
  }, [prefs.auto, prefs.typewriter, beat, showHist, revealed === Infinity]);

  // 声景
  const sound = prefs.sound ? soundFor(atmo) : null;
  const playerRef = useRef<{ kind: string; p: NoisePlayer } | null>(null);
  useEffect(() => {
    const cur = playerRef.current;
    if (cur?.kind === (sound || '')) return;
    if (cur) { void cur.p.stop(2500); playerRef.current = null; }
    if (sound) { try { playerRef.current = { kind: sound, p: startNoise(sound, prefs.volume) }; } catch { /* ignore */ } }
  }, [sound, prefs.volume]);
  useEffect(() => () => { void playerRef.current?.p.stop(600); playerRef.current = null; }, []);

  // 手势
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => { down.current = { x: e.clientX, y: e.clientY, t: Date.now() }; };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current; down.current = null; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx)) { if (dy < 0) setShowHist(true); else exit(); return; }
    if (Math.abs(dx) > 30 || Math.abs(dy) > 30) return;
    pokeChrome();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if ((e.clientX - r.left) / r.width < 0.22) prev(); else next();
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') nextRef.current(); else if (e.key === 'ArrowLeft') prev(); else if (e.key === 'Escape') exit(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  const exit = () => { onExit(ch, beat?.para || 0); };

  const fg = dark ? '#e7e4dc' : '#2a2620';
  const muted = dark ? 'rgba(231,228,220,0.55)' : 'rgba(42,38,32,0.5)';
  const shown = (t: string) => revealing ? t.slice(0, revealed) : t;

  const body = (() => {
    if (!beat) return null;
    const key = `${ch}-${idx}`;
    const anim = beat.fx === 'slow' ? 'stage-in-slow' : 'stage-in';
    switch (beat.kind) {
      case 'title':
        return (
          <div key={key} className="flex flex-col items-center text-center stage-in-slow" style={{ marginTop: '-6vh' }}>
            <div className="stage-seal px-2 py-1.5 mb-6 text-white text-[13px] tracking-[0.2em]" style={{ background: CINNABAR, writingMode: 'vertical-rl', fontFamily: SERIF, borderRadius: 3 }}>{chapterSeal(beat.text, ch)}</div>
            <div className="text-[26px] leading-snug px-8" style={{ fontFamily: BRUSH, color: fg, letterSpacing: '0.18em' }}>{beat.text.replace(/^第[^\s　章节回卷幕]*[章节回卷幕][\s　：:]*/, '') || beat.text}</div>
            <div className="text-[11px] mt-5 tracking-[0.3em]" style={{ color: muted }}>{book.title}</div>
          </div>
        );
      case 'break':
        return (
          <svg key={key} viewBox="0 0 300 40" className="w-[70%]" style={{ overflow: 'visible' }}>
            <path d="M8 22 C 60 14, 120 28, 180 18 S 270 20, 292 16" fill="none" stroke={fg} strokeOpacity={0.55} strokeWidth={5} strokeLinecap="round" className="stage-brush" />
          </svg>
        );
      case 'sfx':
        return <div key={key} className="stage-shake text-center" style={{ fontFamily: BRUSH, fontSize: 64, color: fg, letterSpacing: '0.12em', textShadow: dark ? '0 0 18px rgba(255,255,255,0.15)' : '0 2px 0 rgba(0,0,0,0.08)' }}>{beat.text}</div>;
      case 'poster': {
        const halves = beat.text.split(/[，,]/);
        return (
          <div key={key} className="flex gap-6 justify-center stage-in-slow" style={{ writingMode: 'vertical-rl', fontFamily: BRUSH, fontSize: 46, color: CINNABAR, letterSpacing: '0.25em' }}>
            {halves.map((hf, k) => <div key={k} style={{ marginTop: k ? '2.2em' : 0 }}>{hf}</div>)}
          </div>
        );
      }
      case 'system':
        return (
          <div key={key} className={`${anim} mx-6 px-4 py-3 rounded-md text-[15px] leading-relaxed`} style={{ fontFamily: 'ui-monospace,Menlo,monospace', color: dark ? '#cfe7ff' : '#1d3b56', background: dark ? 'rgba(30,60,90,0.45)' : 'rgba(220,235,250,0.75)', border: `1px solid ${dark ? 'rgba(140,190,240,0.5)' : 'rgba(40,90,140,0.35)'}` }}>
            <div className="text-[10px] tracking-[0.3em] mb-1 opacity-70">— 提示 —</div>{shown(beat.text)}
          </div>
        );
      case 'chat': {
        const lines = beat.chat || [];
        const order: string[] = [];
        for (const l of lines) if (!order.includes(l.who)) order.push(l.who);
        return (
          <div key={`chat-${ch}`} className="mx-5 rounded-3xl px-3 py-3 space-y-2 max-h-[60vh] overflow-hidden flex flex-col justify-end" style={{ background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.55)', border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'}`, fontFamily: '-apple-system,"PingFang SC",sans-serif' }}>
            {lines.slice(-8).map((l, k, arr) => {
              const right = order.indexOf(l.who) === 1;
              const last = k === arr.length - 1;
              return (
                <div key={k} className={`flex flex-col ${right ? 'items-end' : 'items-start'} ${last ? 'stage-in' : ''}`}>
                  <div className="text-[10px] mb-0.5 px-1" style={{ color: muted }}>{l.who}</div>
                  <div className="px-3 py-1.5 rounded-2xl text-[14px] max-w-[80%]" style={{ background: right ? (dark ? '#3b6b54' : '#95d4a6') : (dark ? 'rgba(255,255,255,0.12)' : '#fff'), color: right && !dark ? '#183424' : fg }}>{last ? shown(l.text) : l.text}</div>
                </div>
              );
            })}
          </div>
        );
      }
      case 'dialogue':
        return (
          <div key={key} className={`${anim} mx-6 relative`}>
            {beat.speaker && <div className="absolute -top-3 left-3 px-2 py-0.5 text-[11.5px] text-white tracking-wider z-10" style={{ background: CINNABAR, fontFamily: SERIF, borderRadius: 2 }}>{beat.speaker}</div>}
            <div className={`px-5 pt-5 pb-4 rounded-sm ${beat.fx === 'shake' ? 'stage-shake' : ''}`} style={{ background: dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,253,246,0.82)', boxShadow: dark ? 'none' : '0 6px 22px -10px rgba(60,40,20,0.35)', border: dark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(120,90,60,0.12)' }}>
              <div style={{ fontFamily: SERIF, fontSize: beat.fx === 'big' ? 25 : 20, lineHeight: 1.75, color: fg, fontWeight: beat.fx === 'big' ? 700 : 500 }}>「{shown(beat.text)}」</div>
              {beat.cue && <div className="mt-2 text-[12px] text-right" style={{ color: muted, fontFamily: SERIF }}>—— {beat.cue}</div>}
            </div>
          </div>
        );
      case 'thought':
        return (
          <div key={key} className={`${anim} mx-10 text-center`} style={{ fontFamily: SERIF, fontSize: 18, lineHeight: 1.9, color: muted, fontStyle: 'italic' }}>
            <span style={{ opacity: 0.6 }}>（</span>{shown(beat.text)}<span style={{ opacity: 0.6 }}>）</span>
          </div>
        );
      default:
        return (
          <div key={key} className={`${anim} mx-8`} style={{ fontFamily: SERIF, fontSize: beat.fx === 'big' ? 22 : 19, lineHeight: 1.95, color: fg, letterSpacing: '0.03em', textAlign: 'justify' }}>
            {shown(beat.text)}
          </div>
        );
    }
  })();

  return (
    <div className="absolute inset-0 z-50 select-none overflow-hidden" style={{ background: dark ? '#171a21' : '#f4efe3', touchAction: 'none' }}
      onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <style>{`
        @keyframes stageIn { from { opacity: 0; transform: translateY(6px); filter: blur(2px); } to { opacity: 1; transform: none; filter: none; } }
        .stage-in { animation: stageIn .45s ease both; }
        .stage-in-slow { animation: stageIn 1.2s ease both; }
        @keyframes stageFade { from { opacity: 0; } to { opacity: 1; } }
        .stage-fade { animation: stageFade 1.8s ease both; }
        @keyframes stageShake { 0%,100% { transform: translate(0,0); } 20% { transform: translate(-3px,1px); } 40% { transform: translate(3px,-1px); } 60% { transform: translate(-2px,0); } 80% { transform: translate(2px,1px); } }
        .stage-shake { animation: stageIn .2s ease both, stageShake .5s ease .05s 1; }
        @keyframes stageDrift { from { transform: translateX(-1.2%) scale(1.02); } to { transform: translateX(1.2%) scale(1.02); } }
        .stage-drift { animation: stageDrift 38s ease-in-out infinite alternate; }
        @keyframes stageFlicker { 0%,100% { opacity: 1; } 40% { opacity: .78; } 55% { opacity: .95; } 70% { opacity: .7; } }
        .stage-flicker { animation: stageFlicker 2.6s ease-in-out infinite; }
        @keyframes stageBrush { from { stroke-dashoffset: 340; } to { stroke-dashoffset: 0; } }
        .stage-brush { stroke-dasharray: 340; animation: stageBrush 1.1s ease forwards; }
        @keyframes stageSeal { from { opacity: 0; transform: scale(1.4) rotate(-6deg); } to { opacity: .92; transform: scale(1) rotate(-2deg); } }
        .stage-seal { animation: stageSeal .7s cubic-bezier(.2,1.4,.4,1) both; }
        @media (prefers-reduced-motion: reduce) { .stage-drift, .stage-flicker, .stage-shake { animation: none !important; } }
      `}</style>
      <Scenery atmo={atmo} seed={seed} dark={dark} />
      <WeatherFx weather={atmo.weather} dark={dark} />
      <LightFx light={atmo.light} mood={atmo.mood} dark={dark} />

      {/* 字：放在上中部，底下留给布景 */}
      <div className="absolute inset-x-0 flex items-center justify-center" style={{ top: 'calc(var(--chrome-top, 0px) + 9vh)', bottom: '34vh' }}>
        <div className="w-full">{body}</div>
      </div>

      {/* 句末小墨点：还能点 */}
      {!revealing && beat && beat.kind !== 'title' && (
        <div className="absolute left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full animate-pulse" style={{ bottom: 'calc(30vh)', background: fg, opacity: 0.35 }} />
      )}

      {/* 顶上：退出 / 章名 / 开关 */}
      <div className="absolute inset-x-0 top-0 px-4 flex items-center gap-3 text-[11.5px] transition-opacity duration-500" style={{ paddingTop: 'calc(var(--chrome-top, 0px) + 0.5rem)', color: muted, opacity: chrome ? 1 : 0.25 }}
        onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>
        <button onClick={exit} className="text-[15px] px-1">‹</button>
        <div className="flex-1 min-w-0 truncate" style={{ fontFamily: SERIF }}>{chapters[ch]?.title}</div>
        <button onClick={() => { setPrefs({ auto: !prefs.auto }); pokeChrome(); }} style={{ color: prefs.auto ? fg : muted }}>{prefs.auto ? '❚❚ 自动' : '▶ 自动'}</button>
        <button onClick={() => { setPrefs({ sound: !prefs.sound }); pokeChrome(); }} style={{ color: prefs.sound ? fg : muted }}>{prefs.sound ? '♪ 声景' : '♪ 静音'}</button>
        <button onClick={() => { setPrefs({ typewriter: !prefs.typewriter }); pokeChrome(); }} style={{ color: prefs.typewriter ? fg : muted }}>逐字</button>
      </div>

      {/* 底部进度 */}
      <div className="absolute inset-x-6 h-[2px] rounded-full overflow-hidden" style={{ bottom: 'calc(var(--safe-bottom, 0px) + 0.8rem)', background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
        <div className="h-full" style={{ width: `${((idx + 1) / Math.max(1, beats.length)) * 100}%`, background: dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)', transition: 'width .3s' }} />
      </div>

      {/* 回看 */}
      {showHist && (
        <div className="absolute inset-0 z-10 flex flex-col" style={{ background: dark ? 'rgba(18,20,26,0.96)' : 'rgba(246,241,231,0.97)' }}
          onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>
          <div className="px-4 pb-2 flex items-center justify-between text-[12px]" style={{ paddingTop: 'calc(var(--chrome-top, 0px) + 0.6rem)', color: muted }}>
            <span>回看 · 点一句跳回去</span><button onClick={() => setShowHist(false)} className="px-2">收起</button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-2.5" ref={el => { if (el) el.scrollTop = el.scrollHeight; }}>
            {beats.slice(Math.max(0, idx - 80), idx + 1).map((b, k, arr) => {
              const at = idx - (arr.length - 1) + k;
              if (b.kind === 'break') return <div key={at} className="text-center text-[11px]" style={{ color: muted }}>— — —</div>;
              return (
                <button key={at} onClick={() => { setIdx(at); setShowHist(false); }} className="block w-full text-left text-[14px] leading-relaxed" style={{ fontFamily: SERIF, color: at === idx ? fg : muted, fontStyle: b.kind === 'thought' ? 'italic' : undefined }}>
                  {b.speaker && <span className="text-[11px] mr-1.5 px-1 text-white" style={{ background: CINNABAR }}>{b.speaker}</span>}
                  {b.kind === 'dialogue' ? `「${b.text}」` : b.kind === 'title' ? `【${b.text}】` : b.text}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default StageMode;
