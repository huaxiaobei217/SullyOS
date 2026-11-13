/**
 * 日程别天天一个样（个人二改）。她反馈：这几天的日程基本重复，《神曲》出现得特别多。
 *  - 把前三天的日程给模型看，今天至少一半是这三天没出现过的事
 *  - 每天按日期抽两类「今天的新鲜事」，逼着日子长得不一样（同一天重生成抽到的一样，不会来回跳）
 */
import type { CharacterProfile, DailySchedule } from '../types';
import { DB } from './db';

const shiftDate = (key: string, d: number) => {
  const t = Date.parse(`${key}T12:00:00Z`); if (!Number.isFinite(t)) return '';
  return new Date(t + d * 86400000).toISOString().slice(0, 10);
};

/** 他自己的生活里可能冒出来的事；不针对某个角色，模型按人设落地 */
const FRESH: string[] = [
  '出门办一件很具体的杂事（寄东西、修手表、配钥匙、取干洗、去银行……）',
  '家里有东西坏了 / 出了小状况要处理（水管、灯泡、暖气、洗衣机、漏雨……）',
  '见一个朋友或熟人（喝一杯、吃顿饭、帮个忙、被拉去凑数）',
  '去一个最近没去过的地方（某家店、某条街、展览、公园、市场、演出）',
  '做饭或吃东西上的一次尝试（新菜谱、新开的店、失败的料理）',
  '运动或身体上的事（跑步、游泳、健身、散很长的步、扭了一下）',
  '整理 / 打扫 / 收拾某个角落，翻出一件旧东西',
  '买东西（逛二手店、等了很久的快递到了、冲动消费、退货）',
  '一件和本职有关但不是平常那套的事（开会、改别人的东西、被找去帮忙、交一份拖了很久的活）',
  '一个以前的爱好突然又捡起来一下（乐器、拼装、摄影、棋、画画……）',
  '被天气或城市打乱了安排（下雨改计划、地铁停运、停电、排长队）',
  '看了一部新的东西（电影、纪录片、一期节目、一场球）——不是这阵子一直在追的',
  '和家人 / 老朋友打了个电话或收到一条消息，聊了些近况',
  '什么都不想干的一段，真的就是瘫着',
  '学一个新东西 / 查一件好奇的事查了很久',
  '照顾点什么（植物、邻居的猫、朋友托付的东西）',
];

function seeded(key: string) { let h = 2166136261; for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; }

export function pickFresh(charId: string, today: string, n = 2): string[] {
  const r = seeded(`${charId}|${today}`); const pool = FRESH.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, n);
}

export async function buildVarietyPrompt(char: CharacterProfile, today: string): Promise<string> {
  const past: string[] = [];
  for (let k = 1; k <= 3; k++) {
    const day = shiftDate(today, -k); if (!day) continue;
    try {
      const s: DailySchedule | null = await DB.getDailySchedule(char.id, day);
      if (s?.slots?.length) past.push(`${day.slice(5)}：${s.slots.map(x => x.activity).join('、')}`);
    } catch { /* 没有就算了 */ }
  }
  const fresh = pickFresh(char.id, today);
  return `\n\n### 别和前几天一个样
${past.length ? `你最近几天的日程：\n${past.join('\n')}\n今天至少一半的时段要是这几天没出现过的事；同一本书、同一个游戏、同一个地方、同一种消遣（比如「窝沙发翻旧书」「打游戏」「喝冰可乐」）在这几天里已经出现过两次的，今天就别再排。\n` : ''}今天的日子里要有这两类事各一件，按你的人设和你所在的城市落到具体的事上：
- ${fresh.join('\n- ')}
别把每天都写成「在家看书 + 写稿 + 打游戏」的循环；真人的一周是不规律的，有出门的日子，也有被琐事占满的日子。`;
}
