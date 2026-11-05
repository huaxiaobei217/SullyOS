/**
 * 身体 · 手环数据（个人二改）
 * 荣耀运动健康没有给网页用的接口，所以数据靠两条路进来：
 *  1. 截图识别：在荣耀运动健康里截「睡眠」「步数」「心率」页，丢进来让识图模型读成数字
 *  2. 手动记：几个数字自己填
 * 数据只存本机（localStorage + 镜像 + 二改备份）。打开「让他知道」时，最近两天的数据会以一小段背景带进聊天，
 * 规则写死：他知道就行，不念数据、不当健康顾问、不说教。
 */
import type { APIConfig, CharacterProfile } from '../types';
import { safeFetchJson, extractContent } from './safeApi';
import { describeImageWithVisionApi } from './visionApi';
import { callAsChar } from './footnote';

const LS_LOG = 'sully_body_log_v1';
const LS_INJECT = 'sully_body_inject_v1';
export const BODY_EVENT = 'sully:body-changed';

export interface BodyDay {
  date: string;              // YYYY-MM-DD（用户本地日期；睡眠记在醒来那天）
  steps?: number;
  sleepMin?: number;         // 总睡眠分钟
  deepMin?: number;          // 深睡分钟
  bedtime?: string;          // HH:MM
  wake?: string;             // HH:MM
  restingHr?: number;
  avgHr?: number;
  maxHr?: number;
  stress?: number;           // 荣耀的压力值 1-99
  spo2?: number;             // 血氧 %
  calories?: number;         // 活动热量 kcal
  exerciseMin?: number;      // 中高强度 / 锻炼分钟
  period?: boolean;          // 生理期
  feel?: string;             // 一句话状态（头疼、很累……）
  updatedAt: number;
}

const read = <T,>(k: string, d: T): T => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const dateKey = (t: number | Date = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
export const shiftDate = (key: string, days: number) => { const [y, m, d] = key.split('-').map(Number); return dateKey(new Date(y, m - 1, d + days)); };

export const loadBody = (): Record<string, BodyDay> => read<Record<string, BodyDay>>(LS_LOG, {});
const saveBody = (all: Record<string, BodyDay>) => {
  // 只留最近 400 天
  const keys = Object.keys(all).sort().reverse();
  const kept: Record<string, BodyDay> = {};
  keys.slice(0, 400).forEach(k => { kept[k] = all[k]; });
  write(LS_LOG, kept);
  try { window.dispatchEvent(new Event(BODY_EVENT)); } catch { /* ignore */ }
};

const FIELDS: (keyof BodyDay)[] = ['steps', 'sleepMin', 'deepMin', 'bedtime', 'wake', 'restingHr', 'avgHr', 'maxHr', 'stress', 'spo2', 'calories', 'exerciseMin', 'period', 'feel'];

/** 合并一天的数据：新给的字段覆盖旧的，没给的保留 */
export function upsertBodyDay(date: string, patch: Partial<BodyDay>) {
  const all = loadBody();
  const prev: BodyDay = all[date] || { date, updatedAt: 0 };
  const next: BodyDay = { ...prev, date, updatedAt: Date.now() };
  for (const f of FIELDS) {
    const v = (patch as any)[f];
    if (v === undefined || v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) continue;
    (next as any)[f] = v;
  }
  all[date] = next;
  saveBody(all);
  return next;
}

export function clearBodyField(date: string, field: keyof BodyDay) {
  const all = loadBody();
  if (!all[date]) return;
  delete (all[date] as any)[field];
  all[date].updatedAt = Date.now();
  saveBody(all);
}

export function deleteBodyDay(date: string) {
  const all = loadBody();
  delete all[date];
  saveBody(all);
}

export const isBodyInjectOn = () => read<boolean>(LS_INJECT, true);
export const setBodyInjectOn = (on: boolean) => { write(LS_INJECT, on); try { window.dispatchEvent(new Event(BODY_EVENT)); } catch { /* ignore */ } };

/* ───────── 文字 ───────── */

export const fmtDur = (min?: number) => {
  if (!min && min !== 0) return '';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? (m ? `${h}小时${m}分` : `${h}小时`) : `${m}分钟`;
};

export function describeDay(d: BodyDay): string[] {
  const out: string[] = [];
  if (d.sleepMin) {
    let s = `睡了${fmtDur(d.sleepMin)}`;
    if (d.bedtime || d.wake) s += `（${d.bedtime || '?'} 睡，${d.wake || '?'} 醒）`;
    if (d.deepMin) s += `，深睡${fmtDur(d.deepMin)}`;
    out.push(s);
  } else if (d.bedtime || d.wake) out.push(`${d.bedtime ? d.bedtime + ' 睡' : ''}${d.bedtime && d.wake ? '，' : ''}${d.wake ? d.wake + ' 醒' : ''}`);
  if (d.steps != null) out.push(`走了${d.steps.toLocaleString('en-US')}步`);
  if (d.exerciseMin) out.push(`运动${fmtDur(d.exerciseMin)}`);
  if (d.restingHr) out.push(`静息心率${d.restingHr}`);
  if (d.stress) out.push(`压力值${d.stress}${d.stress >= 60 ? '（偏高）' : ''}`);
  if (d.spo2) out.push(`血氧${d.spo2}%`);
  if (d.period) out.push('在生理期');
  if (d.feel) out.push(`她自己记了一句：「${d.feel.slice(0, 40)}」`);
  return out;
}

/** 聊天里的背景块：今天 + 昨天（有数据才出） */
export function buildBodyBlock(userName: string): string {
  if (!isBodyInjectOn()) return '';
  const all = loadBody();
  const today = dateKey();
  const yest = shiftDate(today, -1);
  const lines: string[] = [];
  const t = all[today], y = all[yest];
  if (t) { const ds = describeDay(t); if (ds.length) lines.push(`- 今天（到她上次记录为止）：${ds.join('；')}`); }
  if (y) { const ds = describeDay(y); if (ds.length) lines.push(`- 昨天：${ds.join('；')}`); }
  if (!lines.length) return '';
  return `### ${userName}的身体状况（她手环上的数据，她愿意让你知道）
${lines.join('\n')}
怎么用：你只是心里有数，像住在一起的人自然知道对方昨晚没睡好那样。
- 不念数字，不分析数据，不当健康顾问，不给养生建议，不说教。
- 绝大多数回复里根本不用提；只有正好聊到、或者明显异常（熬到很晚、睡得很少、生理期）时，才顺嘴带一句，用你自己的方式（损一句、心疼一句、塞一样具体的东西都行），说完就过。
- 同一件事说过一次就别再提。`;
}

/* ───────── 截图识别 ───────── */

const SHOT_PROMPT = `这是一张或几张手机运动健康 App（多半是荣耀运动健康）的截图。把截图里能直接看到的数据读出来，只输出一个 JSON 对象，不要任何解释。
字段（看不到的就不要写这个字段，绝不猜）：
{"date":"YYYY-MM-DD（截图上显示的日期；只写了「今天」就不写）","steps":步数,"sleepMin":总睡眠分钟,"deepMin":深睡分钟,"bedtime":"入睡时间 HH:MM","wake":"醒来时间 HH:MM","restingHr":静息心率,"avgHr":平均心率,"maxHr":最高心率,"stress":压力平均值,"spo2":血氧百分比,"calories":活动热量千卡,"exerciseMin":运动或中高强度分钟}
换算：「7小时32分」= 452；睡眠记录跨夜时日期按醒来那天。数字只要数字，不带单位。`;

const parseJsonObj = (t: string): any => {
  const m = String(t || '').replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('没读出数据，换张清楚点的截图试试');
  try { return JSON.parse(m[0]); } catch { throw new Error('没读出数据，换张清楚点的截图试试'); }
};

const num = (v: any) => { const n = typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined; };
const hhmm = (v: any) => { const m = String(v || '').match(/(\d{1,2})[:：](\d{2})/); return m ? `${pad2(Math.min(23, +m[1]))}:${m[2]}` : undefined; };

export function normalizeShot(raw: any): Partial<BodyDay> & { date?: string } {
  const out: Partial<BodyDay> & { date?: string } = {};
  const d = String(raw?.date || '').match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (d) out.date = `${d[1]}-${pad2(+d[2])}-${pad2(+d[3])}`;
  out.steps = num(raw?.steps);
  out.sleepMin = num(raw?.sleepMin);
  out.deepMin = num(raw?.deepMin);
  out.bedtime = hhmm(raw?.bedtime);
  out.wake = hhmm(raw?.wake);
  out.restingHr = num(raw?.restingHr);
  out.avgHr = num(raw?.avgHr);
  out.maxHr = num(raw?.maxHr);
  out.stress = num(raw?.stress);
  out.spo2 = num(raw?.spo2);
  out.calories = num(raw?.calories);
  out.exerciseMin = num(raw?.exerciseMin);
  // 明显读错的丢掉
  if (out.sleepMin && out.sleepMin > 20 * 60) delete out.sleepMin;
  if (out.restingHr && (out.restingHr < 30 || out.restingHr > 150)) delete out.restingHr;
  if (out.spo2 && (out.spo2 < 70 || out.spo2 > 100)) delete out.spo2;
  if (out.steps && out.steps > 150000) delete out.steps;
  return out;
}

/** 读一张截图：开了识图模型就用识图模型，没开就把图交给聊天模型 */
export async function readHealthShot(dataUrl: string, api: APIConfig): Promise<Partial<BodyDay> & { date?: string }> {
  const vision = (api as any)?.visionApi;
  let text = '';
  if (vision?.enabled && vision.baseUrl && vision.apiKey && vision.model) {
    text = await describeImageWithVisionApi(dataUrl, vision, { prompt: SHOT_PROMPT });
  } else {
    if (!api?.baseUrl || !api.model) throw new Error('先在设置里配好 API（或者打开识图模型）');
    const data = await safeFetchJson(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` },
      body: JSON.stringify({
        model: api.model, temperature: 0, max_tokens: 400, stream: false,
        messages: [{ role: 'user', content: [{ type: 'text', text: SHOT_PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }],
      }),
    }, 0, 0, { appName: '身体', purpose: '读手环截图' });
    text = extractContent(data);
  }
  return normalizeShot(parseJsonObj(text));
}

/** 把图片压一压再送去识别（截图很大，压到长边 1600） */
export async function fileToDataUrl(file: File, maxSide = 1600): Promise<string> {
  const raw: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('读不了这张图')); r.readAsDataURL(file); });
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = raw; });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    if (scale >= 1 && raw.length < 1_500_000) return raw;
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } catch { return raw; }
}

/* ───────── 他看一眼 ───────── */

export async function noahGlance(char: CharacterProfile, api: APIConfig, userName: string): Promise<string> {
  const all = loadBody();
  const today = dateKey();
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const k = shiftDate(today, -i);
    const d = all[k];
    if (d) { const ds = describeDay(d); if (ds.length) days.push(`${i === 0 ? '今天' : i === 1 ? '昨天' : `${i}天前`}：${ds.join('；')}`); }
  }
  if (!days.length) throw new Error('还没有数据，先记一点');
  const { text } = await callAsChar(char, api,
    `### 【手环】
${userName}把她手环上这几天的数据给你看了：
${days.join('\n')}
你用发消息的口吻回她 1～3 句，就像她把手机屏幕怼到你面前问「你看」。
- 只挑一件最显眼的事说（比如熬夜、走得特别多、某天睡得特别好），别逐项点评，别念数字串。
- 你不是医生也不是健康教练，不给养生方案，不说教；该损就损，该心疼就心疼，可以顺手提一个具体的小东西（今晚几点赶她去睡、周末拉她去哪走走）。
- 只输出你要发的话，一句一行，不加引号和动作描写。`,
    '（她把手环数据给你看）', '身体·他看一眼', 400);
  return text.replace(/^["“]|["”]$/g, '').trim();
}

/** 他看完说的话，作为他发来的消息放进私聊（一行一条） */
export async function sendGlanceToChat(charId: string, text: string) {
  const { DB } = await import('./db');
  const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean).slice(0, 4);
  for (const line of lines) await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: line } as any);
}
