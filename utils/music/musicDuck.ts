/**
 * 角色说话时音乐渐弱（个人二改）：聊天语音条、电话、电台……任何角色语音一响，正在放的歌在 0.3 秒里降到「让路音量」，
 * 说完停 0.7 秒再用 0.8 秒慢慢回来（句子之间的小停顿不会让音乐一跳一跳）。
 * 只改音乐元素的 volume，不碰语音本身；iOS 的 <audio>.volume 是只读的，那边不生效。
 */
import { VOICE_ACTIVE_EVENT, isVoiceActive } from '../voiceVolume';

const LS = 'sully_music_duck_v1';
/** 说话时音乐剩多少（0.1–1，1 = 不让路） */
export const getDuckLevel = (): number => {
  try { const v = Number(localStorage.getItem(LS)); return Number.isFinite(v) && v >= 0.1 && v <= 1 ? v : 0.25; } catch { return 0.25; }
};
export const setDuckLevel = (v: number) => { try { localStorage.setItem(LS, String(Math.min(1, Math.max(0.1, v)))); } catch { /* ignore */ } };

export function attachMusicDuck(a: HTMLAudioElement): () => void {
  let raf = 0; let restoreTimer = 0;
  const ramp = (to: number, ms: number) => {
    cancelAnimationFrame(raf);
    const from = a.volume, t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = k * k * (3 - 2 * k);
      try { a.volume = Math.max(0, Math.min(1, from + (to - from) * e)); } catch { return; }
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // 页面在后台时 rAF 不跑：直接落到目标值
    if (document.hidden) { cancelAnimationFrame(raf); try { a.volume = to; } catch { /* ignore */ } }
  };
  const onVoice = (e: Event) => {
    const on = !!(e as CustomEvent).detail?.on;
    clearTimeout(restoreTimer);
    if (on) { const lv = getDuckLevel(); if (lv < 1) ramp(lv, 300); }
    else restoreTimer = window.setTimeout(() => { if (!isVoiceActive()) ramp(1, 800); }, 700);
  };
  window.addEventListener(VOICE_ACTIVE_EVENT, onVoice);
  return () => { window.removeEventListener(VOICE_ACTIVE_EVENT, onVoice); clearTimeout(restoreTimer); cancelAnimationFrame(raf); try { a.volume = 1; } catch { /* ignore */ } };
}
