/**
 * 安卓「添加到主屏幕」版（个人二改）：
 *  1. 顶部状态栏颜色跟着当前页面顶边走（改 <meta name="theme-color">），不再一条固定黑边
 *  2. 可选「沉浸全屏」：打开后每次进 App 第一次点屏幕就进入全屏，状态栏和底部导航条都藏起来（像柏宝阁那样）
 *     网页没法只藏导航条、留着系统状态栏，所以全屏时自己画一条极简状态栏：左边时间、右边电量，
 *     透明背景，字的深浅跟着页面顶边颜色走，看起来和没全屏时的沉浸状态栏一样
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

const toHex = (color: string): string | null => {
  const m = color.match(/\d+(\.\d+)?/g); if (!m || m.length < 3) return null;
  return '#' + m.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, '0')).join('');
};

/** 安卓 App（自己打的壳）：系统状态栏留着，颜色和字的深浅跟着页面顶边走 */
const installNativeStatusBarSync = (): (() => void) => {
  const cache = new Map<string, Promise<any>>();
  let timer: number | undefined; let revision = 0; let disposed = false; let last = '';
  const update = async (rev: number) => {
    try {
      const color = await sampleTopEdgeColor(null, cache);
      const hex = toHex(color);
      if (disposed || rev !== revision || !hex || hex === last) return;
      last = hex;
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      const [r, g, b] = color.match(/\d+(\.\d+)?/g)!.map(Number);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      await StatusBar.setBackgroundColor({ color: hex });
      await StatusBar.setStyle({ style: lum > 150 ? Style.Light : Style.Dark });
    } catch { /* ignore */ }
  };
  const schedule = () => { revision++; if (timer !== undefined) return; timer = window.setTimeout(() => { timer = undefined; void update(revision); }, 80); };
  const observer = new MutationObserver(() => schedule());
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  const onVisible = () => { if (document.visibilityState === 'visible') schedule(); };
  document.addEventListener('visibilitychange', onVisible);
  document.addEventListener('transitionend', schedule, true);
  document.addEventListener('load', schedule, true);
  schedule();
  return () => { disposed = true; observer.disconnect(); document.removeEventListener('visibilitychange', onVisible); document.removeEventListener('transitionend', schedule, true); document.removeEventListener('load', schedule, true); };
};

export const installAndroidSystemBars = (): (() => void) => {
  const noop = () => {};
  if (typeof document === 'undefined') return noop;
  try { if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') return installNativeStatusBarSync(); } catch { /* ignore */ }
  if (!isAndroidStandalone()) return noop;

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
      if (color) setInk(color);
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

  /* ── 全屏时自己画的极简状态栏 ── */
  const bar = document.createElement('div');
  bar.setAttribute('aria-hidden', 'true');
  bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483646;pointer-events:none;display:none;align-items:center;justify-content:space-between;padding:0 20px;height:max(env(safe-area-inset-top,0px),26px);font:600 13px/1 system-ui,-apple-system,"Roboto","PingFang SC",sans-serif;letter-spacing:.02em;font-variant-numeric:tabular-nums;transition:color .3s';
  const timeEl = document.createElement('span');
  const battEl = document.createElement('span');
  battEl.style.cssText = 'display:flex;align-items:center;gap:5px';
  bar.append(timeEl, battEl);
  document.body.appendChild(bar);
  function setInk(color: string) {
    const m = color.match(/\d+(\.\d+)?/g); if (!m) return;
    const [r, g, b] = m.map(Number);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    bar.style.color = lum > 150 ? 'rgba(20,20,28,0.88)' : 'rgba(255,255,255,0.92)';
  }
  let battery: any = null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const renderBar = () => {
    const d = new Date();
    timeEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (battery) {
      const lvl = Math.round(battery.level * 100);
      battEl.innerHTML = `${battery.charging ? '<span style="font-size:11px">⚡</span>' : ''}<span>${lvl}</span><span style="position:relative;display:inline-block;width:22px;height:11px;border:1.4px solid currentColor;border-radius:3.5px;opacity:.9"><span style="position:absolute;left:1.5px;top:1.5px;bottom:1.5px;width:calc((100% - 3px) * ${lvl / 100});background:currentColor;border-radius:1.5px"></span><span style="position:absolute;right:-4px;top:3px;width:2px;height:3.5px;background:currentColor;border-radius:0 1px 1px 0"></span></span>`;
    }
  };
  try { (navigator as any).getBattery?.().then((b: any) => { battery = b; b.addEventListener?.('levelchange', renderBar); b.addEventListener?.('chargingchange', renderBar); renderBar(); }); } catch { /* ignore */ }
  const clock = window.setInterval(renderBar, 10_000);
  const syncBar = () => { const show = !!document.fullscreenElement && isImmersiveOn(); bar.style.display = show ? 'flex' : 'none'; if (show) { renderBar(); schedule(); } };
  document.addEventListener('fullscreenchange', syncBar);
  renderBar();

  /* ── 沉浸全屏：浏览器规定必须由一次点按触发，所以挂在「下一次点屏幕」上 ── */
  const onTap = () => { if (isImmersiveOn()) enterFullscreen(); };
  document.addEventListener('pointerup', onTap, true);
  const onToggle = () => { if (!isImmersiveOn() && document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); syncBar(); };
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
    document.removeEventListener('fullscreenchange', syncBar);
    clearInterval(clock); bar.remove();
    meta!.content = original;
  };
};
