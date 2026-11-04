/**
 * 「恨你」计数器：数你在聊天里对角色说了多少次「恨你 / 讨厌你 / I hate you」。
 * 全量统计在页脚里算（扫整个聊天记录），聊天提示词只用当前窗口算今天的次数，再加上缓存的总数。
 */
import type { Message } from '../types';

export const HATE_RE = /恨你|恨死你|讨厌你|讨厌死你|i\s*hate\s*(?:you|u)\b|hate\s*(?:you|u)\b/gi;
const CACHE_KEY = 'sully_hate_counter_v1';

const isText = (m: Message) => (m.type || 'text') === 'text' && typeof m.content === 'string';
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const countHate = (text: string) => (String(text || '').match(HATE_RE) || []).length;

export interface HateStats {
  total: number; today: number; days: number; longestStreak: number; currentStreak: number;
  byDay: Record<string, number>;
  recent: { text: string; at: number; reply?: string }[];
  firstAt?: number;
}

export function computeHateStats(messages: Message[], now = Date.now()): HateStats {
  const byDay: Record<string, number> = {};
  const recent: HateStats['recent'] = [];
  let total = 0, firstAt: number | undefined;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'user' || !isText(m)) continue;
    const n = countHate(m.content);
    if (!n) continue;
    total += n;
    const k = dayKey(m.timestamp);
    byDay[k] = (byDay[k] || 0) + n;
    firstAt = firstAt ?? m.timestamp;
    let reply: string | undefined;
    for (let j = i + 1; j < messages.length && j < i + 6; j++) {
      if (messages[j].role === 'assistant' && isText(messages[j])) { reply = String(messages[j].content).slice(0, 120); break; }
      if (messages[j].role === 'user') break;
    }
    recent.push({ text: String(m.content).slice(0, 120), at: m.timestamp, reply });
  }
  // 连续天数
  const days = Object.keys(byDay).sort();
  let longest = 0, run = 0, prev = '';
  for (const d of days) {
    const p = new Date(prev); p.setDate(p.getDate() + 1);
    run = prev && dayKey(p.getTime()) === d ? run + 1 : 1;
    longest = Math.max(longest, run); prev = d;
  }
  let current = 0;
  const c = new Date(now);
  if (!byDay[dayKey(c.getTime())]) c.setDate(c.getDate() - 1);
  while (byDay[dayKey(c.getTime())]) { current++; c.setDate(c.getDate() - 1); }
  return { total, today: byDay[dayKey(now)] || 0, days: days.length, longestStreak: longest, currentStreak: current, byDay, recent: recent.reverse().slice(0, 30), firstAt };
}

export const saveHateTotal = (charId: string, total: number) => {
  try { const m = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); m[charId] = { total, at: Date.now() }; localStorage.setItem(CACHE_KEY, JSON.stringify(m)); } catch { /* ignore */ }
};
const loadHateTotal = (charId: string): number => {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')[charId]?.total || 0; } catch { return 0; }
};

/** 聊天提示词：今天说了几次（只看当前窗口），总共多少次（页脚算过的缓存） */
export function buildHateBlock(charId: string, userName: string, currentMsgs: Message[], now = Date.now()): string {
  const today = dayKey(now);
  const n = (currentMsgs || []).filter(m => m.role === 'user' && isText(m) && dayKey(m.timestamp) === today).reduce((s, m) => s + countHate(m.content), 0);
  if (!n) return '';
  const total = Math.max(loadHateTotal(charId), n);
  return `### 【「恨你」计数】\n${userName || '对方'} 今天已经对你说了 ${n} 次「恨你」${total > n ? `（认识以来一共 ${total} 次）` : ''}。你心里有数就好，偶尔拿来逗 ta，不用每次都报数。`;
}
