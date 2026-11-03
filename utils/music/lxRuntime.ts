/**
 * LX Music 自定义音源运行时。
 *
 * 用户在音乐 App 里导入自己的 LX 音源脚本（.js），这里给脚本造一个最小的 `globalThis.lx`
 * 环境，把它关进独立的 Web Worker 里跑：脚本碰不到页面 DOM / localStorage。
 * 脚本发出的网络请求（lx.request）回到主线程，再经用户自己的代理 Worker 的 `/lx/request`
 * 转发——浏览器不能设 User-Agent，也会被跨域拦住。
 *
 * 只实现了 LX 音源最常用的部分：request / on / send / EVENT_NAMES / env / version，
 * 以及 musicUrl 动作。lx.utils 里的加解密暂不支持（需要时再补）。
 */

import { resolveMusicWorkerUrl, loadMusicCfgStandalone } from '../../context/MusicContext';

export type LxSource = 'wy' | 'kg' | 'kw' | 'tx' | 'mg';
export type LxQuality = '128k' | '320k' | 'flac' | 'flac24bit' | 'hires';

export interface LxScriptInfo {
  name: string;
  version: string;
  author: string;
  description: string;
}

export interface LxInitedSource {
  name: string;
  type: string;
  actions: string[];
  qualitys: string[];
}

/** 传给脚本的 musicInfo（LX 旧版扁平格式，脚本普遍读这些字段） */
export interface LxMusicInfo {
  songmid: string | number;
  hash?: string;
  name: string;
  singer: string;
  albumName?: string;
  interval?: string;
  strMediaMid?: string;
  copyrightId?: string;
  source: LxSource;
}

/** 解析脚本头部的 @name / @version 等注释 */
export const parseLxScriptInfo = (script: string): LxScriptInfo => {
  const head = script.slice(0, 2048);
  const pick = (k: string) => (head.match(new RegExp(`@${k}\\s+(.+)`))?.[1] || '').trim();
  return {
    name: pick('name') || '未命名音源',
    version: pick('version'),
    author: pick('author'),
    description: pick('description'),
  };
};

// Worker 里的前置代码：定义 lx 对象，桥接消息
const PRELUDE = `
const __pending = new Map();
let __reqSeq = 0;
let __handler = null;
const EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' };
const __unsupported = (n) => () => { throw new Error('lx.utils.' + n + ' 暂不支持'); };
globalThis.lx = {
  EVENT_NAMES,
  version: '2.0.0',
  env: 'mobile',
  currentScriptInfo: {},
  request(url, options, callback) {
    const id = ++__reqSeq;
    __pending.set(id, callback);
    postMessage({ t: 'request', id, url, options: options || {} });
    return () => { __pending.delete(id); };
  },
  on(event, handler) { if (event === EVENT_NAMES.request) __handler = handler; },
  send(event, data) { postMessage({ t: 'send', event, data: JSON.parse(JSON.stringify(data ?? null)) }); },
  utils: {
    crypto: { aesEncrypt: __unsupported('crypto.aesEncrypt'), rsaEncrypt: __unsupported('crypto.rsaEncrypt'),
      randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)), md5: __unsupported('crypto.md5') },
    buffer: {
      from: (s) => new TextEncoder().encode(String(s)),
      bufToString: (b, enc) => enc === 'hex'
        ? Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('')
        : new TextDecoder().decode(b),
    },
    zlib: { inflate: __unsupported('zlib.inflate'), deflate: __unsupported('zlib.deflate') },
  },
};
self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.t === 'response') {
    const cb = __pending.get(m.id); __pending.delete(m.id);
    if (!cb) return;
    if (m.error) cb(new Error(m.error), null);
    else {
      let body = m.resp.body;
      try { body = JSON.parse(body); } catch {}
      cb(null, { statusCode: m.resp.statusCode, statusMessage: '', headers: m.resp.headers || {}, body, raw: m.resp.body });
    }
  } else if (m.t === 'call') {
    try {
      if (!__handler) throw new Error('音源脚本没有注册请求处理');
      const value = await __handler(m.payload);
      postMessage({ t: 'result', id: m.id, ok: true, value });
    } catch (err) {
      postMessage({ t: 'result', id: m.id, ok: false, error: String(err && err.message || err) });
    }
  }
};
`;

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: number };

export class LxRuntime {
  private worker: Worker | null = null;
  private calls = new Map<number, Pending>();
  private callSeq = 0;
  private initedResolve: ((s: Record<string, LxInitedSource>) => void) | null = null;
  sources: Record<string, LxInitedSource> = {};
  info: LxScriptInfo;
  onUpdateAlert?: (data: { log?: string; updateUrl?: string }) => void;

  constructor(private script: string, private proxyBase?: string) {
    this.info = parseLxScriptInfo(script);
  }

  /** 启动脚本，等它发出 inited（最多 15 秒） */
  start(): Promise<Record<string, LxInitedSource>> {
    this.stop();
    const blob = new Blob([PRELUDE, '\n;\n', this.script], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    this.worker = w;
    w.onmessage = (e) => this.onMessage(e.data);
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('音源脚本初始化超时')), 15000);
      w.onerror = (ev) => { window.clearTimeout(timer); reject(new Error(`音源脚本出错：${ev.message}`)); };
      this.initedResolve = (s) => { window.clearTimeout(timer); resolve(s); };
    });
  }

  stop() {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.calls.values()) { window.clearTimeout(p.timer); p.reject(new Error('音源已停止')); }
    this.calls.clear();
  }

  supports(source: LxSource): boolean {
    return !!this.sources[source]?.actions?.includes('musicUrl');
  }

  qualitys(source: LxSource): string[] {
    return this.sources[source]?.qualitys || [];
  }

  /** 让脚本取播放链接 */
  getMusicUrl(source: LxSource, musicInfo: LxMusicInfo, quality: string): Promise<string> {
    return this.call({ action: 'musicUrl', source, info: { type: quality, musicInfo } }).then((v) => {
      const u = typeof v === 'string' ? v : v?.url;
      if (!u) throw new Error('音源没有返回播放链接');
      return String(u);
    });
  }

  private call(payload: any, timeoutMs = 20000): Promise<any> {
    if (!this.worker) return Promise.reject(new Error('音源未启动'));
    const id = ++this.callSeq;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => { this.calls.delete(id); reject(new Error('音源请求超时')); }, timeoutMs);
      this.calls.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ t: 'call', id, payload });
    });
  }

  private async onMessage(m: any) {
    if (!m) return;
    if (m.t === 'send') {
      if (m.event === 'inited') {
        this.sources = m.data?.sources || {};
        this.initedResolve?.(this.sources);
        this.initedResolve = null;
      } else if (m.event === 'updateAlert') {
        this.onUpdateAlert?.(m.data || {});
      }
    } else if (m.t === 'result') {
      const p = this.calls.get(m.id);
      if (!p) return;
      this.calls.delete(m.id);
      window.clearTimeout(p.timer);
      if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error || '音源出错'));
    } else if (m.t === 'request') {
      const reply = (data: any) => this.worker?.postMessage({ t: 'response', id: m.id, ...data });
      try {
        const base = this.proxyBase || resolveMusicWorkerUrl(loadMusicCfgStandalone());
        const o = m.options || {};
        const res = await fetch(`${base}/lx/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: m.url, method: o.method || 'GET', headers: o.headers || {},
            body: o.body ?? (o.form ? new URLSearchParams(o.form).toString() : undefined),
            timeout: o.timeout,
          }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j || j.error) {
          const hint = res.status === 404 ? '（你的代理 Worker 还没有 /lx/request，需要重新部署最新的 worker/index.js）' : '';
          reply({ error: (j?.error || `代理请求失败 HTTP ${res.status}`) + hint });
          return;
        }
        reply({ resp: j });
      } catch (e: any) {
        reply({ error: e?.message || String(e) });
      }
    }
  }
}

/* ───────── 单例：当前启用的音源 ───────── */

const LS_SCRIPT_KEY = 'sully_music_lx_script_v1';

let __runtime: LxRuntime | null = null;
let __starting: Promise<LxRuntime> | null = null;

export const loadSavedLxScript = (): string => {
  try { return localStorage.getItem(LS_SCRIPT_KEY) || ''; } catch { return ''; }
};

export const saveLxScript = (script: string) => {
  try {
    if (script) localStorage.setItem(LS_SCRIPT_KEY, script);
    else localStorage.removeItem(LS_SCRIPT_KEY);
  } catch {}
  __runtime?.stop();
  __runtime = null;
  __starting = null;
};

/** 取得已启动的音源；没导入脚本时抛错 */
export const getLxRuntime = (): Promise<LxRuntime> => {
  if (__runtime) return Promise.resolve(__runtime);
  if (__starting) return __starting;
  const script = loadSavedLxScript();
  if (!script) return Promise.reject(new Error('还没有导入音源脚本（音乐 → 设置 → 音源）'));
  const rt = new LxRuntime(script);
  __starting = rt.start().then(() => { __runtime = rt; __starting = null; return rt; })
    .catch((e) => { __starting = null; throw e; });
  return __starting;
};
