/**
 * 书影架 · 听书：用系统自带的朗读（免费、离线也能用），一段一段往下念，念完一章自动接下一章。
 * 长段落拆成短句排队念（有的浏览器一次念太长会突然停）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const RATE_KEY = 'sully_shelf_tts_rate_v1';

const splitChunks = (text: string, max = 180): string[] => {
  const sents = text.split(/(?<=[。！？!?；;…」』”.])\s*/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const s of sents) {
    if ((cur + s).length > max && cur) { out.push(cur); cur = ''; }
    if (s.length > max) { for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max)); continue; }
    cur += s;
  }
  if (cur) out.push(cur);
  return out;
};

const pickVoice = (text: string): SpeechSynthesisVoice | null => {
  try {
    const voices = window.speechSynthesis.getVoices();
    const cjk = /[㐀-鿿]/.test(text);
    const want = cjk ? /^zh/i : /^en/i;
    const list = voices.filter(v => want.test(v.lang));
    return list.find(v => /CN|Hans/i.test(v.lang) && cjk) || list.find(v => v.localService) || list[0] || null;
  } catch { return null; }
};

export const readAloudSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof (window as any).SpeechSynthesisUtterance === 'function';

/**
 * getPara(i) 返回当前章第 i 段（没有了返回 null）；onPara(i) 念到第 i 段时调用（翻页 / 高亮）；
 * onChapterEnd() 这章念完时调用，返回 true 表示已换到下一章，从第 0 段接着念。
 */
export function useReadAloud(getPara: (i: number) => string | null, onPara: (i: number) => void, onChapterEnd: () => boolean) {
  const [para, setPara] = useState<number | null>(null);
  const [rate, setRateState] = useState(() => { try { return Number(localStorage.getItem(RATE_KEY)) || 1; } catch { return 1; } });
  const runId = useRef(0);
  const fns = useRef({ getPara, onPara, onChapterEnd }); fns.current = { getPara, onPara, onChapterEnd };
  const rateRef = useRef(rate); rateRef.current = rate;

  const stop = useCallback(() => {
    runId.current++;
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    setPara(null);
  }, []);

  const speakPara = useCallback((i: number, id: number) => {
    if (id !== runId.current) return;
    const text = fns.current.getPara(i);
    if (text == null) {
      // 这章完了：换章后从头接着念（给页面一点时间渲染新章）
      if (fns.current.onChapterEnd()) setTimeout(() => speakPara(0, id), 600);
      else { setPara(null); runId.current++; }
      return;
    }
    setPara(i); fns.current.onPara(i);
    const chunks = splitChunks(text.trim());
    if (!chunks.length) { speakPara(i + 1, id); return; }
    const voice = pickVoice(text);
    let k = 0;
    const next = () => {
      if (id !== runId.current) return;
      if (k >= chunks.length) { speakPara(i + 1, id); return; }
      const u = new SpeechSynthesisUtterance(chunks[k++]);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = /[㐀-鿿]/.test(text) ? 'zh-CN' : 'en-US';
      u.rate = rateRef.current;
      u.onend = next;
      u.onerror = (e: any) => { if (e?.error === 'interrupted' || e?.error === 'canceled') return; next(); };
      window.speechSynthesis.speak(u);
    };
    next();
  }, []);

  const start = useCallback((from: number) => {
    if (!readAloudSupported()) return false;
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    const id = ++runId.current;
    // 有的安卓浏览器第一次拿声音列表是空的，等一下再开始
    if (!window.speechSynthesis.getVoices().length) setTimeout(() => speakPara(from, id), 300);
    else speakPara(from, id);
    return true;
  }, [speakPara]);

  const setRate = (r: number) => { setRateState(r); try { localStorage.setItem(RATE_KEY, String(r)); } catch { /* ignore */ } };

  useEffect(() => () => { runId.current++; try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }, []);
  // 切到后台 / 锁屏时有的浏览器会自己停，回来时不自动续
  return { para, start, stop, rate, setRate, active: para !== null };
}
