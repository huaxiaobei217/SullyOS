/**
 * 哄睡用的白噪音（WebAudio 现场生成，不用下载文件）。
 * 不只是一段循环：雨会有雨滴、雷雨隔一阵打个远雷、海浪一涨一落、壁炉噼啪、风一阵阵，
 * 「轮换」每隔几分钟慢慢换成另一种。
 */
export type NoiseKind = 'rain' | 'storm' | 'waves' | 'fire' | 'wind' | 'stream' | 'night' | 'pink' | 'brown' | 'white' | 'shuffle';
export const NOISE_NAMES: Record<NoiseKind, string> = {
  rain: '雨声', storm: '雷雨', waves: '海浪', fire: '壁炉', wind: '风', stream: '溪流', night: '夏夜虫鸣',
  pink: '柔和沙沙', brown: '低沉轰鸣', white: '白噪音', shuffle: '轮换',
};
export const NOISE_KINDS: NoiseKind[] = ['shuffle', 'rain', 'storm', 'waves', 'fire', 'wind', 'stream', 'night', 'pink', 'brown', 'white'];
const SHUFFLE_POOL: NoiseKind[] = ['rain', 'storm', 'waves', 'fire', 'wind', 'stream', 'night'];

export interface NoisePlayer { setVolume: (v: number) => void; stop: (fadeMs?: number) => Promise<void>; }

type Color = 'white' | 'pink' | 'brown';
function noiseBuffer(ctx: AudioContext, color: Color, seconds = 8): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'white') d[i] = w * 0.25;
      else if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3; }
      else {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.09; b6 = w * 0.115926;
      }
    }
    // 首尾交叉淡化，循环接缝听不出来
    const fade = Math.floor(ctx.sampleRate * 0.25);
    for (let i = 0; i < fade; i++) { const t = i / fade; d[i] = d[i] * t + d[len - fade + i] * (1 - t); }
  }
  return buf;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** 一种声音挂到 out 上，返回停止函数 */
/** 各种声音在音量 100% 时实测的响度（dBFS RMS，OfflineAudioContext 渲染），统一拉到 TARGET_DB，换种类不会忽大忽小 */
const MEASURED_DB: Record<Exclude<NoiseKind, 'shuffle'>, number> = { rain: -19.7, storm: -18.2, waves: -23.8, fire: -20.5, wind: -23.2, stream: -28.8, night: -29.6, pink: -15.9, brown: -15.3, white: -16.8 };
const TARGET_DB = -16;

function buildLayer(ctx: AudioContext, kind: Exclude<NoiseKind, 'shuffle'>, dest: AudioNode): () => void {
  const out = ctx.createGain();
  out.gain.value = Math.pow(10, (TARGET_DB - MEASURED_DB[kind]) / 20);
  out.connect(dest);
  const stops: (() => void)[] = [() => { try { out.disconnect(); } catch { /* ignore */ } }];
  const timers: number[] = [];
  const loop = (color: Color, secs = 8) => {
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer(ctx, color, secs); s.loop = true;
    s.start(); stops.push(() => { try { s.stop(); } catch { /* ignore */ } });
    return s;
  };
  const filt = (type: BiquadFilterType, f: number, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const lfo = (target: AudioParam, hz: number, depth: number) => {
    const o = ctx.createOscillator(); o.frequency.value = hz;
    const g = ctx.createGain(); g.gain.value = depth;
    o.connect(g); g.connect(target); o.start(); stops.push(() => { try { o.stop(); } catch { /* ignore */ } });
  };
  const gainNode = (v: number) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  /** 随机间隔触发一次短促的声音事件 */
  const every = (minMs: number, maxMs: number, fire: () => void) => {
    const tick = () => { fire(); timers.push(window.setTimeout(tick, rand(minMs, maxMs))); };
    timers.push(window.setTimeout(tick, rand(minMs, maxMs)));
  };
  /** 一小段滤过的噪声冲击（雨滴 / 噼啪 / 远雷都是它） */
  const burst = (color: Color, type: BiquadFilterType, f: number, q: number, peak: number, attack: number, decay: number, pan = 0) => {
    const s = ctx.createBufferSource(); s.buffer = burstBuf[color];
    const b = filt(type, f, q); const g = gainNode(0);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    s.connect(b); b.connect(g);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(out); } else g.connect(out);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    s.start(t, rand(0, 1)); s.stop(t + attack + decay + 0.05);
  };
  const burstBuf: Record<Color, AudioBuffer> = { white: noiseBuffer(ctx, 'white', 2), pink: noiseBuffer(ctx, 'pink', 2), brown: noiseBuffer(ctx, 'brown', 4) };

  const rainBed = (level: number) => {
    const s = loop('pink'); const hp = filt('highpass', 500); const lp = filt('lowpass', 7500); const g = gainNode(level);
    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out);
    lfo(g.gain, 0.05, level * 0.18);
    // 屋檐上大一点的雨滴
    every(60, 260, () => burst('white', 'bandpass', rand(1800, 5200), 3, rand(0.04, 0.12), 0.002, rand(0.03, 0.08), rand(-0.8, 0.8)));
  };

  switch (kind) {
    case 'rain': rainBed(0.85); break;
    case 'storm': {
      rainBed(0.95);
      const low = loop('brown'); const lp = filt('lowpass', 400); const g = gainNode(0.25); low.connect(lp); lp.connect(g); g.connect(out);
      // 远雷：隔 20~60 秒一声，慢慢滚过去
      every(20000, 60000, () => burst('brown', 'lowpass', rand(90, 180), 0.5, rand(0.9, 1.6), rand(0.3, 0.9), rand(3, 6), rand(-0.6, 0.6)));
      break;
    }
    case 'waves': {
      const s = loop('brown', 10); const lp = filt('lowpass', 1100); const g = gainNode(0.4);
      s.connect(lp); lp.connect(g); g.connect(out);
      lfo(g.gain, 0.09, 0.38); lfo(lp.frequency, 0.09, 450);
      const foam = loop('pink'); const hp = filt('highpass', 2500); const fg = gainNode(0.05);
      foam.connect(hp); hp.connect(fg); fg.connect(out); lfo(fg.gain, 0.09, 0.05);
      break;
    }
    case 'fire': {
      const s = loop('brown'); const lp = filt('lowpass', 600); const g = gainNode(0.55);
      s.connect(lp); lp.connect(g); g.connect(out); lfo(g.gain, 0.3, 0.12);
      every(80, 700, () => burst('white', 'highpass', rand(1500, 4000), 1, rand(0.08, 0.35), 0.001, rand(0.01, 0.05), rand(-0.5, 0.5)));
      every(2500, 9000, () => burst('white', 'bandpass', rand(600, 1200), 2, rand(0.3, 0.6), 0.002, 0.12, rand(-0.4, 0.4)));
      break;
    }
    case 'wind': {
      const s = loop('pink', 10); const bp = filt('bandpass', 500, 1.2); const g = gainNode(0.9);
      s.connect(bp); bp.connect(g); g.connect(out);
      lfo(bp.frequency, 0.045, 320); lfo(g.gain, 0.03, 0.45);
      const s2 = loop('pink', 9); const bp2 = filt('bandpass', 1400, 4); const g2 = gainNode(0.15);
      s2.connect(bp2); bp2.connect(g2); g2.connect(out); lfo(bp2.frequency, 0.07, 500);
      break;
    }
    case 'stream': {
      const s = loop('white'); const bp = filt('bandpass', 1800, 0.6); const lp = filt('lowpass', 5000); const g = gainNode(0.6);
      s.connect(bp); bp.connect(lp); lp.connect(g); g.connect(out); lfo(bp.frequency, 0.4, 500);
      every(120, 500, () => burst('white', 'bandpass', rand(700, 2500), 8, rand(0.05, 0.15), 0.01, rand(0.05, 0.15), rand(-0.7, 0.7)));
      break;
    }
    case 'night': {
      const s = loop('brown'); const lp = filt('lowpass', 700); const g = gainNode(0.2); s.connect(lp); lp.connect(g); g.connect(out);
      // 蟋蟀：一串很快的高频「唧唧」
      every(1200, 4000, () => {
        const f = rand(4200, 5200), pan = rand(-0.9, 0.9), n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const o = ctx.createOscillator(); o.frequency.value = f;
          const og = gainNode(0); const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
          o.connect(og); if (p) { p.pan.value = pan; og.connect(p); p.connect(out); } else og.connect(out);
          const t = ctx.currentTime + i * 0.09;
          og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.05, t + 0.01); og.gain.linearRampToValueAtTime(0, t + 0.06);
          o.start(t); o.stop(t + 0.08);
        }
      });
      break;
    }
    case 'pink': { const s = loop('pink'); s.connect(out); break; }
    case 'brown': { const s = loop('brown'); const lp = filt('lowpass', 900); s.connect(lp); lp.connect(out); break; }
    case 'white': { const s = loop('white'); s.connect(out); break; }
  }
  return () => { timers.forEach(t => clearTimeout(t)); stops.forEach(f => f()); };
}

export function startNoise(kind: NoiseKind, volume: number): NoisePlayer {
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new Ctx();
  // 不是在点击里创建的（要先等电台生成完）时 AudioContext 会一直挂起没声音：主动 resume，点屏幕再补一次
  const resume = () => { if (ctx.state === 'suspended') void ctx.resume().catch(() => {}); };
  resume();
  window.addEventListener('pointerdown', resume, { capture: true, passive: true });
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  // 限幅：拉高了也不破音（雷声、噼啪这种冲击不会炸）
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 10; limiter.attack.value = 0.005; limiter.release.value = 0.25;
  master.connect(limiter); limiter.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 3);

  let stopLayer: () => void = () => {};
  let shuffleTimer = 0;
  if (kind !== 'shuffle') {
    stopLayer = buildLayer(ctx, kind, master);
  } else {
    // 轮换：每 6~10 分钟交叉淡化成另一种（不会连着两次同一种）
    let current: Exclude<NoiseKind, 'shuffle'> = SHUFFLE_POOL[Math.floor(Math.random() * SHUFFLE_POOL.length)] as any;
    let layerGain = ctx.createGain(); layerGain.connect(master);
    let layerStop = buildLayer(ctx, current, layerGain);
    const next = () => {
      const pool = SHUFFLE_POOL.filter(k => k !== current);
      current = pool[Math.floor(Math.random() * pool.length)] as any;
      const oldGain = layerGain, oldStop = layerStop, t = ctx.currentTime;
      oldGain.gain.setValueAtTime(oldGain.gain.value, t); oldGain.gain.linearRampToValueAtTime(0, t + 12);
      layerGain = ctx.createGain(); layerGain.gain.value = 0; layerGain.connect(master);
      layerGain.gain.linearRampToValueAtTime(1, t + 12);
      layerStop = buildLayer(ctx, current, layerGain);
      window.setTimeout(() => { oldStop(); oldGain.disconnect(); }, 12500);
      shuffleTimer = window.setTimeout(next, rand(6, 10) * 60000);
    };
    shuffleTimer = window.setTimeout(next, rand(6, 10) * 60000);
    stopLayer = () => layerStop();
  }

  return {
    setVolume: (v: number) => { resume(); const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(v, t + 0.4); },
    stop: async (fadeMs = 0) => {
      window.removeEventListener('pointerdown', resume, { capture: true } as any);
      if (fadeMs) { const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(0, t + fadeMs / 1000); await new Promise(r => setTimeout(r, fadeMs)); }
      clearTimeout(shuffleTimer);
      try { stopLayer(); } catch { /* ignore */ }
      void ctx.close();
    },
  };
}
