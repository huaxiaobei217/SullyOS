/**
 * 他今天的状态和在跟进的事（个人二改）。都夹在每天那一次日程生成里，不额外调用：
 *  - 状态：大多数日子满格或正常；隔几天会有一天累、烦、提不起劲，原因来自他自己的生活
 *  - 在跟进的事：在读的书、在打的游戏、在追的剧、在写的东西……一天天往下推进，不会每天重新开始
 */
import type { CharacterProfile } from '../types';

const LS = 'sully_char_daystate_v1';
export type Level = '满格' | '正常' | '有点累' | '很累' | '烦躁' | '低落' | '兴奋';
export interface Thread { kind: string; title: string; progress: string; since: string; updated: string }
export interface DayState { date: string; level?: Level; why?: string; threads: Thread[] }

const LEVELS: Level[] = ['满格', '正常', '有点累', '很累', '烦躁', '低落', '兴奋'];
const loadAll = (): Record<string, DayState> => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } };
export const getDayState = (charId: string): DayState => loadAll()[charId] || { date: '', threads: [] };
const save = (charId: string, v: DayState) => { try { const a = loadAll(); a[charId] = v; localStorage.setItem(LS, JSON.stringify(a)); } catch { /* ignore */ } };

const daysBetween = (a: string, b: string) => { const x = Date.parse(`${a}T00:00:00Z`), y = Date.parse(`${b}T00:00:00Z`); return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 86400000) : 0; };
/** 一件事最多跟这么多天：一本书一个游戏不会天天捧着，跟太久的强制收掉（她反馈《神曲》连着一礼拜天天出现） */
const MAX_THREAD_DAYS = 6;

/** 拼进日程生成 prompt */
export function buildDayStatePrompt(char: CharacterProfile, userName: string, today = ''): string {
  const st = getDayState(char.id);
  const threads = st.threads.length ? st.threads.map(t => {
    const age = today ? daysBetween(t.since, today) : 0;
    const note = age >= 4 ? `（已经跟了 ${age} 天：今天收尾、弃掉或放一放，别再写进日程）` : '';
    return `- ${t.kind}《${t.title}》：${t.progress}（${t.since} 开始）${note}`;
  }).join('\n') : '（还没有）';
  const recentOff = st.level && !['满格', '正常', '兴奋'].includes(st.level) ? `昨天你${st.level}（${st.why || ''}），今天大概率缓过来了。` : '';
  return `\n\n### 今天的状态和这阵子在跟进的事（写进 JSON 顶层）
- "condition": {"level":"${LEVELS.join('|')}","why":"一句具体原因"}。大多数日子是满格或正常；大约五六天里有一天不在状态（熬夜赶稿、被房东烦、天气闷、游戏连跪、书看得心里堵……），原因来自你自己的生活，不要因为${userName}。${recentOff}今天的日程要和这个状态对得上。
- "threads": 你这阵子在跟进的 1～4 件事（在读的书、在打的游戏、在追的剧、在写的东西、在修的东西等），格式 [{"kind":"书|游戏|剧|写作|其他","title":"名字","progress":"进度，一句"}]。真人不会每天把手上所有的事都碰一遍：今天日程里**最多一段**在做其中一件（也可以一件都不碰，碰了的那件才往前推进度），其余的就是放着。读完 / 通关 / 弃了 / 跟了好几天腻了就换新的，新的别和旧的同一类（刚读完古书就别马上又是一本古书）。
已有的：
${threads}`;
}

/** 日程生成完存下来 */
export function acceptDayState(charId: string, date: string, condition: unknown, threads: unknown) {
  const prev = getDayState(charId);
  const next: DayState = { date, threads: prev.threads };
  const c = condition as any;
  if (c && LEVELS.includes(c.level)) { next.level = c.level; next.why = String(c.why || '').slice(0, 60); }
  if (Array.isArray(threads)) {
    const list = threads.slice(0, 4).map((t: any) => {
      const title = String(t?.title || '').trim().slice(0, 30);
      if (!title) return null;
      const old = prev.threads.find(o => o.title === title);
      const progress = String(t.progress || '').slice(0, 60);
      // 进度原样没动 = 今天没碰它，updated 不刷新（聊天里就不会把它当「今天在干的」）
      return { kind: String(t.kind || '其他').slice(0, 6), title, progress, since: old?.since || date, updated: old && old.progress === progress ? old.updated : date };
    }).filter(Boolean) as Thread[];
    // 跟太久的收掉，下次日程会自己补新的
    const fresh = list.filter(t => daysBetween(t.since, date) < MAX_THREAD_DAYS);
    if (list.length) next.threads = fresh;
  }
  save(charId, next);
}

/** 聊天 / 纸条用：今天的状态和在跟进的事 */
export function buildDayStateBlock(charId: string, today: string): string {
  const st = getDayState(charId);
  if (st.date !== today && !st.threads.length) return '';
  const parts: string[] = [];
  if (st.date === today && st.level && st.level !== '正常') {
    const how = st.level === '满格' ? '精神很好，话多一点也正常'
      : st.level === '兴奋' ? '心情很好，有点藏不住'
      : st.level === '有点累' ? '话少一点、懒一点，但对她不冷'
      : st.level === '很累' ? '没什么力气，回得短，可能会说想早点躺下；对她不冷，也不让她来哄你'
      : st.level === '烦躁' ? '有点烦，嘴更毒一点、耐心少一点，但不冲她发火；她问起可以说为什么'
      : '有点低落，不太想说话，不演开心；她问起可以说，也可以说「没什么，就是不想动」';
    parts.push(`今天你${st.level}（${st.why || '说不上来'}）：${how}。别反复提这件事，状态在语气里。`);
  }
  // 只给今天真碰过的那一件（没有就不给）：全塞进去的话他每段聊天都要捎一句《神曲》
  const touched = st.threads.filter(t => t.updated === today);
  const one = touched.length ? touched[Number(today.replace(/\D/g, '')) % touched.length] : null;
  if (one) parts.push(`你今天碰过的：${one.kind}《${one.title}》${one.progress ? `——${one.progress}` : ''}。这是背景，别主动拿它开话题；她问你在干嘛、或者正好聊到了才提，一次对话提一回就够。`);
  if (!parts.length) return '';
  return `### 你今天\n${parts.join('\n')}`;
}
