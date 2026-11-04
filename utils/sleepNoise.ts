/**
 * 哄睡用的白噪音（WebAudio 现场生成，不用下载文件）：雨声 / 粉噪 / 褐噪 / 白噪。
 */
export type NoiseKind = 'rain' | 'pink' | 'brown' | 'white';
export const NOISE_NAMES: Record<NoiseKind, string> = { rain: '雨声', pink: '柔和沙沙', brown: '低沉海浪', white: '白噪音' };

export interface NoisePlayer { setVolume: (v: number) => void; stop: (fadeMs?: number) => Promise<void>; }

export function startNoise(kind: NoiseKind, volume: number): NoisePlayer {
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new Ctx();
  const len = ctx.sampleRate * 6;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.25;
      else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3; }
      else {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.09; b6 = w * 0.115926;
      }
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  let node: AudioNode = src;
  if (kind === 'rain') {
    // 雨：粉噪去掉低频，再用很慢的起伏模拟雨势
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
    src.connect(hp); hp.connect(lp); node = lp;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.15;
    const wet = ctx.createGain(); wet.gain.value = 0.85;
    lfo.connect(lfoGain); lfoGain.connect(wet.gain); lfo.start();
    node.connect(wet); node = wet;
  } else if (kind === 'brown') {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    src.connect(lp); node = lp;
  }
  node.connect(gain); gain.connect(ctx.destination);
  src.start();
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 3);
  return {
    setVolume: (v: number) => { gain.gain.cancelScheduledValues(ctx.currentTime); gain.gain.linearRampToValueAtTime(v, ctx.currentTime + 0.4); },
    stop: async (fadeMs = 0) => {
      if (fadeMs) { gain.gain.cancelScheduledValues(ctx.currentTime); gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeMs / 1000); await new Promise(r => setTimeout(r, fadeMs)); }
      try { src.stop(); } catch { /* ignore */ }
      void ctx.close();
    },
  };
}
