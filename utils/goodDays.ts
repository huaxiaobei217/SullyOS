/**
 * 好的那天（个人二改，旧账本的温柔版）：一周 / 一个月 / 三个月前的今天，她说过的心愿、计划、开心的事。
 * 不是拿来堵她的——只有正好接得上现在（她真去做了、又提起了、刚好相关）时，他才轻轻提一句，一天最多一次。
 * 每天算一次存起来；算的时候只读本机聊天记录，不花调用。
 */
import { DB } from './db';

const LS_ON = 'sully_good_days_on_v1';
const LS_CACHE = 'sully_good_days_cache_v1';
const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export const isGoodDaysOn = (charId: string) => { try { return JSON.parse(localStorage.getItem(LS_ON) || '{}')[charId] !== false; } catch { return true; } };
export const setGoodDaysOn = (charId: string, on: boolean) => { try { const a = JSON.parse(localStorage.getItem(LS_ON) || '{}'); a[charId] = on; localStorage.setItem(LS_ON, JSON.stringify(a)); } catch { /* ignore */ } };

const AGO: { label: string; back: (d: Date) => Date }[] = [
  { label: '一年前', back: d => new Date(d.getFullYear() - 1, d.getMonth(), d.getDate()) },
  { label: '半年前', back: d => new Date(d.getFullYear(), d.getMonth() - 6, d.getDate()) },
  { label: '三个月前', back: d => new Date(d.getFullYear(), d.getMonth() - 3, d.getDate()) },
  { label: '一个月前', back: d => new Date(d.getFullYear(), d.getMonth() - 1, d.getDate()) },
  { label: '两周前', back: d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 14) },
];
// 心愿、计划、第一次、开心的事
const GOOD = /想(去|学|做|买|试|养|考|吃)|打算|计划|准备(去|学|做|考)|梦想|第一次|学会了|以后要|好想(去|学|做|吃|看)|总有一天/;
const BAD = /不想|讨厌|难过|烦|哭|累死|好累|生气/;
const clean = (s: string) => s.replace(/\[[^\]]{0,40}\]/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function compute(charId: string, userName: string): Promise<string> {
  const all: any[] = await DB.getMessagesByCharId(charId, true);
  const byDay = new Map<string, string[]>();
  for (const m of all) {
    if ((m.type || 'text') !== 'text' || m.role !== 'user') continue;
    const t = clean(String(m.content || ''));
    if (t.length < 8 || t.length > 70 || !GOOD.test(t) || BAD.test(t)) continue;
    const k = dayKey(m.timestamp || 0);
    const arr = byDay.get(k); if (arr) arr.push(t); else byDay.set(k, [t]);
  }
  const now = new Date();
  const parts: string[] = [];
  for (const a of AGO) {
    const d = a.back(now);
    // 前后各放宽一天，免得那天正好没说
    const hits = [-1, 0, 1].flatMap(o => byDay.get(dayKey(d.getTime() + o * 86400000)) || []);
    if (!hits.length) continue;
    const pick = [...new Set(hits)].sort((x, y) => y.length - x.length).slice(0, 2);
    parts.push(`- ${a.label}（${d.getMonth() + 1}月${d.getDate()}日前后）${userName}说过：「${pick.join('」「')}」`);
    if (parts.length >= 3) break;
  }
  if (!parts.length) return '';
  return `### 她以前说过的心愿和开心事（原话，背景）
${parts.join('\n')}
这些不是拿来翻旧账的。只有正好接得上现在——她真的去做了、又提起了、今天的事刚好和它有关——你才轻轻提一句，像「你上个月还说想学做饭，今天居然真做了」，带点得意或心疼都行。接不上就当没看见；一天最多提一次，别编原话，别用日历腔。`;
}

const inFlight = new Set<string>();
export function buildGoodDaysBlock(charId: string, userName: string): string {
  if (!isGoodDaysOn(charId)) return '';
  const today = dayKey(Date.now());
  let cache: Record<string, { day: string; text: string }> = {};
  try { cache = JSON.parse(localStorage.getItem(LS_CACHE) || '{}') || {}; } catch { /* ignore */ }
  const c = cache[charId];
  if (c && c.day === today) return c.text;
  if (!inFlight.has(charId)) {
    inFlight.add(charId);
    compute(charId, userName)
      .then(text => { try { const all = JSON.parse(localStorage.getItem(LS_CACHE) || '{}') || {}; all[charId] = { day: today, text }; localStorage.setItem(LS_CACHE, JSON.stringify(all)); } catch { /* ignore */ } })
      .catch(() => { /* 下次再算 */ })
      .finally(() => inFlight.delete(charId));
  }
  return '';
}
