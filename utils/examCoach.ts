/**
 * 考公陪练（个人二改）：错题拆解、间隔复习、申论小练、薄弱点统计。
 * - 错题：截图（粉笔等刷题 App 里的错题）→ 视觉模型认题型、讲为什么错、几步做完、挂一张技巧卡 → 进复习队列
 * - 复习：1 / 3 / 7 / 15 / 30 天；「还不熟」就回到 1 天
 * - 申论：出一段短材料 + 一道题（归纳概括 / 提出对策 / 公文），按采分点批改，给参考答案
 * 用自习室的 API（study_api_config），没配就用主 API。题目图片存 blobref，清单在 localStorage。
 */
import type { APIConfig } from '../types';
import { safeFetchJson, extractContent } from './safeApi';
import { cardIndex, EXAM_CARDS, MODULE_NAMES, type ExamModule, type ExamCard } from './examCards';
import { allPoints, pointById } from './examSyllabus';

const LS_WRONG = 'sully_exam_wrong_v1', LS_DRILL = 'sully_exam_drills_v1', LS_DAY = 'sully_exam_day_v1';
export const EXAM_EVENT = 'sully:exam-changed';
const read = <T,>(k: string, d: T): T => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } try { window.dispatchEvent(new Event(EXAM_EVENT)); } catch { /* ignore */ } };
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const DAY = 86400000;

export function studyApi(main: APIConfig): APIConfig {
  const o = read<Partial<APIConfig>>('study_api_config', {});
  return { ...main, baseUrl: o.baseUrl || main.baseUrl, apiKey: o.apiKey || main.apiKey, model: o.model || main.model };
}
async function call(api: APIConfig, messages: any[], purpose: string, maxTokens = 2000, temperature = 0.3): Promise<string> {
  if (!api?.baseUrl || !api.model) throw new Error('先在设置里配好 API（自习室独立 API 或主 API）');
  const data = await safeFetchJson(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` },
    body: JSON.stringify({ model: api.model, messages, temperature, max_tokens: maxTokens, stream: false }),
  }, 0, 0, { appName: '考公陪练', purpose });
  return String(extractContent(data) || '').replace(/<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').trim();
}
const json = (text: string): any => { const m = text.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/); if (!m) throw new Error('模型没按格式回，再试一次'); return JSON.parse(m[0]); };

/* ───────── 错题 ───────── */
export interface WrongItem {
  id: string; at: number; images: string[]; note?: string;
  module: ExamModule; type: string; stem: string; options?: string[]; answer?: string; mine?: string;
  why: string; steps: string[]; takeaway: string; cardId?: string; trap?: string;
  /** 复习 */ level: number; due: number; reviews: number; lapses: number;
  chat?: { q: string; a: string }[];
}
export const getWrong = (): WrongItem[] => read<WrongItem[]>(LS_WRONG, []);
const saveWrong = (l: WrongItem[]) => write(LS_WRONG, l.slice(0, 500));
const INTERVALS = [1, 3, 7, 15, 30, 60];

const ANALYZE_RULE = `你是很会应试的考公老师，专门帮学生拆错题。学生发来一道题的截图（可能来自刷题 App，可能带解析或她的作答），也可能附一句话。
请：
1. 把题干、选项原样识别出来（图形推理题题干看不清就用一句话描述图形特征）。
2. 判断模块（zl 资料分析 / sl 数量关系 / pd 判断推理 / yy 言语理解 / cs 常识判断 / sh 申论）和具体题型（如「求基期」「翻译推理」「主旨题」）。
3. 正确答案；截图里能看到她选了什么就写出来。
4. why：她最可能错在哪（一句话，具体到这道题，不要「审题不仔细」这类空话）。
5. steps：考场上最快的解法，3～5 步，每步一句，带算式就写算式；能用技巧（赋值、百化分、截位、代入排除、找关联词……）就用技巧。
6. takeaway：下次见到这类题一句话怎么做（像口诀，20 字以内）。
7. trap：这类题最常见的坑（一句，可空）。
8. cardId：从下面的技巧卡里挑最贴的一张，没有就空：
${cardIndex()}
不寒暄、不鼓励、不写套话。只输出 JSON：
{"module":"zl","type":"…","stem":"…","options":["A …","B …"],"answer":"B","mine":"C","why":"…","steps":["…"],"takeaway":"…","trap":"…","cardId":"…"}`;

export async function analyzeWrong(api: APIConfig, imagesDataUrl: string[], note: string): Promise<Omit<WrongItem, 'id' | 'at' | 'images' | 'level' | 'due' | 'reviews' | 'lapses'>> {
  const content: any[] = [{ type: 'text', text: note ? `她的补充：${note}` : '拆这道题。' }, ...imagesDataUrl.map(url => ({ type: 'image_url', image_url: { url } }))];
  const j = json(await call(api, [{ role: 'system', content: ANALYZE_RULE }, { role: 'user', content: imagesDataUrl.length ? content : (note || '') }], '错题拆解', 2200, 0.2));
  const mod = (['zl', 'sl', 'pd', 'yy', 'cs', 'sh'] as ExamModule[]).includes(j.module) ? j.module : 'pd';
  return {
    module: mod, type: String(j.type || '未分类').slice(0, 20), stem: String(j.stem || '').slice(0, 3000),
    options: Array.isArray(j.options) ? j.options.map(String).slice(0, 8) : undefined,
    answer: j.answer ? String(j.answer).slice(0, 40) : undefined, mine: j.mine ? String(j.mine).slice(0, 40) : undefined,
    why: String(j.why || '').slice(0, 300), steps: Array.isArray(j.steps) ? j.steps.map(String).slice(0, 6) : [],
    takeaway: String(j.takeaway || '').slice(0, 60), trap: j.trap ? String(j.trap).slice(0, 160) : undefined,
    cardId: EXAM_CARDS.some(c => c.id === j.cardId) ? j.cardId : undefined, note: note || undefined,
  };
}
export function addWrong(images: string[], a: Awaited<ReturnType<typeof analyzeWrong>>): WrongItem {
  const item: WrongItem = { id: uid(), at: Date.now(), images, ...a, level: 0, due: Date.now() + DAY, reviews: 0, lapses: 0 };
  saveWrong([item, ...getWrong()]); return item;
}
export const updateWrong = (id: string, patch: Partial<WrongItem>) => saveWrong(getWrong().map(w => w.id === id ? { ...w, ...patch } : w));
export const removeWrong = (id: string) => saveWrong(getWrong().filter(w => w.id !== id));
/** 复习：记住了 → 下一档；还不熟 → 回到 1 天 */
export function reviewWrong(id: string, ok: boolean) {
  const w = getWrong().find(x => x.id === id); if (!w) return;
  const level = ok ? Math.min(INTERVALS.length - 1, w.level + 1) : 0;
  updateWrong(id, { level, due: Date.now() + INTERVALS[ok ? level : 0] * DAY - 3600e3, reviews: w.reviews + 1, lapses: w.lapses + (ok ? 0 : 1) });
  markDay('review');
}
export const dueWrong = (now = Date.now()) => getWrong().filter(w => w.due <= now).sort((a, b) => a.due - b.due);

export async function askAboutWrong(api: APIConfig, w: WrongItem, q: string): Promise<string> {
  const ctx = `题目：${w.stem}\n${w.options?.join('\n') || ''}\n答案：${w.answer || '?'}；她选：${w.mine || '?'}\n题型：${w.type}\n解法：${w.steps.join(' / ')}`;
  const prev = (w.chat || []).slice(-4).flatMap(c => [{ role: 'user', content: c.q }, { role: 'assistant', content: c.a }]);
  const a = await call(api, [{ role: 'system', content: `你是考公老师，学生在追问一道错题。直接回答她问的，短、具体、带算式或例子；不寒暄不鼓励。\n${ctx}` }, ...prev, { role: 'user', content: q }], '错题追问', 1000, 0.3);
  updateWrong(w.id, { chat: [...(w.chat || []), { q, a }].slice(-10) });
  return a;
}

/* ───────── 申论小练 ───────── */
export type DrillKind = 'summary' | 'measure' | 'doc';
export const DRILL_NAMES: Record<DrillKind, string> = { summary: '归纳概括', measure: '提出对策', doc: '公文写作' };
export interface Drill {
  id: string; at: number; kind: DrillKind; topic: string; material: string; question: string; limit: number;
  points: string[]; reference: string;
  answer?: string; score?: number; hits?: string[]; misses?: string[]; comment?: string; rewrite?: string; doneAt?: number;
}
export const getDrills = (): Drill[] => read<Drill[]>(LS_DRILL, []);
const saveDrills = (l: Drill[]) => write(LS_DRILL, l.slice(0, 200));

const DOC_KINDS = ['通知', '倡议书', '讲话稿', '情况报告', '工作简报', '宣传稿'];
export async function makeDrill(api: APIConfig, kind: DrillKind, topic = ''): Promise<Drill> {
  const recent = getDrills().slice(0, 8).map(d => d.topic).join('、');
  const doc = DOC_KINDS[Math.floor(Math.random() * DOC_KINDS.length)];
  const ask = kind === 'summary' ? '一道归纳概括题（概括问题 / 原因 / 做法 / 经验其中之一），字数限制 100～150 字'
    : kind === 'measure' ? '一道提出对策题，字数限制 150～200 字'
    : `一道公文写作题，文种是「${doc}」，交代身份和对象，字数限制 300～400 字`;
  const sys = `你是申论命题老师。出一道适合上班族 10 分钟内完成的申论小练：
- 写一段 350～500 字的给定资料，像真实申论材料：基层治理、乡村振兴、营商环境、民生服务、数字政府、生态环保等主题，有具体的人、事、数据和原话，要点散在材料里，不要直接列好。${topic ? `主题限定：${topic}。` : ''}${recent ? `别和这些主题重复：${recent}。` : ''}
- 出${ask}。
- points：采分点 4～6 条（每条一句，阅卷时据此给分）。
- reference：一份参考答案，按申论规范分条写。
只输出 JSON：{"topic":"四字主题","material":"…","question":"…","limit":150,"points":["…"],"reference":"…"}`;
  const j = json(await call(api, [{ role: 'system', content: sys }, { role: 'user', content: '出题。' }], '申论出题', 2600, 0.8));
  const d: Drill = { id: uid(), at: Date.now(), kind, topic: String(j.topic || '').slice(0, 12), material: String(j.material || ''), question: String(j.question || ''), limit: Number(j.limit) || 150, points: Array.isArray(j.points) ? j.points.map(String) : [], reference: String(j.reference || '') };
  saveDrills([d, ...getDrills()]); return d;
}
export async function gradeDrill(api: APIConfig, d: Drill, answer: string): Promise<Drill> {
  const sys = `你是申论阅卷老师，按采分点给分，严格但具体。满分 20 分：要点分为主（每个采分点按命中程度给分），表述规范、条理、字数另占少量分。
题目：${d.question}（${d.limit} 字以内）
采分点：
${d.points.map((p, i) => `${i + 1}. ${p}`).join('\n')}
${d.kind === 'doc' ? '公文还要看格式：标题、称呼 / 主送、正文结构、落款，缺一项扣分。' : ''}
输出 JSON：{"score":14,"hits":["命中的采分点（用她的原话举证）"],"misses":["漏掉或写偏的采分点，说清差在哪"],"comment":"两三句最关键的改进建议，具体到哪一句怎么改，不写鼓励套话","rewrite":"把她的答案改成高分版（保留她写对的部分）"}`;
  const j = json(await call(api, [{ role: 'system', content: sys }, { role: 'user', content: `她的答案（${[...answer].length} 字）：\n${answer}` }], '申论批改', 2200, 0.2));
  const done: Drill = { ...d, answer, score: Math.max(0, Math.min(20, Number(j.score) || 0)), hits: (j.hits || []).map(String), misses: (j.misses || []).map(String), comment: String(j.comment || ''), rewrite: String(j.rewrite || ''), doneAt: Date.now() };
  saveDrills(getDrills().map(x => x.id === d.id ? done : x)); markDay('drill');
  return done;
}
export const removeDrill = (id: string) => saveDrills(getDrills().filter(d => d.id !== id));

/* ───────── 每天 ───────── */
interface DayLog { [date: string]: { review?: number; card?: number; drill?: number; wrong?: number } }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function markDay(kind: 'review' | 'card' | 'drill' | 'wrong') { const l = read<DayLog>(LS_DAY, {}); const t = today(); l[t] = { ...(l[t] || {}), [kind]: ((l[t] || {})[kind] || 0) + 1 }; write(LS_DAY, l); }
export const getDays = () => read<DayLog>(LS_DAY, {});
export const todayLog = () => getDays()[today()] || {};
/** 连续打卡天数（当天有任何练习算一天） */
export function streak(): number {
  const l = getDays(); let n = 0; const d = new Date();
  if (!l[today()]) d.setDate(d.getDate() - 1);
  for (;;) { const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; if (!l[k]) break; n++; d.setDate(d.getDate() - 1); }
  return n;
}
/** 今天的技巧卡：优先错题挂过、还没看熟的；否则轮着来 */
export function cardOfDay(): string {
  const seen = read<Record<string, number>>('sully_exam_cardseen_v1', {});
  const weak = weakSpots(14).flatMap(w => w.cards);
  const pool = [...new Set([...weak, ...EXAM_CARDS.map(c => c.id)])];
  return pool.sort((a, b) => (seen[a] || 0) - (seen[b] || 0))[0];
}
export function markCardSeen(id: string) { const s = read<Record<string, number>>('sully_exam_cardseen_v1', {}); s[id] = Date.now(); write('sully_exam_cardseen_v1', s); markDay('card'); }

/** 最近 N 天按题型统计错题 */
export function weakSpots(days = 7): { module: ExamModule; type: string; count: number; cards: string[] }[] {
  const since = Date.now() - days * DAY; const map = new Map<string, { module: ExamModule; type: string; count: number; cards: Set<string> }>();
  for (const w of getWrong()) {
    if (w.at < since && !(w.lapses > 0 && w.due <= Date.now() + DAY)) continue;
    const k = `${w.module}|${w.type}`; const e = map.get(k) || { module: w.module, type: w.type, count: 0, cards: new Set<string>() };
    e.count += 1 + w.lapses; if (w.cardId) e.cards.add(w.cardId); map.set(k, e);
  }
  return [...map.values()].sort((a, b) => b.count - a.count).map(e => ({ ...e, cards: [...e.cards] }));
}

/* ───────── 知识点讲解（没手写卡的点：按同一格式生成一次，存下来） ───────── */
const LS_POINT = 'sully_exam_points_v2';
export const getPointCard = (id: string): ExamCard | null => read<Record<string, ExamCard>>(LS_POINT, {})[id] || null;
export async function explainPoint(api: APIConfig, pointId: string, again = false): Promise<ExamCard> {
  const p = pointById(pointId); if (!p) throw new Error('没有这个知识点');
  if (!again) { const c = getPointCard(pointId); if (c) return c; }
  const sys = `你是讲课最清楚的考公老师，给学生写一张「${MODULE_NAMES[p.module]} · ${p.topic} · ${p.name}」的知识点卡，手机上看，上班族碎片时间用。
要求：只写干货，不寒暄、不鼓励、不写「首先我们要明白」这类套话；每条一句话说清，能给公式就给公式，能给口诀就给口诀；例题要像真题（行测题给四个选项），数字要算对。${p.module === 'cs' ? '常识类：spot 写这个考点常怎么考，formulas 写必须记住的核心知识（条文、年份、定义、对比），steps 写记忆方法或答题思路。' : ''}${p.module === 'sh' ? '申论类：formulas 写格式或结构模板，steps 写作答步骤，例题给一段很短的材料和题目，work 写答题要点，a 写参考答案。' : ''}
只输出 JSON：{"title":"${p.name}","motto":"一句话口诀（20 字以内）","spot":"怎么一眼认出这类题 / 这个考点常怎么考","formulas":["公式、规则或要记的知识，2～5 条"],"steps":["几步做完，3～5 步"],"example":{"q":"例题（含选项）","work":["解题过程，带算式"],"a":"答案"},"traps":["常见坑，2～3 条"]}`;
  const j = json(await call(api, [{ role: 'system', content: sys }, { role: 'user', content: '写。' }], '知识点卡', 2200, 0.3));
  const card: ExamCard = {
    id: pointId, module: p.module, title: String(j.title || p.name), motto: String(j.motto || ''), spot: String(j.spot || ''),
    formulas: Array.isArray(j.formulas) ? j.formulas.map(String) : undefined, steps: Array.isArray(j.steps) ? j.steps.map(String) : [],
    example: { q: String(j.example?.q || ''), work: Array.isArray(j.example?.work) ? j.example.work.map(String) : [], a: String(j.example?.a || '') },
    traps: Array.isArray(j.traps) ? j.traps.map(String) : undefined,
  };
  const all = read<Record<string, ExamCard>>(LS_POINT, {}); all[pointId] = card; write(LS_POINT, all);
  return card;
}

/* ───────── 刷题：一组 5 道，按真题风格出的原创题 ───────── */
export interface QuizQ { stem: string; options: string[]; answer: string; steps: string[]; takeaway: string; pointId?: string; module: ExamModule; type: string; picked?: string; bad?: boolean }
export interface QuizSet { id: string; at: number; title: string; qs: QuizQ[]; doneAt?: number }
const LS_QUIZ = 'sully_exam_quiz_v1';
export const getQuizzes = (): QuizSet[] => read<QuizSet[]>(LS_QUIZ, []);
const saveQuizzes = (l: QuizSet[]) => write(LS_QUIZ, l.slice(0, 60));

export async function makeQuiz(api: APIConfig, target: { pointIds?: string[]; module?: ExamModule }, n = 5): Promise<QuizSet> {
  const pts = target.pointIds?.length ? target.pointIds.map(pointById).filter(Boolean) as ReturnType<typeof allPoints>
    : allPoints().filter(p => !target.module || p.module === target.module).sort(() => Math.random() - 0.5).slice(0, 3);
  if (!pts.length) throw new Error('没有可出题的知识点');
  const mod = pts[0].module;
  const recent = getQuizzes().slice(0, 4).flatMap(q => q.qs.map(x => x.stem.slice(0, 30))).join(' / ');
  const sys = `你是公务员考试行测命题老师。按国考 / 省考真题的风格和难度，出 ${n} 道原创单选题（四个选项 A–D），考点：${pts.map(p => `${MODULE_NAMES[p.module]}·${p.name}（id ${p.id}）`).join('、')}。
- 题干、选项、数据都要自洽；${mod === 'zl' ? '资料分析先给一段带数据的材料（放在每道题的 stem 开头，可以几道共用同一段材料，各自重复写出），' : ''}数学类先自己把答案算出来再写选项，干扰项用常见错误算法得到的数。
- 不要出图形推理（这里没法显示图）；定义判断、类比、逻辑、言语题照真题样式。
- 每道给：answer（字母）、steps（考场上最快的做法 2～4 步，带算式）、takeaway（一句话方法，20 字内）、pointId（对应的考点 id）、type（题型名）。
${recent ? `别和这些题重复：${recent}` : ''}
只输出 JSON：{"qs":[{"stem":"…","options":["A …","B …","C …","D …"],"answer":"B","steps":["…"],"takeaway":"…","pointId":"…","type":"…"}]}`;
  const j = json(await call(api, [{ role: 'system', content: sys }, { role: 'user', content: '出题。' }], '刷题出题', 4000, 0.6));
  const qs: QuizQ[] = (Array.isArray(j.qs) ? j.qs : []).slice(0, n).map((q: any) => {
    const p = pointById(q.pointId) || pts[0];
    return { stem: String(q.stem || ''), options: Array.isArray(q.options) ? q.options.map(String).slice(0, 4) : [], answer: String(q.answer || '').trim().charAt(0).toUpperCase(), steps: Array.isArray(q.steps) ? q.steps.map(String) : [], takeaway: String(q.takeaway || ''), pointId: p.id, module: p.module, type: String(q.type || p.name).slice(0, 20) };
  }).filter((q: QuizQ) => q.stem && q.options.length >= 2 && /[A-D]/.test(q.answer));
  if (!qs.length) throw new Error('题没出成，再试一次');
  const set: QuizSet = { id: uid(), at: Date.now(), title: target.pointIds?.length ? pts.map(p => p.name).join('、') : `${MODULE_NAMES[mod]} 混合`, qs };
  saveQuizzes([set, ...getQuizzes()]); return set;
}
/** 作答一道：做错了进错题本（没图，带题干） */
export function answerQuiz(setId: string, idx: number, picked: string) {
  const sets = getQuizzes(); const s = sets.find(x => x.id === setId); if (!s) return;
  const q = s.qs[idx]; if (!q || q.picked) return;
  q.picked = picked;
  if (picked !== q.answer) {
    const p = pointById(q.pointId);
    addWrong([], { module: q.module, type: q.type, stem: q.stem, options: q.options, answer: q.answer, mine: picked, why: `选了 ${picked}，正确是 ${q.answer}`, steps: q.steps, takeaway: q.takeaway, cardId: p?.card });
  }
  if (s.qs.every(x => x.picked || x.bad)) { s.doneAt = Date.now(); markDay('review'); }
  saveQuizzes(sets);
}
export function markQuizBad(setId: string, idx: number) {
  const sets = getQuizzes(); const s = sets.find(x => x.id === setId); if (!s || !s.qs[idx]) return;
  s.qs[idx].bad = true; saveQuizzes(sets);
}

/* ───────── 题库题「讲这道」：只在点的时候问一次模型 ───────── */
export async function explainBankQ(api: APIConfig, q: { stem: string; options: string[]; answer?: string }, picked?: string): Promise<{ type: string; steps: string[]; takeaway: string; why?: string }> {
  const sys = `你是考公老师，给学生讲一道题。直接讲做法：题型、考场上最快的做法 2～4 步（带关键依据，逻辑题写出推理链，言语题指出关键句和关联词）、一句话方法（20 字内）${picked && q.answer && picked !== q.answer ? '、她为什么会选错（一句，具体到这道题）' : ''}。不寒暄不鼓励。
只输出 JSON：{"type":"题型","steps":["…"],"takeaway":"…"${picked && q.answer && picked !== q.answer ? ',"why":"…"' : ''}}`;
  const j = json(await call(api, [{ role: 'system', content: sys }, { role: 'user', content: `${q.stem}\n${q.options.join('\n')}\n正确答案：${q.answer || '（题库没给，请你判断）'}${picked ? `；她选了 ${picked}` : ''}` }], '讲这道', 1200, 0.2));
  return { type: String(j.type || ''), steps: Array.isArray(j.steps) ? j.steps.map(String) : [], takeaway: String(j.takeaway || ''), why: j.why ? String(j.why) : undefined };
}
