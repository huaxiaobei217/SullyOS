/**
 * 绘图 App 的 NovelAI 层（个人二改）。
 * 请求拼法、模型能力、质量词 / 负面预设、导演工具、放大、Vibe、读图，照 ST-iPhonie（github.com/hey8v0/ST-iPhonie，
 * 作者 hey8v0 同意搬运）的 core/novelai.js、core/vibes.js、core/png-text.js 改写成 TS。
 *
 * 线路：先走用户自己的代理 Worker 的 /nai/x/<路径>（Key 只透传）；Worker 还没更新（404）时直连 NovelAI
 * （image.novelai.net 允许网页跨域）。Key 只存本机（utils/nai.ts 的 sully_nai_cfg_v1），不进备份、不上云。
 * 所有会出图 / 扣 Anlas 的请求走同一条队：一次一个，两次之间至少 6 秒，429 退避。
 */
import { loadNaiConfig } from './nai';
import { getProxyWorkerUrl } from './proxyWorker';

/* ───────── 模型和能力 ───────── */
export const NAI_MODELS = ['nai-diffusion-5-full', 'nai-diffusion-5-curated', 'nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-full', 'nai-diffusion-4-curated-preview', 'nai-diffusion-3', 'nai-diffusion-furry-3'] as const;
export const NAI_MODEL_NAMES: Record<string, string> = {
  'nai-diffusion-5-full': 'V5 Full', 'nai-diffusion-5-curated': 'V5 Curated', 'nai-diffusion-4-5-full': 'V4.5 Full', 'nai-diffusion-4-5-curated': 'V4.5 Curated',
  'nai-diffusion-4-full': 'V4 Full', 'nai-diffusion-4-curated-preview': 'V4 Curated', 'nai-diffusion-3': 'Anime V3', 'nai-diffusion-furry-3': 'Furry V3',
};
export const NAI_SAMPLERS = ['k_euler_ancestral', 'k_euler', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m_sde', 'k_dpmpp_2m', 'k_dpmpp_sde', 'k_dpm_2', 'k_dpm_fast', 'ddim_v3'];
export const NAI_SAMPLER_NAMES: Record<string, string> = { k_euler_ancestral: 'Euler Ancestral', k_euler: 'Euler', k_dpmpp_2s_ancestral: 'DPM++ 2S Ancestral', k_dpmpp_2m_sde: 'DPM++ 2M SDE', k_dpmpp_2m: 'DPM++ 2M', k_dpmpp_sde: 'DPM++ SDE', k_dpm_2: 'DPM2', k_dpm_fast: 'DPM Fast', ddim_v3: 'DDIM' };
export const NAI_SCHEDULES = ['karras', 'exponential', 'polyexponential', 'native'];
export const NAI_MAX_PIXELS = 3145728;
export const isV5 = (m: string) => /^nai-diffusion-5/.test(m);

export function naiFeatures(model: string) {
  const m = String(model || ''), v5 = isV5(m), v45 = /^nai-diffusion-4-5/.test(m), v4 = /^nai-diffusion-4(?!-5)/.test(m), v3 = /^nai-diffusion-(furry-)?3/.test(m), captions = v5 || v45 || v4;
  return {
    v5, v45, v4, v3, captions, characters: v5 ? 22 : captions ? 6 : 0, freePosition: v5, positionOne: v5, schedule: !v5, variety: !v5, varietySigma: v45 ? 58 : 19,
    smea: v3, decrisper: v3, mode: captions, transparent: v5, reference: v45, effort: m === 'nai-diffusion-5-full', inpaintStrength: captions,
    enhanceWords: v5 || v45, autoText: v5, legacyUc: v4, maxEnhance: v5, vibes: !!VIBE_KEYS[m],
  };
}
export const samplersFor = (model: string) => naiFeatures(model).v3 ? NAI_SAMPLERS : NAI_SAMPLERS.slice(0, 6);
export function schedulesFor(model: string, sampler: string): string[] {
  const f = naiFeatures(model);
  if (!f.schedule || sampler === 'ddim_v3' || sampler === 'k_dpm_fast') return [];
  if (sampler === 'k_dpm_2') return ['exponential', 'polyexponential'];
  return f.v3 ? ['native', 'karras', 'exponential', 'polyexponential'] : ['karras', 'exponential', 'polyexponential'];
}
const defaultSchedule = (sampler: string) => sampler === 'k_dpm_2' || sampler === 'k_dpmpp_2m' ? 'exponential' : 'karras';

const QUALITY_WORDS = { v5: 'very aesthetic, masterpiece, no text', v5light: 'very aesthetic, amazing quality, no text', v45full: 'very aesthetic, masterpiece, no text', v45curated: 'very aesthetic, masterpiece, no text, -0.8::feet::, rating:general', v4full: 'no text, best quality, very aesthetic, absurdres', v4curated: 'rating:general, best quality, very aesthetic, absurdres', v3: 'best quality, amazing quality, very aesthetic, absurdres', furry3: '{best quality}, {amazing quality}' };
export function qualityPresets(model: string) {
  const m = String(model || ''), standard = (words: string) => [{ id: 'standard', name: '标准', words }, { id: 'none', name: '不加', words: '' }];
  if (isV5(m)) return [{ id: 'standard', name: '标准', words: QUALITY_WORDS.v5 }, { id: 'light', name: '轻', words: QUALITY_WORDS.v5light }, { id: 'none', name: '不加', words: '' }];
  if (m === 'nai-diffusion-4-5-full') return standard(QUALITY_WORDS.v45full);
  if (m === 'nai-diffusion-4-5-curated') return standard(QUALITY_WORDS.v45curated);
  if (m === 'nai-diffusion-4-full') return standard(QUALITY_WORDS.v4full);
  if (m === 'nai-diffusion-4-curated-preview') return standard(QUALITY_WORDS.v4curated);
  return standard(m === 'nai-diffusion-furry-3' ? QUALITY_WORDS.furry3 : QUALITY_WORDS.v3);
}
const UC_HEAVY_NEW = 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page';
const UC_FURRY = '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic';
const UC_HUMAN_NEW = UC_HEAVY_NEW + ', @_@, mismatched pupils, glowing eyes, bad anatomy';
const UC_V3 = 'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]';
const UC_TABLE: Record<string, [string, string][]> = {
  v5: [['heavy', UC_HEAVY_NEW], ['light', 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::'], ['humanFocus', UC_HUMAN_NEW], ['furryFocus', UC_FURRY], ['none', '']],
  v45full: [['heavy', UC_HEAVY_NEW], ['light', 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page'], ['humanFocus', UC_HUMAN_NEW], ['furryFocus', UC_FURRY], ['none', '']],
  v45curated: [['heavy', 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page'], ['light', 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page'], ['humanFocus', 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page'], ['none', '']],
  v4full: [['heavy', 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page'], ['light', 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page'], ['none', '']],
  v4curated: [['heavy', 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page'], ['light', 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page'], ['none', '']],
  v3: [['heavy', UC_V3], ['light', 'lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing'], ['humanFocus', UC_V3 + ', bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes'], ['none', 'lowres']],
  furry3: [['heavy', '{{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, {what}, {where is your god now}, {distorted text}, repeated text, {floating head}, {1994}, {widescreen}, absolutely everyone, sequence, {compression artifacts}, hard translated, {cropped}, {commissioner name}, unknown text, high contrast'], ['light', '{worst quality}, guide lines, unfinished, bad, url, tall image, widescreen, compression artifacts, unknown text'], ['none', 'lowres']],
};
const UC_NAMES: Record<string, string> = { heavy: '重', light: '轻', humanFocus: '人物', furryFocus: '福瑞', none: '不加' };
export function ucPresets(model: string) {
  const m = String(model || ''), key = isV5(m) ? 'v5' : m === 'nai-diffusion-4-5-full' ? 'v45full' : m === 'nai-diffusion-4-5-curated' ? 'v45curated' : m === 'nai-diffusion-4-full' ? 'v4full' : m === 'nai-diffusion-4-curated-preview' ? 'v4curated' : m === 'nai-diffusion-furry-3' ? 'furry3' : 'v3';
  return UC_TABLE[key].map(([id, words]) => ({ id, name: UC_NAMES[id], words }));
}
const TAG_HINTS: Record<string, number> = { none: 0, standard: 1, heavy: 2, light: 3, humanFocus: 4, furryFocus: 5 };
const withinPixels = (w: number, h: number): [number, number] => { if (w * h <= NAI_MAX_PIXELS) return [w, h]; const k = Math.sqrt(NAI_MAX_PIXELS / (w * h)); return [Math.max(64, Math.floor(w * k / 64) * 64), Math.max(64, Math.floor(h * k / 64) * 64)]; };
export const FREE_STEPS = 28;
export const FREE_PIXELS = 1024 * 1024;
export const V5_MIN_PERCENT = 2;
const REFERENCE_PIXELS = 832 * 1216;

export interface DrawParams {
  model: string; width: number; height: number; steps: number; scale: number; sampler: string; schedule: string; seed: number;
  cfgRescale: number; variety: boolean; effort: 'high' | 'medium'; mode: 'anime' | 'furry' | 'background'; quality: string; ucPreset: string;
  smea: 'auto' | 'on' | 'dyn' | 'off'; decrisper: boolean; transparent?: boolean; legacyUc?: boolean;
}
export const defaultDrawParams = (): DrawParams => ({ model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', schedule: 'karras', seed: -1, cfgRescale: 0, variety: false, effort: 'high', mode: 'anime', quality: 'none', ucPreset: 'none', smea: 'auto', decrisper: false });

export function normalizeDrawParams(value: Partial<DrawParams> = {}): DrawParams {
  const base = defaultDrawParams(), p: DrawParams = { ...base, ...value } as DrawParams;
  const num = (v: unknown, min: number, max: number, fallback: number, step = 1) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n / step) * step)) : fallback; };
  p.model = (NAI_MODELS as readonly string[]).includes(p.model) ? p.model : base.model;
  const f = naiFeatures(p.model);
  p.sampler = samplersFor(p.model).includes(p.sampler) ? p.sampler : base.sampler;
  p.schedule = NAI_SCHEDULES.includes(p.schedule) ? p.schedule : base.schedule;
  const schedules = schedulesFor(p.model, p.sampler);
  if (schedules.length && !schedules.includes(p.schedule)) p.schedule = defaultSchedule(p.sampler);
  [p.width, p.height] = withinPixels(num(p.width, 64, 8192, base.width, 64), num(p.height, 64, 8192, base.height, 64));
  p.steps = num(p.steps, 1, 50, base.steps);
  p.scale = num(p.scale, 0, 10, base.scale, .1);
  p.cfgRescale = num(p.cfgRescale, 0, 1, 0, .02);
  p.seed = num(p.seed, -1, 4294967295, -1);
  p.variety = !!p.variety && f.variety;
  p.transparent = !!p.transparent && f.transparent;
  p.effort = p.effort === 'medium' && f.effort ? 'medium' : 'high';
  p.mode = (p.mode === 'furry' || p.mode === 'background') && f.mode ? p.mode : 'anime';
  p.quality = qualityPresets(p.model).some(q => q.id === p.quality) ? p.quality : 'none';
  p.ucPreset = ucPresets(p.model).some(u => u.id === p.ucPreset) ? p.ucPreset : 'none';
  p.smea = (['auto', 'on', 'dyn', 'off'] as const).includes(p.smea) ? p.smea : 'auto';
  p.decrisper = !!p.decrisper && f.decrisper;
  if (!(p.legacyUc && f.legacyUc)) delete p.legacyUc;
  return p;
}

export interface NaiSubscription { tier: number; active: boolean; unlimited: boolean; usage: { percent: number; negative: boolean } | null; anlas: number; checkedAt: number }
/** Opus 免费档：一张、≤28 步、≤1024×1024；V5 另看额度百分比 */
export function isFree(p: DrawParams, sub: NaiSubscription | null): boolean | null {
  if (!(p.steps <= FREE_STEPS && p.width * p.height <= FREE_PIXELS)) return false;
  if (!sub) return null;
  if (!sub.unlimited) return false;
  if (!isV5(p.model)) return true;
  if (!sub.usage) return null;
  return !sub.usage.negative && sub.usage.percent >= V5_MIN_PERCENT;
}
export function guardParams(p: DrawParams): DrawParams {
  const out = { ...p, steps: Math.min(p.steps, FREE_STEPS) };
  if (out.width * out.height > FREE_PIXELS) {
    const r = Math.sqrt(FREE_PIXELS / (out.width * out.height));
    out.width = Math.max(64, Math.floor(out.width * r / 64) * 64); out.height = Math.max(64, Math.floor(out.height * r / 64) * 64);
  }
  return out;
}
export function readSubscription(data: any = {}): NaiSubscription {
  const steps = data.trainingStepsLeft || {}, tier = Number(data.tier) || 0, active = data.active === true;
  const usage = data.usage && Number.isFinite(Number(data.usage.percent)) ? { percent: Math.max(0, Math.min(100, Math.round(Number(data.usage.percent)))), negative: data.usage.isNegative === true } : null;
  const unlimited = active && (tier === 3 || data.perks?.unlimitedImageGeneration === true);
  const anlas = typeof steps === 'number' ? steps : (Number(steps.fixedTrainingStepsLeft) || 0) + (Number(steps.purchasedTrainingSteps) || 0);
  return { tier, active, unlimited, usage, anlas, checkedAt: Date.now() };
}
export const TIER_NAMES: Record<number, string> = { 0: '未订阅', 1: 'Tablet', 2: 'Scroll', 3: 'Opus' };

/* ───────── 角色参考 / 导演工具 / 放大 ───────── */
export const takesReference = (model: string) => /^nai-diffusion-4-5/.test(model);
export const MAX_REFERENCES = 16;
export const REFERENCE_ANLAS = 5;
export const REFERENCE_KINDS = { character: 'character', style: 'style', both: 'character&style' } as const;
export const REFERENCE_SIZES: [number, number][] = [[1024, 1536], [1536, 1024], [1472, 1472]];
export const inpaintModel = (model: string) => model === 'nai-diffusion-4-curated-preview' ? 'nai-diffusion-4-curated-inpainting' : model + '-inpainting';
export const DIRECTOR_TOOLS: Record<string, string> = { 'bg-removal': '去背景', lineart: '线稿', sketch: '素描', colorize: '上色', emotion: '换表情', declutter: '去杂物', 'declutter-keep-bubbles': '去杂物留气泡' };
export const EMOTIONS: [string, string][] = [['neutral', '平静'], ['happy', '开心'], ['sad', '难过'], ['angry', '生气'], ['scared', '害怕'], ['surprised', '惊讶'], ['tired', '疲惫'], ['excited', '兴奋'], ['nervous', '紧张'], ['thinking', '思考'], ['confused', '困惑'], ['shy', '害羞'], ['disgusted', '嫌弃'], ['smug', '得意'], ['bored', '无聊'], ['laughing', '大笑'], ['irritated', '烦躁'], ['aroused', '动情'], ['embarrassed', '尴尬'], ['worried', '担心'], ['love', '爱慕'], ['determined', '坚定'], ['hurt', '受伤'], ['playful', '调皮']];
export const UPSCALE_MAX = 4096;
export const upscaleBy = (w: number, h: number) => w * 2 <= UPSCALE_MAX && h * 2 <= UPSCALE_MAX ? 2 : 0;
export const upscaleBody = (image: string) => ({ image, model: 'nai-diffusion-5-curated', declared_blur_sigma: 0 });
export function augmentBody(o: { tool: string; image: string; width: number; height: number; prompt?: string; mood?: string; defry?: number }) {
  if (!DIRECTOR_TOOLS[o.tool]) throw new Error('没有这个导演工具');
  const words = String(o.prompt || '').trim(), level = Math.max(0, Math.min(5, Math.round(Number(o.defry) || 0)));
  return { image: o.image, width: o.width, height: o.height, req_type: o.tool, ...(o.tool === 'emotion' ? { prompt: `${o.mood || 'neutral'};;${words}`, defry: level } : o.tool === 'colorize' ? { prompt: words, defry: level } : {}) };
}
const clampTo = (v: unknown, min: number, max: number, fallback: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };

/* ───────── 提示词：按官网的拼法 ───────── */
const TEXT_MARK = /(?:^|\s|[,.:[\]{}、。])text:(?!:)/i;
export function splitPromptMix(prompt: string): string[] {
  const open = '\u{103B9}', close = '\u{12137}';
  const parts = String(prompt).split('||').map((part, i) => i % 2 ? part.split('|').join(open) : part).join(close).split('|');
  const out = parts.slice(0, 5);
  if (parts.length > 5) out.push(parts.slice(5).join('|'));
  return out.map(part => part.split(open).join('|').split(close).join('||'));
}
const joinWords = (a: string, b: string) => a ? `${a}, ${b}` : b;
export function withQuality(prompt: string, model: string, id: string, transparent = false): string {
  const f = naiFeatures(model);
  let words = qualityPresets(model).find(q => q.id === id)?.words || '';
  if (transparent && f.transparent && !/transparent background/i.test(prompt)) words = words ? `transparent background, ${words}` : 'transparent background';
  if (!words) return prompt;
  if (!f.captions) return String(prompt).split('|').map(part => { const weight = part.match(/(:[\d.]+$)/)?.[0] || ''; return joinWords(weight ? part.slice(0, -weight.length) : part, words) + weight; }).join('|');
  const parts = splitPromptMix(prompt), base = parts[0], mark = base.match(TEXT_MARK);
  parts[0] = mark && mark.index !== undefined ? joinWords(base.slice(0, mark.index), words) + base.slice(mark.index) : joinWords(base, words);
  return parts.join('|');
}
export function withUcPreset(model: string, id: string, prompt: string, negative: string): string {
  const f = naiFeatures(model), list = ucPresets(model), preset = list.find(u => u.id === id) || list.find(u => u.id === 'none')!;
  const words = preset.words, nsfw = !/curated/.test(model) && preset.id !== 'none' && words !== '' && !String(prompt).toLowerCase().includes('nsfw');
  if (f.captions) {
    const out = String(negative).split('|').map((part, i) => i !== 0 || words === '' ? part : part === '' ? words : `${words}, ${part}`).join('|');
    return nsfw ? `nsfw, ${out}` : out;
  }
  const head = preset.id === 'none' ? '' : words, out = negative ? (head ? `${head}, ${negative}` : negative) : words;
  return nsfw ? (out ? `nsfw, ${out}` : 'nsfw') : out;
}
const withMode = (prompt: string, mode: string) => mode === 'anime' || /^(fur|background) dataset/.test(prompt) ? prompt : `${mode === 'furry' ? 'fur' : 'background'} dataset, ${prompt}`;
const QUOTES: Record<string, string> = { '"': '"', '“': '”', '「': '」', "'": "'", '‘': '’' };
function quotedWords(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length;) {
    const end = QUOTES[text[i]];
    if (end === undefined || (text[i] === "'" && i > 0 && !/[\s,.]/.test(text[i - 1]))) { i++; continue; }
    const loose = end === "'" || end === '’';
    let j = i + 1;
    while (j < text.length && (text[j] !== end || (loose && /[\p{L}\p{N}]/u.test(text[j + 1] ?? '')))) j++;
    if (j >= text.length) { i++; continue; }
    const words = text.slice(i + 1, j).trim();
    if (words) out.push(words);
    i = j + 1;
  }
  return out;
}
function withAutoText(prompt: string, characters: { prompt: string }[] = []): string {
  if (TEXT_MARK.test(prompt) || characters.some(c => TEXT_MARK.test(c.prompt))) return prompt;
  const parts = splitPromptMix(prompt), lists = [quotedWords(parts[0] ?? ''), ...characters.map(c => quotedWords(c.prompt))], all = lists.flat();
  if (!all.length) return prompt;
  const cjk = all.join('').match(/[　-〿぀-ゟ゠-ヿ＀-ﾟ一-龯㐀-䶿]/gu)?.length || 0;
  if (cjk / all.join('').length > .3) for (const list of lists) list.reverse();
  const base = (parts[0] ?? '').replace(/[\s,]+$/, ''), text = `teXt: ${lists.flat().join('\n\n')}`;
  parts[0] = base ? `${base}, ${text}` : text;
  return parts.join('|');
}

export interface DrawCharacter { prompt: string; negative?: string; position?: number; center?: { x: number; y: number }; enabled?: boolean; name?: string }
export const gridCenter = (index: number) => ({ x: +(.1 + (index % 5) * .2).toFixed(1), y: +(.1 + Math.floor(index / 5) * .2).toFixed(1) });
export function finalWords(o: { prompt?: string; negative?: string; characters?: DrawCharacter[]; params?: Partial<DrawParams> }) {
  const p = normalizeDrawParams(o.params), f = naiFeatures(p.model), medium = p.effort === 'medium';
  const chars = (o.characters || []).filter(c => c.enabled !== false && String(c.prompt || '').trim()).map(c => ({ ...c, negative: medium ? '' : (c.negative || '') }));
  let text = withQuality(o.prompt || '', p.model, p.quality, p.transparent);
  const uc = medium ? withUcPreset(p.model, 'heavy', text, '') : withUcPreset(p.model, p.ucPreset, text, o.negative || '');
  text = withMode(text, p.mode);
  if (f.autoText) text = withAutoText(text, chars);
  const theirs = f.captions ? '' : chars.map(c => String(c.negative || '').trim()).filter(Boolean).join(', ');
  return { prompt: text, negative: theirs ? [uc, theirs].filter(Boolean).join(', ') : uc, characters: chars };
}

/* ───────── Vibe ───────── */
export const VIBE_KEYS: Record<string, string> = { 'nai-diffusion-4-5-full': 'v4-5full', 'nai-diffusion-4-5-curated': 'v4-5curated', 'nai-diffusion-4-full': 'v4full', 'nai-diffusion-4-curated-preview': 'v4curated' };
export const MAX_FREE_VIBES = 4;
export const VIBE_ANLAS = 2;
export function vibeParameters(list: { encoding: string; strength: number }[], normalize = true) {
  const total = list.reduce((s, v) => s + Math.abs(v.strength), 0), scale = normalize && total > 1 ? 1 / total : 1;
  const uuid = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
  return { reference_image_multiple_cached: list.map(v => ({ cache_secret_key: uuid(), data: v.encoding })), reference_strength_multiple: list.map(v => Math.round(v.strength * scale * 1000) / 1000), normalize_reference_strength_multiple: normalize };
}

/* ───────── 拼请求 ───────── */
export interface BaseImage { image: string; width: number; height: number; strength: number; noise: number; mask?: string; enhance?: boolean }
export interface RefImage { image: string; kind: keyof typeof REFERENCE_KINDS; strength: number; fidelity: number }
export function buildImageRequest(o: { prompt: string; negative?: string; characters?: DrawCharacter[]; params: Partial<DrawParams>; vibes?: { encoding: string; strength: number }[]; base?: BaseImage | null; refs?: RefImage[] }) {
  const p = normalizeDrawParams(o.params), f = naiFeatures(p.model), medium = p.effort === 'medium';
  const base = o.base?.image ? o.base : null;
  if (base) { p.width = base.width; p.height = base.height; }
  const action = base ? (base.mask ? 'infill' : 'img2img') : 'generate';
  if (p.sampler === 'ddim_v3' && !medium && [3, 9, 27, 36, 37].includes(p.steps)) throw new Error(`DDIM 用 ${p.steps} 步会出错（NovelAI 的已知问题），换一个步数`);
  const seed = p.seed >= 0 ? p.seed : Math.floor(Math.random() * 4294967295);
  const words = finalWords({ prompt: o.prompt, negative: o.negative, characters: o.characters, params: p }), chars = words.characters;
  let input = words.prompt;
  if (base?.enhance && f.enhanceWords && !input.includes('upscaled, blurry')) { const mark = input.match(TEXT_MARK), add = ', -2::upscaled, blurry::,'; input = mark && mark.index !== undefined ? input.slice(0, mark.index) + add + input.slice(mark.index) : input + add; }
  const steps = medium ? 14 : p.steps, sampler = medium ? 'k_euler_ancestral' : p.sampler;
  const sm = f.smea && sampler !== 'ddim_v3' && !base && (p.smea === 'on' || p.smea === 'dyn' || (p.smea === 'auto' && p.width * p.height >= 2166785));
  const parameters: Record<string, any> = {
    params_version: f.v5 ? 4 : 3, width: p.width, height: p.height, scale: p.scale, sampler, steps, n_samples: 1, seed,
    ucPreset: 0, qualityToggle: p.quality !== 'none', dynamic_thresholding: f.decrisper && p.decrisper, controlnet_strength: 1, legacy: false, add_original_image: false,
    legacy_v3_extend: false, deliberate_euler_ancestral_bug: false, prefer_brownian: true,
    skip_cfg_above_sigma: p.variety && f.variety ? Math.pow(p.width * p.height / REFERENCE_PIXELS, .5) * f.varietySigma : null,
    tag_hint_qt: TAG_HINTS[p.quality] ?? 0, tag_hint_uc_preset: TAG_HINTS[medium ? 'heavy' : p.ucPreset] ?? 0,
    negative_prompt: words.negative,
  };
  if (!medium) parameters.cfg_rescale = p.cfgRescale;
  const schedules = schedulesFor(p.model, sampler);
  if (f.v5) parameters.noise_schedule = 'karras'; else if (schedules.length) parameters.noise_schedule = p.schedule;
  if (f.captions) {
    const snap = (v: number) => [.1, .3, .5, .7, .9][Math.min(4, Math.max(0, Math.floor(5 * v)))];
    const placed = (c: DrawCharacter) => (c.center && Number.isFinite(c.center.x) && Number.isFinite(c.center.y)) || (c.position ?? -1) >= 0;
    const center = (c: DrawCharacter) => {
      if (c.center && Number.isFinite(c.center.x) && Number.isFinite(c.center.y)) return f.freePosition ? { x: clampTo(c.center.x, 0, 1, .5), y: clampTo(c.center.y, 0, 1, .5) } : { x: snap(c.center.x), y: snap(c.center.y) };
      return (c.position ?? -1) >= 0 ? gridCenter(c.position!) : { x: .5, y: .5 };
    };
    const useCoords = chars.some(placed) && (f.positionOne || chars.length > 1);
    Object.assign(parameters, {
      use_coords: useCoords,
      characterPrompts: chars.map(c => ({ prompt: c.prompt, uc: c.negative || '', center: center(c), enabled: true })),
      v4_prompt: { caption: { base_caption: input, char_captions: chars.map(c => ({ char_caption: c.prompt, centers: [center(c)] })) }, use_coords: useCoords, use_order: true },
      v4_negative_prompt: { caption: { base_caption: words.negative, char_captions: chars.map(c => ({ char_caption: c.negative || '', centers: [center(c)] })) }, legacy_uc: !!p.legacyUc },
    });
    if (p.legacyUc) parameters.legacy_uc = true;
  } else {
    const extra = chars.map(c => c.prompt).filter(Boolean).join(', ');
    input = [input, extra].filter(Boolean).join(', ');
    Object.assign(parameters, { sm, sm_dyn: sm && p.smea === 'dyn' });
  }
  const director = f.reference ? (o.refs || []).filter(r => r?.image) : [];
  if (director.length) Object.assign(parameters, {
    director_reference_images: director.map(r => r.image),
    director_reference_descriptions: director.map(r => ({ caption: { base_caption: REFERENCE_KINDS[r.kind] || REFERENCE_KINDS.character, char_captions: [] }, legacy_uc: false })),
    director_reference_strength_values: director.map(r => clampTo(r.strength, -1, 1, .6)),
    director_reference_secondary_strength_values: director.map(r => +(1 - clampTo(r.fidelity, -1, 1, .5)).toFixed(3)),
    director_reference_information_extracted: director.map(() => 1),
  });
  else if (o.vibes?.length && f.vibes && action !== 'infill') Object.assign(parameters, vibeParameters(o.vibes));
  if (base) {
    const strength = clampTo(base.strength, .01, action === 'infill' ? 1 : .99, .7);
    Object.assign(parameters, {
      image: base.image, strength: Math.min(strength, .99), add_original_image: true, extra_noise_seed: Math.max(0, seed - 1),
      ...(action === 'infill' ? { mask: base.mask, ...(f.inpaintStrength && strength < 1 ? { img2img: { strength, color_correct: true } } : {}) } : { noise: clampTo(base.noise, 0, .99, 0), ...(base.enhance ? { color_correct: false } : {}) }),
    });
  }
  if (p.transparent) Object.assign(parameters, { straight_alpha: true, tag_hint_transparent_background: true });
  const model = medium ? 'nai-diffusion-5-full-medium' : p.model;
  return { body: { input, model: action === 'infill' ? inpaintModel(model) : model, action, parameters }, seed, params: { ...p, steps, sampler }, refs: director.length };
}

/* ───────── 传输 ───────── */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;
const COOLDOWN = 6000;
let workerTooOld = false;

/** 一次一个；会出图的请求两次之间至少 6 秒 */
export function exclusive<T>(fn: () => Promise<T>, cooldown = true): Promise<T> {
  const run = async () => {
    if (cooldown) { const wait = COOLDOWN - (Date.now() - lastCall); if (wait > 0) await sleep(wait); }
    try { return await fn(); } finally { if (cooldown) lastCall = Date.now(); }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

const keyHeader = () => {
  const k = loadNaiConfig().key.replace(/^bearer\s+/i, '').trim();
  if (!k) throw new Error('还没填 NovelAI 的 Key（设置 → API 总览 → NovelAI 生图）');
  return `Bearer ${k}`;
};
const DIRECT: Record<string, string> = { '/ai/upscale': 'https://api.novelai.net', '/user/subscription': 'https://api.novelai.net' };
function failure(status: number, text: string) {
  const msg = status === 401 ? 'NovelAI Key 无效或过期' : status === 402 ? 'Anlas 不足，或这个订阅不支持这次生成' : status === 429 ? 'NovelAI 账号正忙（可能同一个 Key 在别处出图），稍后再试'
    : status === 400 ? 'NovelAI 拒绝了这次请求：' + (text || '参数无效').slice(0, 160) : `NovelAI 暂时不可用（${status}）`;
  return Object.assign(new Error(msg), { status });
}
/** path 如 /ai/generate-image；先走自己的 Worker，Worker 太旧就直连 */
export async function naiFetch(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; query?: string; signal?: AbortSignal } = {}): Promise<Response> {
  const method = init.method || 'POST';
  const headers: Record<string, string> = { Authorization: keyHeader() };
  if (method === 'POST') headers['Content-Type'] = 'application/json';
  const body = method === 'POST' ? JSON.stringify(init.body ?? {}) : undefined;
  const q = init.query || '';
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response | null = null;
    const worker = getProxyWorkerUrl();
    if (worker && !workerTooOld) {
      try { res = await fetch(`${worker}/nai/x${path}${q}`, { method, headers, body, signal: init.signal }); } catch (e: any) { if (e?.name === 'AbortError') throw e; res = null; }
      if (res && (res.status === 404 || res.status === 405)) { workerTooOld = true; res = null; }   // 旧 Worker：没有 /nai/x，改直连
    }
    if (!res) {
      try { res = await fetch(`${DIRECT[path] || 'https://image.novelai.net'}${path}${q}`, { method, headers, body, signal: init.signal }); }
      catch (e: any) { if (e?.name === 'AbortError') throw e; throw new Error('连不上 NovelAI：检查网络（直连要挂梯子），或更新一下自己的 Worker'); }
    }
    if (res.ok) return res;
    if (res.status === 429 && attempt < 2) { await sleep((attempt + 1) * 6000); continue; }
    throw failure(res.status, await res.text().catch(() => ''));
  }
  throw new Error('NovelAI 重试几次都不行');
}

/* ───────── 解压 ───────── */
export async function unzipImages(buffer: ArrayBuffer, limit = Infinity): Promise<Blob[]> {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer), found: Blob[] = [];
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return [new Blob([bytes], { type: 'image/png' })];
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('NovelAI 返回的内容认不出来');
  let at = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true), extraLength = view.getUint16(at + 30, true), commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (!/\.(png|webp|jpe?g)$/i.test(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.slice(start, start + size);
    const type = /\.webp$/i.test(name) ? 'image/webp' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/png';
    if (method === 0) found.push(new Blob([data], { type }));
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      found.push(new Blob([await new Response(stream).arrayBuffer()], { type }));
    } else throw new Error('NovelAI 返回的压缩格式不支持');
    if (found.length >= limit) return found;
  }
  if (!found.length) throw new Error('NovelAI 返回的压缩包里没有图片');
  return found;
}

/* ───────── 对外：几种请求 ───────── */
export async function naiGenerate(body: unknown, signal?: AbortSignal): Promise<Blob> {
  return exclusive(async () => (await unzipImages(await (await naiFetch('/ai/generate-image', { body, signal })).arrayBuffer(), 1))[0]);
}
export async function naiAugment(body: unknown, signal?: AbortSignal): Promise<Blob[]> {
  return exclusive(async () => unzipImages(await (await naiFetch('/ai/augment-image', { body, signal })).arrayBuffer()));
}
export async function naiUpscale(body: unknown, signal?: AbortSignal): Promise<Blob> {
  return exclusive(async () => (await unzipImages(await (await naiFetch('/ai/upscale', { body, signal })).arrayBuffer(), 1))[0]);
}
/** 把一张图编成某个模型的 Vibe（2 Anlas），返回 base64 编码 */
export async function naiEncodeVibe(image: string, model: string, informationExtracted: number, signal?: AbortSignal): Promise<string> {
  return exclusive(async () => {
    const res = await naiFetch('/ai/encode-vibe', { body: { image, information_extracted: informationExtracted, model }, signal });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 100) throw new Error('Vibe 编码结果不对，可能是 NovelAI 返回了错误');
    let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
  });
}
export async function naiSubscription(signal?: AbortSignal): Promise<NaiSubscription> {
  return readSubscription(await (await naiFetch('/user/subscription', { method: 'GET', signal })).json());
}
export async function naiSuggestTags(model: string, word: string, signal?: AbortSignal): Promise<{ tag: string; count: number }[]> {
  const w = String(word || '').replace(/[/[{}\]]/g, '').trim();
  if (!w) return [];
  const v5 = isV5(model);
  const res = await naiFetch('/ai/generate-image/suggest-tags', { method: 'GET', signal, query: `?model=${encodeURIComponent(model)}&prompt=${encodeURIComponent(w)}${v5 ? '&type=animev5' : ''}` });
  const data = await res.json().catch(() => ({}));
  return (Array.isArray(data?.tags) ? data.tags : []).map((t: any) => ({ tag: String(t.tag || ''), count: Number(t.count) || 0 })).filter((t: { tag: string }) => t.tag);
}

/* ───────── 图片小工具 ───────── */
export const blobToBase64 = (b: Blob): Promise<string> => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
export async function imageSize(b: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(b); const out = { width: bmp.width, height: bmp.height }; bmp.close?.(); return out;
}
/** 把图缩放 / 补黑边到 w×h，返回 PNG base64 */
export async function fitImage(b: Blob, w: number, h: number, mode: 'cover' | 'contain' = 'contain', fill = '#000'): Promise<string> {
  const bmp = await createImageBitmap(b);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!; g.fillStyle = fill; g.fillRect(0, 0, w, h);
  const k = mode === 'cover' ? Math.max(w / bmp.width, h / bmp.height) : Math.min(w / bmp.width, h / bmp.height);
  const dw = bmp.width * k, dh = bmp.height * k;
  g.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh); bmp.close?.();
  return c.toDataURL('image/png').replace(/^data:[^,]*,/, '');
}
/** 底图：按原图形状挑一个 64 倍数、不超过像素上限的尺寸 */
export function baseSizeFor(w: number, h: number, maxPixels = FREE_PIXELS): { width: number; height: number } {
  const k = Math.min(1, Math.sqrt(maxPixels / (w * h)));
  return { width: Math.max(64, Math.round(w * k / 64) * 64), height: Math.max(64, Math.round(h * k / 64) * 64) };
}
/** 角色参考：按形状放进三种官方尺寸之一 */
export function referenceSizeFor(w: number, h: number): [number, number] {
  const r = w / h; return r < 0.8 ? REFERENCE_SIZES[0] : r > 1.25 ? REFERENCE_SIZES[1] : REFERENCE_SIZES[2];
}

/* ───────── 读图：官网 PNG 里的参数 ───────── */
export async function pngText(buffer: ArrayBuffer): Promise<Record<string, string>> {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer), out: Record<string, string> = {};
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) return out;
  const inflate = async (b: Uint8Array) => new Uint8Array(await new Response(new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at), type = String.fromCharCode(...bytes.subarray(at + 4, at + 8)), data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const zero = data.indexOf(0), key = new TextDecoder('latin1').decode(data.subarray(0, zero));
      let text = data.subarray(zero + 1), wide = false;
      if (type === 'iTXt') { const compressed = text[0], rest = text.subarray(2), lang = rest.indexOf(0), trans = rest.indexOf(0, lang + 1); text = rest.subarray(trans + 1); wide = true; if (compressed) text = await inflate(text); }
      else if (type === 'zTXt') text = await inflate(text.subarray(1));
      let s = new TextDecoder(wide ? 'utf-8' : 'latin1').decode(text);
      if (!wide) try { s = new TextDecoder('utf-8', { fatal: true }).decode(text); } catch { /* latin1 */ }
      out[key] = s;
    }
    if (type === 'IEND') break;
    at += 12 + length;
  }
  return out;
}
export interface ReadBack { prompt: string; negative: string; characters: DrawCharacter[]; params: Partial<DrawParams> }
/** NovelAI 下载的原图：tEXt「Comment」里是 JSON 参数；读不到返回 null */
export async function readNaiPng(file: Blob): Promise<ReadBack | null> {
  const t = await pngText(await file.arrayBuffer());
  let c: any = null;
  try { c = JSON.parse(t.Comment || ''); } catch { return null; }
  if (!c || typeof c !== 'object') return null;
  const v4 = c.v4_prompt?.caption, v4n = c.v4_negative_prompt?.caption;
  const chars: DrawCharacter[] = (v4?.char_captions || []).map((x: any, i: number) => ({
    prompt: String(x.char_caption || ''), negative: String(v4n?.char_captions?.[i]?.char_caption || ''),
    ...(x.centers?.[0] ? { center: { x: Number(x.centers[0].x), y: Number(x.centers[0].y) } } : {}),
  }));
  const model = String(t.Source || '').match(/NAI Diffusion V(\d)(?:\.(\d))?/i);
  const modelId = model ? (model[1] === '5' ? 'nai-diffusion-5-full' : model[1] === '4' && model[2] === '5' ? 'nai-diffusion-4-5-full' : model[1] === '4' ? 'nai-diffusion-4-full' : 'nai-diffusion-3') : undefined;
  return {
    prompt: String(v4?.base_caption ?? c.prompt ?? t.Description ?? ''),
    negative: String(v4n?.base_caption ?? c.uc ?? ''),
    characters: chars,
    params: {
      ...(modelId ? { model: modelId } : {}),
      width: Number(c.width) || undefined, height: Number(c.height) || undefined, steps: Number(c.steps) || undefined, scale: Number(c.scale) || undefined,
      sampler: c.sampler || undefined, schedule: c.noise_schedule || undefined, seed: Number.isFinite(Number(c.seed)) ? Number(c.seed) : undefined,
      cfgRescale: Number(c.cfg_rescale) || 0,
    } as Partial<DrawParams>,
  };
}
