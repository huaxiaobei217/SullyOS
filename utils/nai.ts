/**
 * NovelAI 生图（移植自用户 qq robot 的 nai_client.py）。
 * - 画师串 + 场景 tag（self → 角色外貌 tag）+ 官方质量词；默认只画无人的场景
 * - 单并发：同一时间只画一张，两张之间至少隔 6 秒，429 退避重试
 * - 拼车排队：兼容 st-chatu8 的队列服务（同一个 key 的人排同一条队，key 只发哈希）
 * - 请求经过用户自己的代理 Worker（/nai/generate），Key 只存本机
 */
import { getProxyWorkerUrl } from './proxyWorker';

export const NAI_CFG_KEY = 'sully_nai_cfg_v1';

export interface NaiConfig {
  key: string;
  model: string;
  artist: string;
  /** 每个角色的外貌 tag（提示词里写 self 时换成它） */
  characterTags: Record<string, string>;
  negative: string;
  quality: boolean;
  allowPeople: boolean;
  width: number; height: number;
  steps: number; scale: number; sampler: string;
  queueOn: boolean; queueUrl: string; greeting: string; timeout: number;
  /** 哪些角色可以在聊天里「拍照」发给你 */
  chatPhotos: Record<string, boolean>;
}

const DEFAULTS: NaiConfig = {
  key: '', model: 'nai-diffusion-4-5-full', artist: '', characterTags: {}, negative: '', quality: true, allowPeople: false,
  width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler',
  queueOn: true, queueUrl: 'https://st-chatu-novelai-queue.hf.space', greeting: '努力生成中~', timeout: 180,
  chatPhotos: {},
};
export const loadNaiConfig = (): NaiConfig => {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(NAI_CFG_KEY) || '{}') || {}) }; } catch { return { ...DEFAULTS }; }
};
export const saveNaiConfig = (c: NaiConfig) => { try { localStorage.setItem(NAI_CFG_KEY, JSON.stringify(c)); } catch { /* ignore */ } };
export const isNaiReady = (c = loadNaiConfig()) => !!c.key.trim();

/* ───────── 提示词 ───────── */

const QUALITY_TAGS: [string, string][] = [
  ['nai-diffusion-5', ', very aesthetic, masterpiece, no text'],
  ['nai-diffusion-4-5-full', ', location, very aesthetic, masterpiece, no text'],
  ['nai-diffusion-4-5-curated', ', location, masterpiece, no text, -0.8::feet::, rating:general'],
  ['nai-diffusion-4-full', ', no text, best quality, very aesthetic, absurdres'],
  ['nai-diffusion-4-curated', ', rating:general, amazing quality, very aesthetic, absurdres'],
  ['nai-diffusion-3', ', best quality, amazing quality, very aesthetic, absurdres'],
];
const NEG_V4 = 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page';
const NEG_V3 = 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry';
const NO_PEOPLE_NEG = '1boy, 1girl, multiple boys, multiple girls, person, human, face, portrait, hands, crowd';
const PEOPLE_WORD = /\b(\d*\s*(boy|girl)s?|man|men|woman|women|person|people|humans?|male|female|solo|couple|portrait|selfie|face|facial|eyes?|eyelash(es)?|eyebrows?|lips?|mouth|teeth|nose|ears?|neck|shoulders?|smile|smiling|grin|blush|expression|skin|hair|hairstyle|bangs|ponytail|handsome|beautiful|pretty|cute|hands?|fingers?|nails?|arms?|legs?|thighs?|feet|breasts?|(upper|full|lower) body|cowboy shot|looking at viewer|holding|wearing)\b/i;
const SELF_WORDS = ['self', '{self}', 'me', 'myself'];

const isV4 = (m: string) => /^nai-diffusion-(4|5)/.test(m);
const supportsBg = (m: string) => /^nai-diffusion-(4-5|5)/.test(m);
const qualitySuffix = (m: string) => (QUALITY_TAGS.find(([p]) => m.startsWith(p)) || ['', ''])[1];
const cleanTags = (s: string) => (s || '').replace(/\r/g, ' ').replace(/\n/g, ', ').split(',').map(x => x.trim()).filter(Boolean).join(', ');
const splitTags = (s: string): string[] => {
  const out: string[] = [];
  const re = /\s*(-?\d+(?:\.\d+)?::.*?::|[^,]+)\s*,?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s || '')) && m[0]) { const t = m[1].trim(); if (t) out.push(t); }
  return out;
};
const stripPeople = (tags: string[]) => tags.flatMap(t => {
  const g = /^(-?\d+(?:\.\d+)?)::([\s\S]*)::$/.exec(t);
  if (g) {
    const inner = g[2].split(',').map(x => x.trim()).filter(x => x && !PEOPLE_WORD.test(x));
    return inner.length ? [`${g[1]}::${inner.join(', ')}::`] : [];
  }
  return PEOPLE_WORD.test(t) || SELF_WORDS.includes(t.toLowerCase()) ? [] : [t];
});

export function buildNaiPrompt(scene: string, charId = '', cfg = loadNaiConfig(), allowPeople?: boolean): { prompt: string; negative: string } {
  const people = allowPeople ?? cfg.allowPeople;
  let parts = splitTags(cleanTags(scene));
  let artist = cleanTags(cfg.artist);
  if (people) {
    const self = cleanTags(cfg.characterTags[charId] || '');
    parts = parts.map(p => SELF_WORDS.includes(p.toLowerCase()) ? self : p);
  } else {
    parts = stripPeople(parts);
    artist = stripPeople(splitTags(artist)).join(', ');
    if (!parts.some(p => p.toLowerCase() === 'no humans')) parts.push('no humans');
  }
  let prompt = [artist, parts.filter(Boolean).join(', ')].filter(Boolean).join(', ');
  if (!people && supportsBg(cfg.model)) prompt = 'background dataset, ' + prompt;
  if (cfg.quality) prompt += qualitySuffix(cfg.model);
  let negative = cleanTags(cfg.negative) || (isV4(cfg.model) ? NEG_V4 : NEG_V3);
  if (!people) negative += ', ' + NO_PEOPLE_NEG;
  return { prompt, negative };
}

const buildPayload = (cfg: NaiConfig, prompt: string, negative: string, width: number, height: number) => {
  const seed = Math.floor(Math.random() * 4294967294) + 1;
  if (isV4(cfg.model)) {
    return {
      input: prompt, model: cfg.model, action: 'generate',
      parameters: {
        params_version: cfg.model.startsWith('nai-diffusion-5') ? 4 : 3,
        width, height, scale: cfg.scale, sampler: cfg.sampler || 'k_euler', steps: cfg.steps,
        n_samples: 1, seed, extra_noise_seed: seed, noise_schedule: 'karras', cfg_rescale: 0,
        ucPreset: 0, qualityToggle: false, sm: false, sm_dyn: false, dynamic_thresholding: false,
        controlnet_strength: 1, legacy: false, legacy_v3_extend: false, add_original_image: false, uncond_scale: 1,
        prompt, negative_prompt: negative, characterPrompts: [],
        v4_prompt: { caption: { base_caption: prompt, char_captions: [] }, use_coords: false, use_order: true },
        v4_negative_prompt: { caption: { base_caption: negative, char_captions: [] }, use_coords: false, use_order: true, legacy_uc: false },
        reference_image_multiple: [], reference_information_extracted_multiple: [], reference_strength_multiple: [],
      },
    };
  }
  return {
    input: prompt, model: cfg.model, action: 'generate',
    parameters: { width, height, scale: cfg.scale, sampler: 'k_euler', steps: cfg.steps, n_samples: 1, seed, ucPreset: 0, qualityToggle: false, negative_prompt: negative },
  };
};

/* ───────── 拼车排队（st-chatu8 队列服务，经 Worker 的 /lx/request 中转） ───────── */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const queueUid = () => {
  try {
    let u = localStorage.getItem('sully_nai_queue_uid');
    if (!u) { u = crypto.randomUUID(); localStorage.setItem('sully_nai_queue_uid', u); }
    return u;
  } catch { return 'sully-' + Math.random().toString(36).slice(2); }
};
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(b => b.toString(16).padStart(2, '0')).join('');

const relay = async (method: string, url: string, body?: any) => {
  const res = await fetch(`${getProxyWorkerUrl()}/lx/request`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, method, headers: { 'Content-Type': 'application/json' }, body, timeout: 15000 }),
  });
  if (!res.ok) throw new Error(`Worker HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  let data: any = null;
  try { data = JSON.parse(j.body); } catch { /* 非 JSON */ }
  return { status: j.statusCode as number, data };
};

type Ticket = { key_hash: string; user_id: string; task_id: string; lock_token: string };
export type NaiProgress = (msg: string) => void;

async function queueAcquire(cfg: NaiConfig, onProgress?: NaiProgress): Promise<Ticket | null | false> {
  const raw = cfg.key.replace(/^bearer\s+/i, '').trim();
  const key_hash = await sha256(raw);
  const user_id = queueUid();
  const task_id = crypto.randomUUID();
  const base = cfg.queueUrl.replace(/\/+$/, '');
  let j: any;
  try {
    const r = await relay('POST', `${base}/join-queue`, { key_hash, user_id, task_id, greeting: (cfg.greeting || '').slice(0, 15) || null });
    if (r.status !== 200) return null;
    j = r.data || {};
  } catch { return null; } // 队列服务连不上：这次直接画
  if (j.position === 0 && j.lock_token) return { key_hash, user_id, task_id, lock_token: j.lock_token };
  onProgress?.(`排队中：第 ${(j.position ?? 0) + 1}/${j.queue_size ?? '?'} 位`);
  const start = Date.now();
  let fails = 0, lastPos = j.position;
  while (Date.now() - start < cfg.timeout * 1000) {
    await sleep(1000);
    let st: any;
    try {
      const r = await relay('GET', `${base}/my-turn?key_hash=${key_hash}&user_id=${encodeURIComponent(user_id)}&task_id=${task_id}`);
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      st = r.data || {}; fails = 0;
    } catch {
      if (++fails >= 3) { await queueRelease(cfg, { key_hash, user_id, task_id, lock_token: '' }, false); return false; }
      continue;
    }
    if (st.is_my_turn && st.lock_token) return { key_hash, user_id, task_id, lock_token: st.lock_token };
    if (st.position !== lastPos) {
      lastPos = st.position;
      onProgress?.(`排队中：第 ${(lastPos ?? 0) + 1}/${st.queue_size ?? '?'} 位${st.current_greeting ? ` · 前面的人：${st.current_greeting}` : ''}`);
    }
  }
  await queueRelease(cfg, { key_hash, user_id, task_id, lock_token: '' }, false);
  return false;
}
async function queueRelease(cfg: NaiConfig, t: Ticket, done: boolean) {
  try { await relay('POST', `${cfg.queueUrl.replace(/\/+$/, '')}/${done ? 'complete' : 'leave-queue'}`, { ...t, lock_token: t.lock_token || null }); } catch { /* ignore */ }
}

/* ───────── 解 zip（NovelAI 返回的是只含一张 png 的 zip） ───────── */

async function unzipFirstPng(buf: ArrayBuffer): Promise<Blob> {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x89 && u8[1] === 0x50) return new Blob([buf], { type: 'image/png' }); // 直接就是 png
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('NovelAI 返回的不是图片');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.png$/i.test(name)) continue;
    const start = localOff + 30 + dv.getUint16(localOff + 26, true) + dv.getUint16(localOff + 28, true);
    const data = u8.subarray(start, start + compSize);
    if (method === 0) return new Blob([data], { type: 'image/png' });
    const ds = new (window as any).DecompressionStream('deflate-raw');
    const out = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
    return new Blob([out], { type: 'image/png' });
  }
  throw new Error('NovelAI 返回的压缩包里没有图片');
}

/* ───────── 生图（全局单并发 + 冷却） ───────── */

let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;
const COOLDOWN = 6000;

export type NaiOrient = 'portrait' | 'landscape' | 'square';
const SIZES: Record<NaiOrient, [number, number]> = { landscape: [1216, 832], portrait: [832, 1216], square: [1024, 1024] };

export function generateNaiImage(scene: string, opts: { charId?: string; orient?: NaiOrient; allowPeople?: boolean; onProgress?: NaiProgress } = {}): Promise<Blob> {
  const run = async (): Promise<Blob> => {
    const cfg = loadNaiConfig();
    if (!isNaiReady(cfg)) throw new Error('还没填 NovelAI 的 Key（设置 → API 总览 → NovelAI 生图）');
    const wait = COOLDOWN - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    const [w, h] = opts.orient ? SIZES[opts.orient] : [cfg.width, cfg.height];
    const { prompt, negative } = buildNaiPrompt(scene, opts.charId, cfg, opts.allowPeople);
    const payload = buildPayload(cfg, prompt, negative, w, h);
    let ticket: Ticket | null | false = null;
    if (cfg.queueOn && cfg.queueUrl) {
      ticket = await queueAcquire(cfg, opts.onProgress);
      if (ticket === false) throw new Error('排了很久还没轮到，这次先不画了');
      if (ticket) await sleep(1000);
    }
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        opts.onProgress?.('正在画…');
        const res = await fetch(`${getProxyWorkerUrl()}/nai/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key.replace(/^bearer\s+/i, '').trim()}` },
          body: JSON.stringify(payload),
        });
        lastCall = Date.now();
        if (res.ok) return await unzipFirstPng(await res.arrayBuffer());
        if (res.status === 429 && attempt < 2) { opts.onProgress?.('请求太频繁，稍等重试…'); await sleep((attempt + 1) * 6000); continue; }
        if (res.status === 404 || res.status === 405) throw new Error('代理 Worker 还没有 /nai/generate，需要更新一次 Worker 代码');
        const t = await res.text().catch(() => '');
        const hint = res.status === 401 ? '（Key 无效）' : res.status === 402 ? '（没有订阅或 Anlas 不足）' : res.status === 400 && /enum/.test(t) ? '（模型名不对）' : '';
        throw new Error(`生图失败 HTTP ${res.status}${hint} ${t.slice(0, 120)}`);
      }
      throw new Error('生图失败：重试几次都不行');
    } finally {
      if (ticket) await queueRelease(cfg, ticket, true);
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}
