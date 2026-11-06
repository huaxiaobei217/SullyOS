/**
 * 生活串线（个人二改）：让纸条、电台、日程互相知道。
 *  - 写纸条 / 录电台时，带上他今天的日程（现在在干嘛、今天都干了什么）和出门状态——
 *    日程里放了黑胶，纸条里就可能提到那张唱片；出差那几天，纸条从外地写来
 *  - 生成第二天日程时，带上他昨天贴的纸条和录的电台标题——日子是连着的
 */
import type { CharacterProfile } from '../types';
import { getDailyScheduleForChar } from './dailySchedule';
import { getCurrentSlot } from './charMusicSchedule';
import { resolveCharTimeZone, nowInTimeZone } from './timezone';
import { buildTripChatBlock } from './charTrip';
import { getScheduleDateKey } from './scheduleTime';

/** 他今天的日程 + 出门状态（写纸条、录电台用） */
export async function buildTodayLifeBlock(char: CharacterProfile, userName: string): Promise<string> {
  const parts: string[] = [];
  try {
    const sched = await getDailyScheduleForChar(char);
    if (sched?.slots?.length) {
      const now = nowInTimeZone(resolveCharTimeZone(char));
      const cur = getCurrentSlot(sched, now);
      const lines = sched.slots.slice(0, 12).map(s => `${s.startTime} ${s.activity}${s.location ? `（${s.location}）` : ''}${s === cur ? ' ← 现在' : ''}`);
      parts.push(`你今天的日程：\n${lines.join('\n')}${cur?.description ? `\n现在：${cur.description}` : ''}`);
    }
  } catch { /* 没日程就算了 */ }
  try { const trip = buildTripChatBlock(char, getScheduleDateKey(char), userName); if (trip) parts.push(trip.replace(/^###\s*/, '')); } catch { /* ignore */ }
  if (!parts.length) return '';
  return `### 你今天的生活（背景）
${parts.join('\n\n')}
写的时候可以自然地带进今天的事——刚做完的、手边的东西、待会儿要去的地方、人在哪；不用每张都提，也别像汇报日程。`;
}

/** 生成日程时：他昨天贴的纸条、录的电台（读本地页脚数据，不额外调用） */
export function buildYesterdayTraces(charId: string): string {
  try {
    const fn = JSON.parse(localStorage.getItem('sully_footnote_v1') || 'null');
    if (!fn) return '';
    const since = Date.now() - 36 * 3600 * 1000;
    const cards = (fn.cards || []).filter((c: any) => c.charId === charId && c.author !== 'user' && c.createdAt >= since).slice(0, 4)
      .map((c: any) => `${c.source ? `${c.source}：` : ''}${String(c.note || '').slice(0, 40)}`);
    const radio = (fn.radio || []).filter((r: any) => r.charId === charId && r.createdAt >= since).slice(0, 2).map((r: any) => `《${r.title}》`);
    const mine = (fn.cards || []).filter((c: any) => c.charId === charId && c.author === 'user' && c.createdAt >= since).slice(0, 2).map((c: any) => String(c.note || '').slice(0, 40));
    if (!cards.length && !radio.length && !mine.length) return '';
    return `\n\n### 昨天留下的痕迹（让日子连着，可以顺手延续，不用照搬）
${cards.length ? `你贴过的便签：${cards.join(' / ')}\n` : ''}${radio.length ? `你给她录过的睡前电台：${radio.join('、')}\n` : ''}${mine.length ? `她在墙上给你留的：${mine.join(' / ')}\n` : ''}`;
  } catch { return ''; }
}
