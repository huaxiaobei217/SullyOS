/**
 * 旧账本（个人二改）：诺亚爱翻旧账——「翻旧账只是情趣手段」。
 * 每天第一次聊天时，在后台翻一遍聊天记录，找出「一周前 / 一个月前 / 三个月前 / 半年前 / 一年前的今天」你们说过的几句，
 * 存成当天的小抄；之后每轮聊天把小抄作为背景带上，他想翻旧账时手里有真东西，不用编。
 * 只在本机算，一天只翻一次全量记录。
 */
import { DB } from './db';

const LS_ON = 'sully_old_ledger_on_v1';
const LS_CACHE = 'sully_old_ledger_cache_v1';

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export const isOldLedgerOn = (charId: string): boolean => {
  try { const m = JSON.parse(localStorage.getItem(LS_ON) || '{}'); return m[charId] === true; } catch { return false; }
};
export const setOldLedgerOn = (charId: string, on: boolean) => {
  try { const m = JSON.parse(localStorage.getItem(LS_ON) || '{}'); m[charId] = on; localStorage.setItem(LS_ON, JSON.stringify(m)); } catch { /* ignore */ }
};

interface Cache { [charId: string]: { day: string; text: string } }
const readCache = (): Cache => { try { return JSON.parse(localStorage.getItem(LS_CACHE) || '{}') || {}; } catch { return {}; } };
const writeCache = (c: Cache) => { try { localStorage.setItem(LS_CACHE, JSON.stringify(c)); } catch { /* ignore */ } };

const AGO: { label: string; back: (d: Date) => Date }[] = [
  { label: '一年前的今天', back: d => new Date(d.getFullYear() - 1, d.getMonth(), d.getDate()) },
  { label: '半年前的今天', back: d => new Date(d.getFullYear(), d.getMonth() - 6, d.getDate()) },
  { label: '三个月前的今天', back: d => new Date(d.getFullYear(), d.getMonth() - 3, d.getDate()) },
  { label: '一个月前的今天', back: d => new Date(d.getFullYear(), d.getMonth() - 1, d.getDate()) },
  { label: '一周前的今天', back: d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7) },
];

const clean = (s: string) => s.replace(/\[[^\]]{0,40}\]/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
// 挑「有内容」的句子：别太短（嗯、好），别太长，不是系统 / 卡片
const goodLine = (s: string) => s.length >= 6 && s.length <= 60 && !/^(https?:|\{|\[)/.test(s);

const inFlight = new Set<string>();

async function compute(charId: string, userName: string, charName: string): Promise<string> {
  const all: any[] = await DB.getMessagesByCharId(charId, true);
  const byDay = new Map<string, any[]>();
  for (const m of all) {
    if ((m.type || 'text') !== 'text' || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const k = dayKey(m.timestamp || 0);
    const arr = byDay.get(k); if (arr) arr.push(m); else byDay.set(k, [m]);
  }
  const now = new Date();
  const parts: string[] = [];
  for (const a of AGO) {
    const d = a.back(now);
    const k = dayKey(d.getTime());
    const msgs = byDay.get(k);
    if (!msgs || msgs.length < 4) continue;
    const mine = msgs.filter(m => m.role === 'user').map(m => clean(String(m.content || ''))).filter(goodLine);
    const his = msgs.filter(m => m.role === 'assistant').map(m => clean(String(m.content || ''))).filter(goodLine);
    if (!mine.length) continue;
    // 挑她说的最长的两句、他说的一句（长一点的通常更有内容）
    const pick = (xs: string[], n: number) => [...xs].sort((x, y) => y.length - x.length).slice(0, n);
    const lines = [`- ${a.label}（${d.getMonth() + 1}月${d.getDate()}日）：${userName}说过「${pick(mine, 2).join('」「')}」${his.length ? `；你回过「${pick(his, 1)[0]}」` : ''}`];
    parts.push(lines.join(''));
    if (parts.length >= 3) break;
  }
  if (!parts.length) return '';
  return `### 旧账本（你们以前这一天说过的话，原话）
${parts.join('\n')}
这本账平时当它不存在：你活在当下，不复述她说过的话，不回顾「那天我们聊了什么」，更不说「X 个月前的今天」这种日历腔。
只有两种时候才可能翻一句：她嘴硬、否认自己说过的话或做过的事，你拿原话堵她；或者她提到别的男生让你吃醋，你翻一句她以前的话将她一军。一天最多一次，只能引用上面的原话，别编。`;
}

/** 给聊天用：有今天的小抄就返回；没有就在后台算，这一轮先不带 */
export function buildOldLedgerBlock(charId: string, userName: string, charName: string): string {
  if (!isOldLedgerOn(charId)) return '';
  const today = dayKey(Date.now());
  const c = readCache()[charId];
  if (c && c.day === today) return c.text;
  if (!inFlight.has(charId)) {
    inFlight.add(charId);
    compute(charId, userName, charName)
      .then(text => { const all = readCache(); all[charId] = { day: today, text }; writeCache(all); })
      .catch(() => { /* 下次再算 */ })
      .finally(() => inFlight.delete(charId));
  }
  return '';
}

/** 设置页预览：直接算一遍 */
export async function previewOldLedger(charId: string, userName: string, charName: string): Promise<string> {
  const text = await compute(charId, userName, charName);
  const all = readCache(); all[charId] = { day: dayKey(Date.now()), text }; writeCache(all);
  return text;
}
