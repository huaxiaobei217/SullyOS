/**
 * 自习室 · 班主任模式
 * - 讲课、答疑、出题、批改由「老师」来做：自习室独立 API（没配就用主 API），不带任何角色人设，省 token 也不串味
 * - 选中的角色当班主任：开课打个招呼（每天每门课一次）、批改后写几句点评、陪你专注计时
 * - 学习记录（讲了哪章、测验几分、专注多久）存本机，最近 24 小时的带进聊天，班主任自然知道你今天学了什么
 */
import type { CharacterProfile, APIConfig } from '../types';
import { callAsChar } from './footnote';

const LS_ON = 'sully_study_homeroom_v1';
const LS_LOG = 'sully_study_log_v1';
const LS_CHECKIN = 'sully_study_checkin_v1';
const LS_FOCUS = 'sully_study_focus_v1';
export const STUDY_LOG_EVENT = 'sully:study-log-changed';

const read = <T,>(k: string, d: T): T => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

export const isHomeroomOn = () => read<boolean>(LS_ON, true);
export const setHomeroomOn = (on: boolean) => write(LS_ON, on);

/* ───────── 老师（中立讲解） ───────── */

export const TEACHER_SYSTEM = `[System: 你是一位讲课清楚、很会应试的老师（熟悉公务员考试的行测、申论，也熟悉各类职业资格考试）。
- 只讲知识本身，不扮演任何角色，不寒暄、不卖萌。
- 用中文讲，条理清楚：先讲核心概念，再举例，最后总结考点和易错点。
- 和考试有关的内容，点明常见考法、题型和陷阱。]`;

export const teacherMessages = (prompt: string) => [
  { role: 'system', content: TEACHER_SYSTEM },
  { role: 'user', content: prompt },
];

/* ───────── 学习记录 ───────── */

export interface StudyLog {
  charId: string;
  kind: 'lesson' | 'chapter_done' | 'quiz' | 'focus';
  course?: string;
  title: string;
  detail?: string;
  minutes?: number;
  at: number;
}

export const loadStudyLog = (): StudyLog[] => read<StudyLog[]>(LS_LOG, []);
export function logStudy(entry: Omit<StudyLog, 'at'>) {
  write(LS_LOG, [{ ...entry, at: Date.now() }, ...loadStudyLog()].slice(0, 300));
  try { window.dispatchEvent(new Event(STUDY_LOG_EVENT)); } catch { /* ignore */ }
}

const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

export function todayStudySummary(charId?: string) {
  const today = dayKey(Date.now());
  const list = loadStudyLog().filter(l => dayKey(l.at) === today && (!charId || l.charId === charId));
  const focus = list.filter(l => l.kind === 'focus').reduce((s, l) => s + (l.minutes || 0), 0);
  const lessons = list.filter(l => l.kind === 'lesson' || l.kind === 'chapter_done').length;
  const quizzes = list.filter(l => l.kind === 'quiz');
  return { focus, lessons, quizzes: quizzes.length, list };
}

/** 连续几天有学习记录（今天还没学的话从昨天往前数） */
export function studyStreak(): number {
  const days = new Set(loadStudyLog().map(l => dayKey(l.at)));
  let n = 0;
  const d = new Date();
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d.getTime()))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 60 ? `${Math.max(1, m)} 分钟前` : `${Math.round(m / 60)} 小时前`;
};

const describe = (l: StudyLog) =>
  l.kind === 'focus' ? `专注了 ${l.minutes} 分钟${l.title ? `（${l.title}）` : ''}`
  : l.kind === 'quiz' ? `做了《${l.course}》「${l.title}」的测验：${l.detail}`
  : l.kind === 'chapter_done' ? `学完了《${l.course}》「${l.title}」`
  : `听老师讲了《${l.course}》「${l.title}」`;

/** 聊天里：班主任知道她最近 24 小时在自习室干了什么 */
export function buildStudyLogBlock(charId: string, userName: string): string {
  const now = Date.now();
  const list = loadStudyLog().filter(l => l.charId === charId && now - l.at < 24 * 3600 * 1000).slice(0, 8);
  if (!list.length) return '';
  const who = userName || '她';
  const streak = studyStreak();
  return [
    `### 【${who}在自习室（你是她的班主任）】`,
    ...list.map(l => `- ${ago(l.at)}：${describe(l)}`),
    streak > 1 ? `- 已经连续 ${streak} 天在学了` : '',
    `（这是她真实的学习记录。可以自然地问一句、夸一句或者督促一下，别逐条复述，也别每轮都提。）`,
  ].filter(Boolean).join('\n');
}

/* ───────── 班主任说话（用他自己的 API 和人设，都很短） ───────── */

const ROLE = (userName: string) => `你现在是 ${userName} 的「班主任」：她在自习室学习（目前在准备考公等考试），讲课出题由另一位老师负责，你负责关心进度、督促、点评和鼓励。用你自己的说话方式，不要变成客服或老师腔。`;

export async function homeroomCheckin(char: CharacterProfile, api: APIConfig, userName: string, course: string, chapter: string): Promise<string> {
  const key = `${dayKey(Date.now())}|${course}`;
  const done = read<Record<string, string>>(LS_CHECKIN, {});
  if (done[key]) return done[key];
  const recent = loadStudyLog().filter(l => l.charId === char.id).slice(0, 5).map(describe).join('；') || '这是她第一次来自习室';
  const { text } = await callAsChar(char, api,
    `${ROLE(userName)}\n- 只说 1～2 句，像开课前在她旁边坐下随口说的一句。\n- 不要用括号写动作。`,
    `她刚打开《${course}》，今天要学「${chapter}」。她最近的学习：${recent}。说一句开课前的话。`,
    '自习室·班主任开课', 300);
  const line = text.replace(/^["“]|["”]$/g, '').trim();
  const keep = Object.fromEntries(Object.entries(done).slice(-30));
  write(LS_CHECKIN, { ...keep, [key]: line });
  return line;
}

export async function homeroomQuizComment(char: CharacterProfile, api: APIConfig, userName: string, chapter: string, score: number, total: number, wrongStems: string[]): Promise<string> {
  const { text } = await callAsChar(char, api,
    `${ROLE(userName)}\n- 老师已经逐题讲解过了，你不用再讲题。\n- 写 2～4 句点评：看分数和错在哪里，真实地夸、损或督促，最后给一个下次的小目标。\n- 不要用括号写动作。`,
    `她刚做完「${chapter}」的测验：${score}/${total}。${wrongStems.length ? `错的题：\n${wrongStems.map((s, i) => `${i + 1}. ${s.slice(0, 80)}`).join('\n')}` : '全对。'}`,
    '自习室·班主任点评', 600);
  return text.trim();
}

/* ───────── 专注计时 ───────── */

export interface FocusLines { start: string; mids: string[]; end: string; quit: string }
export interface FocusChat { role: 'me' | 'him'; text: string; at: number }
export interface FocusState { startAt: number; minutes: number; label: string; lines?: FocusLines; chat?: FocusChat[] }
export const loadFocus = (): FocusState | null => read<FocusState | null>(LS_FOCUS, null);
export const saveFocus = (f: FocusState | null) => { if (f) write(LS_FOCUS, f); else { try { localStorage.removeItem(LS_FOCUS); } catch { /* ignore */ } } };

/** 中途冒出来的话：大约每 10 分钟一句，平均分布在整段时间里（不含开头和结尾） */
export const midCount = (minutes: number) => Math.max(1, Math.min(8, Math.floor(minutes / 10)));
export const midTimes = (minutes: number) => { const n = midCount(minutes); return Array.from({ length: n }, (_, i) => Math.round((minutes * 60000 * (i + 1)) / (n + 1))); };

/** 一次调用把整段要说的话都写好：开始、中途几句、结束、提前放弃。计时过程中不再花 token */
export async function focusLines(char: CharacterProfile, api: APIConfig, userName: string, minutes: number, label: string): Promise<FocusLines> {
  const n = midCount(minutes);
  const { text } = await callAsChar(char, api,
    `${ROLE(userName)}\n- 她要专注学习 ${minutes} 分钟${label ? `（${label}）` : ''}，你就在旁边陪着她，做你自己的事。\n- 中途的话是你隔一阵子轻轻冒出来的一句：可以是看她一眼、说你在干什么、递杯水、小声提醒坐直、问一句卡没卡住……每句不一样，别重复，别打断她太久。\n- 每句 1～2 句，口语，不要用括号写动作。\n- 只输出 JSON：{"start":"开始时说的","mids":[${n} 句中途的话，按时间先后],"end":"时间到了说的","quit":"她提前放弃时说的"}`,
    `写这些话。`, '自习室·专注陪伴', 1200);
  const m = text.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
  try {
    const j = JSON.parse(m ? m[0] : '');
    return { start: String(j.start || ''), mids: Array.isArray(j.mids) ? j.mids.map(String).filter(Boolean).slice(0, n) : [], end: String(j.end || ''), quit: String(j.quit || '') };
  } catch { return { start: text.slice(0, 120), mids: [], end: '时间到了。起来走两步。', quit: '行吧，下次补上。' }; }
}

/** 专注时跟他说一句（你吐槽、走神、卡题），他简短回一句 */
export async function focusReply(char: CharacterProfile, api: APIConfig, userName: string, f: FocusState, said: string): Promise<string> {
  const passed = Math.floor((Date.now() - f.startAt) / 60000);
  const history = (f.chat || []).slice(-8).map(c => `${c.role === 'me' ? userName : '你'}：${c.text}`).join('\n');
  const { text } = await callAsChar(char, api,
    `${ROLE(userName)}\n- 她正在专注学习${f.label ? `（${f.label}）` : ''}，已经过了 ${passed}/${f.minutes} 分钟，你在旁边陪着。\n- 回 1～3 句，像坐在旁边小声说话；她走神就轻轻把她拉回去，她卡题就简单点拨或者让她记下来问老师。\n- 不要用括号写动作。`,
    `${history ? `刚才的对话：\n${history}\n\n` : ''}${userName}：${said}`, '自习室·专注聊天', 500);
  return text.trim();
}
