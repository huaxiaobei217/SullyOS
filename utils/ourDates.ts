/**
 * 你们的日子（个人二改）：生日、认识的那天、在一起的那天、自己加的纪念日。
 * 平时完全不进提示词——只有当天、或者前三天（让他记着、可以悄悄准备），
 * 以及认识 / 在一起满整百天、满周年那天，才给他看一行。
 */
import type { CharacterProfile } from '../types';

const LS = 'sully_our_dates_v1';
export interface OurDates { userBirthday?: string; charBirthday?: string; metOn?: string; togetherOn?: string; custom: { name: string; date: string }[] }

const all = (): Record<string, OurDates> => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } };
export function getOurDates(char: Pick<CharacterProfile, 'id'> & { systemPrompt?: string; description?: string }): OurDates {
  const v: Partial<OurDates> = all()[char.id] || {};
  // 他的生日：没填就从人设里找「生日：6月5日」
  let charBirthday = v.charBirthday;
  if (charBirthday === undefined) {
    const m = `${char.systemPrompt || ''}\n${char.description || ''}`.match(/生日[：:]\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (m) charBirthday = `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return { ...v, charBirthday, custom: v.custom || [] };
}
export function setOurDates(charId: string, patch: Partial<OurDates>) {
  const a = all(); const prev: Partial<OurDates> = a[charId] || {}; a[charId] = { ...prev, ...patch, custom: patch.custom ?? prev.custom ?? [] };
  try { localStorage.setItem(LS, JSON.stringify(a)); } catch { /* ignore */ }
}

const DAY = 86400000;
const md = (d: string) => d.length === 10 ? d.slice(5) : d; // YYYY-MM-DD → MM-DD
const toDate = (today: string) => new Date(`${today}T12:00:00`);
/** 从 today 起 n 天后的 MM-DD */
const mdAfter = (today: string, n: number) => { const t = new Date(toDate(today).getTime() + n * DAY); return `${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
const daysSince = (from: string, today: string) => Math.round((toDate(today).getTime() - new Date(`${from}T12:00:00`).getTime()) / DAY);

/** today 是角色那边的日期 YYYY-MM-DD；没什么特别的就返回 '' */
export function buildOurDatesBlock(char: CharacterProfile, today: string, userName: string): string {
  const d = getOurDates(char as any);
  const items: { name: string; md: string; who: 'her' | 'him' | 'us' }[] = [];
  if (d.userBirthday) items.push({ name: `${userName}的生日`, md: md(d.userBirthday), who: 'her' });
  if (d.charBirthday) items.push({ name: '你的生日', md: md(d.charBirthday), who: 'him' });
  for (const c of d.custom) if (c.name && c.date && c.date !== today) items.push({ name: c.name, md: md(c.date), who: 'us' });
  const lines: string[] = [];
  for (const it of items) {
    if (it.md === mdAfter(today, 0)) lines.push(it.who === 'her' ? `今天是${it.name}。你记得——用你自己的方式，别等她提醒，也别搞成排场` : it.who === 'him' ? `今天是你的生日。你不太在乎这个，但她可能会记得` : `今天是「${it.name}」`);
    else for (let n = 1; n <= 3; n++) if (it.md === mdAfter(today, n)) {
      lines.push(it.who === 'her' ? `${n} 天后是${it.name}。你心里记着，可以悄悄准备，别提前说破` : it.who === 'him' ? `${n} 天后是你的生日（你自己不太当回事）` : `${n} 天后是「${it.name}」，你记着`);
    }
  }
  for (const [label, from] of [['认识', d.metOn], ['在一起', d.togetherOn]] as const) {
    if (!from || from.length !== 10) continue;
    const n = daysSince(from, today);
    if (n <= 0) continue;
    if (md(from) === mdAfter(today, 0)) lines.push(`今天是你们${label}满 ${Math.round(n / 365)} 周年`);
    else if (n % 100 === 0 || n === 520 || n === 1314) lines.push(`今天是你们${label}第 ${n} 天`);
  }
  if (!lines.length) return '';
  return `### 你们的日子\n${lines.map(l => `- ${l}。`).join('\n')}`;
}
