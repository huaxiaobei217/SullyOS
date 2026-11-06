/**
 * 角色偶尔出趟门（个人二改）：
 * 平时就在自己城市过日子；隔一阵（冷却 ≥ 3 周，之后每天小概率）日程生成时允许他「决定」安排一次短途出行
 * ——出差、看展、回家、陪朋友、演出……由模型按人设和最近的事自己定，大多数时候不安排。
 * 决定后提前几天就开始在日程里出现准备（订票、收拾行李），出门那几天日程写在当地，
 * 聊天里他知道自己在哪、可以随口跟你分享见闻，最后一天回程。
 * 不额外调用模型：决定和行程都夹在每天那一次日程生成里。
 */
import type { CharacterProfile } from '../types';

const LS = 'sully_char_trip_v1';
const COOLDOWN_DAYS = 21;
const DAILY_CHANCE = 0.12;

export interface CharTrip {
  destination: string;
  reason: string;
  startDate: string;   // YYYY-MM-DD（角色所在地日历）
  endDate: string;
  decidedOn: string;
}
interface TripState {
  enabled?: boolean;
  trip?: CharTrip;
  lastEnd?: string;      // 上一趟回来的日子
  rolledOn?: string;     // 今天已经掷过骰子（重新生成日程不重复掷）
  rolled?: boolean;      // 今天掷中了（允许考虑安排）
}

const loadAll = (): Record<string, TripState> => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } };
const load = (charId: string): TripState => loadAll()[charId] || {};
const save = (charId: string, s: TripState) => { try { const all = loadAll(); all[charId] = s; localStorage.setItem(LS, JSON.stringify(all)); } catch { /* ignore */ } };

const dayNum = (key: string) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1) / 86400000; };
const keyOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const addDays = (key: string, n: number) => keyOf(dayNum(key) + n);

export const isTripOn = (charId: string) => load(charId).enabled !== false;
export const setTripOn = (charId: string, on: boolean) => { const s = load(charId); s.enabled = on; if (!on) s.trip = undefined; save(charId, s); };
export const getTrip = (charId: string): CharTrip | undefined => load(charId).trip;
export const cancelTrip = (charId: string) => { const s = load(charId); s.trip = undefined; save(charId, s); };

/** 过期的行程收掉，记下回来的日子 */
const settle = (charId: string, today: string): TripState => {
  const s = load(charId);
  if (s.trip && dayNum(today) > dayNum(s.trip.endDate)) { s.lastEnd = s.trip.endDate; s.trip = undefined; save(charId, s); }
  return s;
};

const describe = (t: CharTrip, today: string) => {
  const total = dayNum(t.endDate) - dayNum(t.startDate) + 1;
  const n = dayNum(today) - dayNum(t.startDate) + 1;
  return { total, n, until: dayNum(t.startDate) - dayNum(today) };
};

/** 拼进日程生成 prompt 的那段（lifestyle 风格才用） */
export function buildTripSchedulePrompt(char: CharacterProfile, today: string, userName: string): string {
  if (!isTripOn(char.id)) return '';
  const s = settle(char.id, today);
  const t = s.trip;
  if (t) {
    const { total, n, until } = describe(t, today);
    if (until > 0) {
      return `\n\n### 出行安排（已经定好的）\n你 ${t.startDate} 要去${t.destination}（${t.reason}），${t.endDate} 回来，还有 ${until} 天出发。今天的日程照常过，${until <= 2 ? '可以出现收拾行李、确认车票/机票、把手头的事交代掉这类准备' : '可以有一两处顺手为这趟出行做的小准备，不用多'}。`;
    }
    return `\n\n### 你今天不在家\n你这几天在${t.destination}（${t.reason}），今天是第 ${n} 天，共 ${total} 天。${n === total ? '今天要回程，日程里包括路上和到家。' : n === 1 ? '今天出发，日程里包括路上和到了之后。' : ''}日程按当地写：具体的街、店、天气、吃的、遇到的人，别写成旅游攻略。这是去办事 / 去过自己的日子，不是为了打卡；也会累、会无聊、会想家里的床。如果要求填 homePosition，今天（${n === 1 ? '出发之后' : n === total ? '到家之前' : '全天'}）一律写 {"kind":"away"}，location 写当地地名。\n不要在 JSON 里输出 trip 字段。`;
  }
  // 没有行程：冷却期过了、今天又掷中，才让他考虑要不要安排一趟
  if (s.rolledOn !== today) {
    const cooled = !s.lastEnd || dayNum(today) - dayNum(s.lastEnd) >= COOLDOWN_DAYS;
    s.rolledOn = today; s.rolled = cooled && Math.random() < DAILY_CHANCE; save(char.id, s);
  }
  if (!s.rolled) return '';
  return `\n\n### 可选：要不要安排一次短途出门\n真人不会一直待在一个城市。如果按你的人设、工作、家人朋友和最近聊到的事，接下来这一两周有理由出门一趟（出差、看展/演出、回家看看、陪朋友、临时想换个地方待两天……），可以现在决定，在 JSON 顶层加一个字段：\n"trip": { "destination": "去哪（具体城市/地方）", "reason": "为什么去，一句话", "startInDays": 2到10的整数, "days": 1到4的整数 }\n要求：目的地优先你所在国家或邻近、时差不大的地方；理由要像你会做的事，不要为了浪漫或给${userName}惊喜而编。没有合适理由就不要加这个字段——大多数时候都不加。今天的日程本身照常写，不用因为这个改。`;
}

/** 日程生成完，把模型给的 trip 存下来 */
export function acceptTripFromSchedule(charId: string, today: string, raw: unknown): void {
  if (!isTripOn(charId) || !raw || typeof raw !== 'object') return;
  const s = load(charId);
  if (s.trip || !s.rolled || s.rolledOn !== today) return;
  const r = raw as any;
  const destination = String(r.destination || '').trim().slice(0, 40);
  if (!destination) return;
  const startIn = Math.min(10, Math.max(1, Math.round(Number(r.startInDays) || 3)));
  const days = Math.min(4, Math.max(1, Math.round(Number(r.days) || 2)));
  const startDate = addDays(today, startIn);
  s.trip = { destination, reason: String(r.reason || '').trim().slice(0, 80) || '有点事', startDate, endDate: addDays(startDate, days - 1), decidedOn: today };
  s.rolled = false;
  save(charId, s);
}

/** 聊天 / 主动消息里给他看的：他知道自己在哪 */
export function buildTripChatBlock(char: CharacterProfile, today: string, userName: string): string {
  if (!isTripOn(char.id)) return '';
  const t = settle(char.id, today).trip;
  if (!t) return '';
  const { total, n, until } = describe(t, today);
  if (until > 0) {
    const told = until <= 7;
    return `### 你的出行计划\n你 ${t.startDate} 要去${t.destination}（${t.reason}），待到 ${t.endDate}，还有 ${until} 天。${told ? `聊到相关的事时可以自然提一句，像平常交代行程那样，不用郑重宣布。` : ''}`;
  }
  return `### 你现在不在家\n你在${t.destination}（${t.reason}），第 ${n}/${total} 天${n === total ? '，今天回程' : ''}。说话时你人就在那边：可以随口分享看到的、吃到的、碰到的小事，或者说一句"这边下雨了"——像出门在外顺手跟${userName}报一声，不要写成游记，也不是每句都提。`;
}
