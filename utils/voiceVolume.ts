/**
 * 角色语音音量（个人二改）：炼出来的音色偏小时，不用把系统音量拉满。
 * 100%–300%。大于 100% 时：
 *  - blob / data 来源的 <audio>（聊天语音条、电话、页脚电台、哄睡、约会……都是合成后的 blob）第一次播放时接进一条
 *    WebAudio 增益 + 限幅链（限幅器防爆音）；音乐播放器的元素标了 data-sully-music，不碰
 *  - 流式 PCM（电话流式语音）直接在样本上乘倍数并软限幅
 * iOS 上 WebAudio 被系统挂起会把声音一起掐掉，所以 iOS 不接管（保持原生输出）。
 */
const LS = 'sully_voice_gain_v1';
export const VOICE_GAIN_EVENT = 'sully:voice-gain-changed';

export const getVoiceGain = (): number => {
  try { const v = Number(localStorage.getItem(LS)); return Number.isFinite(v) && v >= 1 && v <= 3 ? v : 1; } catch { return 1; }
};
export const setVoiceGain = (v: number) => {
  const g = Math.min(3, Math.max(1, Math.round(v * 10) / 10));
  try { localStorage.setItem(LS, String(g)); } catch { /* ignore */ }
  if (gainNode) gainNode.gain.value = g;
  try { window.dispatchEvent(new CustomEvent(VOICE_GAIN_EVENT)); } catch { /* ignore */ }
};

/** 流式 PCM：样本乘倍数 + 软限幅（tanh 在接近满幅时压一压，不硬切） */
export const boostSample = (v: number, g: number): number => {
  if (g <= 1) return v;
  const x = v * g;
  return Math.abs(x) < 0.7 ? x : Math.sign(x) * (0.7 + 0.3 * Math.tanh((Math.abs(x) - 0.7) / 0.3));
};

let ctx: AudioContext | null = null;
let gainNode: GainNode | null = null;
const routed = new WeakSet<HTMLMediaElement>();
const failed = new WeakSet<HTMLMediaElement>();

const isIOS = () => typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const ensureChain = (): AudioContext | null => {
  if (ctx && ctx.state !== 'closed') return ctx;
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor() as AudioContext;
    gainNode = ctx.createGain(); gainNode.gain.value = getVoiceGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 4; limiter.ratio.value = 12;
    limiter.attack.value = 0.003; limiter.release.value = 0.15;
    gainNode.connect(limiter); limiter.connect(ctx.destination);
    return ctx;
  } catch { ctx = null; gainNode = null; return null; }
};

/** 只接管同源 / blob / data 的音频：跨域没 CORS 的接进 WebAudio 会变成静音 */
const safeSrc = (el: HTMLMediaElement): boolean => {
  const src = el.currentSrc || el.src || '';
  if (!src) return false;
  // 角色语音都是合成后转成 blob / data 播放；同源的静态音效、BGM 不放大
  return src.startsWith('blob:') || src.startsWith('data:');
};

const tryRoute = (el: HTMLMediaElement) => {
  if (routed.has(el) || failed.has(el)) return;
  if (getVoiceGain() <= 1 || isIOS()) return;
  if ((el as HTMLElement).dataset?.sullyMusic) return;
  if (!(el instanceof HTMLAudioElement)) return;
  if (!safeSrc(el)) return;
  const c = ensureChain();
  if (!c || !gainNode) return;
  // 还没解锁（没有过点击）时接进去会没声音：这次先原生放，顺手解锁，下次再接
  if (c.state !== 'running') { void c.resume().catch(() => {}); return; }
  try {
    const src = c.createMediaElementSource(el);
    src.connect(gainNode);
    routed.add(el);
  } catch { failed.add(el); }
};

let installed = false;
export function installVoiceVolume(): void {
  if (installed || typeof window === 'undefined' || typeof HTMLMediaElement === 'undefined') return;
  installed = true;
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement, ...args: any[]) {
    try { tryRoute(this); } catch { /* 出错就原生放 */ }
    return orig.apply(this, args as any);
  };
  // 第一次点屏幕时把音频链解锁，后面自动播放的语音也能接上
  const unlock = () => {
    if (getVoiceGain() > 1 && !isIOS()) { const c = ensureChain(); if (c && c.state !== 'running') void c.resume().catch(() => {}); }
  };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
}
