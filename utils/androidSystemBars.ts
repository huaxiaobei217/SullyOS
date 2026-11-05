/**
 * 安卓「添加到主屏幕」版（个人二改）：
 *  1. 顶部状态栏颜色跟着当前页面顶边走（改 <meta name="theme-color">），不再一条固定黑边
 *  2. 可选「沉浸全屏」：打开后每次进 App 第一次点屏幕就进入全屏，状态栏和底部导航条都藏起来（像柏宝阁那样）
 * 只在安卓 + 主屏幕模式生效；浏览器标签页、iOS、打包的 App 都不动。
 */
import { Capacitor } from '@capacitor/core';
import { sampleTopEdgeColor } from './iosStatusBarEdge';

const IMMERSIVE_KEY = 'sully_android_immersive_v1';
export const IMMERSIVE_EVENT = 'sully:android-immersive';

export const isAndroidStandalone = (): boolean => {
  try {
    if (Capacitor.isNativePlatform()) return false;
    if (!/Android/i.test(navigator.userAgent)) return false;
    return ['standalone', 'fullscreen', 'minimal-ui'].some(m => window.matchMedia?.(`(display-mode: ${m})`).matches);
  } catch { return false; }
};

export const isImmersiveOn = () => { try { return localStorage.getItem(IMMERSIVE_KEY) === '1'; } catch { return false; } };
export const setImmersiveOn = (on: boolean) => {
  try { localStorage.setItem(IMMERSIVE_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(IMMERSIVE_EVENT)); } catch { /* ignore */ }
};

const enterFullscreen = () => {
  const el: any = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' }).catch(() => { /* 用户手势不够也没关系，下次点再试 */ });
};

export const installAndroidSystemBars = (): (() => void) => {
  const noop = () => {};
  if (typeof document === 'undefined' || !isAndroidStandalone()) return noop;

  /* ── 状态栏颜色 ── */
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
  const original = meta.content;
  const cache = new Map<string, Promise<any>>();
  let timer: number | undefined; let revision = 0; let disposed = false;
  const update = async (rev: number) => {
    try {
      const color = await sampleTopEdgeColor(null, cache);
      if (disposed || rev !== revision) return;
      if (color && meta!.content !== color) meta!.content = color;
    } catch { /* ignore */ }
  };
  const schedule = () => { revision++; if (timer !== undefined) return; timer = window.setTimeout(() => { timer = undefined; void update(revision); }, 80); };
  const touchesTop = (node: Node) => {
    if (!(node instanceof Element)) return false;
    if (node === document.documentElement || node === document.body) return true;
    const b = node.getBoundingClientRect(); return b.top <= 1 && b.bottom >= 1;
  };
  const observer = new MutationObserver(records => {
    if (records.some(r => touchesTop(r.target) && (r.type === 'attributes' || [...r.addedNodes, ...r.removedNodes].some(n => n instanceof Element)))) schedule();
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  const onVisible = () => { if (document.visibilityState === 'visible') schedule(); };
  window.addEventListener('pageshow', schedule); window.addEventListener('resize', schedule);
  document.addEventListener('visibilitychange', onVisible);
  document.addEventListener('transitionend', schedule, true);
  document.addEventListener('animationend', schedule, true);
  document.addEventListener('load', schedule, true);
  schedule();

  /* ── 沉浸全屏：浏览器规定必须由一次点按触发，所以挂在「下一次点屏幕」上 ── */
  const onTap = () => { if (isImmersiveOn()) enterFullscreen(); };
  document.addEventListener('pointerup', onTap, true);
  const onToggle = () => { if (!isImmersiveOn() && document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); };
  window.addEventListener(IMMERSIVE_EVENT, onToggle);

  return () => {
    disposed = true; revision++;
    if (timer !== undefined) clearTimeout(timer);
    observer.disconnect();
    window.removeEventListener('pageshow', schedule); window.removeEventListener('resize', schedule);
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('transitionend', schedule, true);
    document.removeEventListener('animationend', schedule, true);
    document.removeEventListener('load', schedule, true);
    document.removeEventListener('pointerup', onTap, true);
    window.removeEventListener(IMMERSIVE_EVENT, onToggle);
    meta!.content = original;
  };
};
