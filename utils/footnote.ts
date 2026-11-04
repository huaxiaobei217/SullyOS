/**
 * 「页脚」：诺亚的书影批注墙 · 快问快答转盘 · 深夜点播机。
 * 全部走角色自己的对话 API（resolveDialogueApi），带人设和世界书（ContextBuilder.buildCharacterRequest）。
 * 数据存 localStorage（小体积），按角色 id 区分。
 */
import { ContextBuilder } from './context';
import { DB } from './db';
import { safeFetchJson, extractContent } from './safeApi';
import { resolveDialogueApi } from './characterApi';
import type { APIConfig, CharacterProfile } from '../types';
import { voiceLanguagePromptLabel } from './voiceLanguage';

export const FOOTNOTE_LS_KEY = 'sully_footnote_v1';
export const FOOTNOTE_CHANGED_EVENT = 'sully:footnote-changed';

export type CardKind = 'note' | 'excerpt' | 'frame' | 'memo';
export interface FootCard {
  id: string; charId: string; kind: CardKind;
  source: string;      // 《书名》/ 片名 + 作者 / 导演 + 年份
  quote: string;       // 摘录原文 / 被批注的那句 / 画面描述
  note: string;        // 他的批注
  createdAt: number; starred?: boolean;
  /** 谁贴的：没写就是角色（旧数据） */
  author?: 'char' | 'user';
  /** 字体 key（见 FOOT_FONTS），便签底色 key（见 FOOT_TINTS） */
  font?: string; tint?: string;
  /** 旧版：纸条下面回的一句（现在用 thread） */
  reply?: string; replyAt?: number;
  /** 纸条下面你来我往的回复 */
  thread?: { by: 'char' | 'user'; text: string; at: number }[];
}
/** 新旧格式统一成一串回复 */
export const threadOf = (c: FootCard) => c.thread?.length ? c.thread : (c.reply ? [{ by: 'char' as const, text: c.reply, at: c.replyAt || c.createdAt }] : []);

export const FOOT_FONTS: { id: string; name: string; css: string; google?: string }[] = [
  { id: 'kai', name: '楷体', css: `'LXGW WenKai','KaiTi','STKaiti',serif` },
  { id: 'song', name: '宋体', css: `'Noto Serif SC','Songti SC',serif` },
  { id: 'mashan', name: '毛笔', css: `'Ma Shan Zheng',cursive`, google: 'Ma+Shan+Zheng' },
  { id: 'longcang', name: '行书', css: `'Long Cang',cursive`, google: 'Long+Cang' },
  { id: 'zhimang', name: '草写', css: `'Zhi Mang Xing',cursive`, google: 'Zhi+Mang+Xing' },
  { id: 'kuaile', name: '圆趣', css: `'ZCOOL KuaiLe',cursive`, google: 'ZCOOL+KuaiLe' },
  { id: 'hand-en', name: 'English', css: `'Caveat','Long Cang',cursive`, google: 'Caveat' },
];
export const FOOT_TINTS: { id: string; paper: string; tape: string }[] = [
  { id: 'cream', paper: '#fbf5e6', tape: 'rgba(214,170,120,0.45)' },
  { id: 'rose', paper: '#fbe9e7', tape: 'rgba(206,140,150,0.45)' },
  { id: 'sage', paper: '#eaf0e3', tape: 'rgba(140,165,120,0.45)' },
  { id: 'sky', paper: '#e7eef6', tape: 'rgba(120,150,190,0.40)' },
  { id: 'lilac', paper: '#efe8f5', tape: 'rgba(160,135,190,0.40)' },
  { id: 'lemon', paper: '#fbf6d8', tape: 'rgba(210,185,90,0.45)' },
];
export const fontCss = (id?: string) => (FOOT_FONTS.find(f => f.id === id) || FOOT_FONTS[0]).css;
export const tintOf = (id?: string) => FOOT_TINTS.find(t => t.id === id) || FOOT_TINTS[0];

/** 角色写纸条用的默认字体 */
const LS_CHAR_FONT = 'sully_footnote_char_font_v1';
export const loadCharFont = () => { try { return localStorage.getItem(LS_CHAR_FONT) || 'longcang'; } catch { return 'longcang'; } };
export const saveCharFont = (id: string) => { try { localStorage.setItem(LS_CHAR_FONT, id); } catch { /* ignore */ } };
export interface QaRound {
  id: string; charId: string; question: string; fromBank: boolean;
  mine: string; his: string; reaction: string; createdAt: number;
}
export type RadioChannel = 'gossip' | 'sonnet' | 'patent';
export interface RadioPiece { id: string; charId: string; channel: RadioChannel; title: string; text: string; createdAt: number; voiceLang?: string; }

interface Store { cards: FootCard[]; qa: QaRound[]; radio: RadioPiece[]; qaPool?: { charId: string; q: string }[]; }

export const loadFootnote = (): Store => {
  try {
    const j = JSON.parse(localStorage.getItem(FOOTNOTE_LS_KEY) || '{}');
    return { cards: j.cards || [], qa: j.qa || [], radio: j.radio || [], qaPool: j.qaPool || [] };
  } catch { return { cards: [], qa: [], radio: [], qaPool: [] }; }
};
const saveFootnote = (s: Store) => {
  const trimmed: Store = { cards: s.cards.slice(0, 300), qa: s.qa.slice(0, 200), radio: s.radio.slice(0, 80), qaPool: (s.qaPool || []).slice(0, 60) };
  try { localStorage.setItem(FOOTNOTE_LS_KEY, JSON.stringify(trimmed)); } catch { /* 满了就算了 */ }
  try { window.dispatchEvent(new Event(FOOTNOTE_CHANGED_EVENT)); } catch { /* ignore */ }
};
export const updateFootnote = (fn: (s: Store) => Store) => saveFootnote(fn(loadFootnote()));
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/* ───────── 调模型 ───────── */

const call = async (char: CharacterProfile, apiConfig: APIConfig, instructions: string, task: string, purpose: string, maxTokens = 3000) => {
  const user = await DB.getUserProfile();
  const api = resolveDialogueApi(apiConfig, char);
  if (!api?.baseUrl || !api.model) throw new Error('先在设置里配好聊天 API');
  const uname = (user as any)?.name || '对方';
  const fill = (t: string) => t.replace(/\{\{user\}\}/g, uname).replace(/\{\{char\}\}/g, char.name);
  const messages = await ContextBuilder.buildCharacterRequest(
    { char, user: user as any, instructions: fill(instructions) },
    [{ role: 'user', content: fill(task) }],
  );
  const data = await safeFetchJson(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` },
    body: JSON.stringify({ model: api.model, messages, temperature: 0.95, max_tokens: maxTokens, stream: false }),
  }, 0, 0, { appName: '页脚', charId: char.id, charName: char.name, purpose });
  const text = extractContent(data).trim();
  if (!text) throw new Error(data?.choices?.[0]?.finish_reason === 'length' ? '输出被截断了，再试一次' : '模型没有返回内容');
  return { text, userName: (user as any)?.name || '对方' };
};

const parseJson = (t: string): any => {
  const m = t.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('格式没对上，再试一次');
  try { return JSON.parse(m[0]); } catch { throw new Error('格式没对上，再试一次'); }
};

/* ───────── 书影批注墙 ───────── */

const KIND_TASK: Record<CardKind, string> = {
  note: '批注：挑一本你真的读过、真实存在的书里的一句话（简短，40 字以内），写下你在页边的批注。',
  excerpt: '摘录：从一本真实存在的书或诗里摘一小段你会抄下来的句子（40 字以内），再写一句你为什么抄它。',
  frame: '电影截帧：挑一部真实存在的电影或剧，描述某一帧画面（不是台词，是你看到的构图、光线、人物动作，40 字以内），再写你的批注。',
  memo: '小纸条：像情侣之间随手贴在冰箱、书里、镜子上的便签，写给 {{user}} 的一两句话。可以是想到 ta 的瞬间、一个小提醒、一句玩笑、一点想念。quote 留空，source 写贴在哪儿（比如「贴在台灯上」）。',
};

/**
 * 一次请求写好几张（省钱：每次请求都要带上整份人设，一张一张要太亏）。
 * 返回这一批新卡，最新的在前。
 */
export async function dropCards(char: CharacterProfile, apiConfig: APIConfig, count = 4): Promise<FootCard[]> {
  const recent = loadFootnote().cards.filter(c => c.charId === char.id && c.author !== 'user').slice(0, 24).map(c => c.source).filter(Boolean);
  const instructions = `### 【页脚 · 便签墙】
你在家里到处贴便签。现在一口气写 ${count} 张，种类混着来（至少一张小纸条）：
- note ${KIND_TASK.note}
- excerpt ${KIND_TASK.excerpt}
- frame ${KIND_TASK.frame}
- memo ${KIND_TASK.memo}
规矩：
- 除了小纸条，作品必须真实存在，作者/导演和年份要对；拿不准原句就写「大意：……」，不要编造引文。
- 写的话是你自己的：照你平时的语气、口味和偏见，可以刻薄、可以跑题、可以想到 {{user}}，每张 30–100 字。
- 不要重复最近写过的作品：${recent.length ? recent.join('、') : '（还没有）'}
只输出一个 JSON：{"cards":[{"kind":"note|excerpt|frame|memo","source":"《作品名》作者或导演 · 年份 / 小纸条写贴在哪儿","quote":"……","note":"……"}]}`;
  const { text } = await call(char, apiConfig, instructions, `写 ${count} 张。`, '便签墙', 6000);
  const j = parseJson(text);
  const list: any[] = Array.isArray(j.cards) ? j.cards : Array.isArray(j) ? j : [j];
  const tints = FOOT_TINTS.map(t => t.id);
  const now = Date.now();
  const cards: FootCard[] = list.filter(x => x && x.note).slice(0, count).map((x, i) => ({
    id: uid('fc'), charId: char.id, kind: (['note', 'excerpt', 'frame', 'memo'].includes(x.kind) ? x.kind : 'memo') as CardKind,
    source: String(x.source || '').slice(0, 80), quote: x.kind === 'memo' ? '' : String(x.quote || '').slice(0, 200),
    note: String(x.note).slice(0, 400), createdAt: now - i, author: 'char', font: loadCharFont(), tint: tints[Math.floor(Math.random() * tints.length)],
  }));
  if (!cards.length) throw new Error('这次一张都没写出来，再试一次');
  updateFootnote(s => ({ ...s, cards: [...cards, ...s.cards] }));
  return cards;
}

/** 用户自己贴一张纸条 */
export function addUserNote(charId: string, text: string, font: string, tint: string): FootCard {
  const card: FootCard = { id: uid('fc'), charId, kind: 'memo', source: '', quote: '', note: text.trim().slice(0, 400), createdAt: Date.now(), author: 'user', font, tint };
  updateFootnote(s => ({ ...s, cards: [card, ...s.cards] }));
  return card;
}

/** 用户在某张纸条下面写一句 */
export function addUserReply(cardId: string, text: string) {
  const t = text.trim().slice(0, 200);
  if (!t) return;
  updateFootnote(s => ({ ...s, cards: s.cards.map(c => c.id === cardId ? { ...c, thread: [...threadOf(c), { by: 'user', text: t, at: Date.now() }] } : c) }));
}

/** 让角色在某张纸条下面接着回一句（看得到整串回复） */
export async function replyToNote(char: CharacterProfile, apiConfig: APIConfig, cardId: string): Promise<string> {
  const card = loadFootnote().cards.find(c => c.id === cardId);
  if (!card) throw new Error('这张纸条找不到了');
  const who = card.author === 'user' ? '{{user}} 贴给你的纸条' : '你自己贴的纸条';
  const thread = threadOf(card).map(t => `${t.by === 'user' ? '{{user}}' : '你'}：${t.text}`).join('\n');
  const { text } = await call(char, apiConfig,
    `### 【页脚 · 便签墙】
墙上有一张${who}，下面已经有你们你一句我一句的回复。拿笔接着往下写一句。像情侣之间的小纸条：短、自然、有你的语气，一两句，60 字以内。
只输出你要写的那句话，不要引号。`,
    `纸条：${card.quote ? `「${card.quote}」 ` : ''}${card.note}${card.source ? `（${card.source}）` : ''}${thread ? `\n下面的回复：\n${thread}` : ''}`, '便签回复', 1500);
  const reply = text.replace(/^["“「]|["”」]$/g, '').trim().slice(0, 200);
  updateFootnote(s => ({ ...s, cards: s.cards.map(c => c.id === cardId ? { ...c, thread: [...threadOf(c), { by: 'char', text: reply, at: Date.now() }] } : c) }));
  return reply;
}

/* ───────── 快问快答转盘 ───────── */

export const QA_BANK: string[] = [
  '如果月亮明天开始收房租，你打算怎么付？',
  '给你一天当任意一件家具，你选什么？',
  '世界上所有的猫突然会说话，第一句是什么？',
  '你被困在一本书里，只能选一本，选哪本？',
  '如果可以把一种气味装进瓶子随身带，你装什么？',
  '给伦敦的雨起一个外号。',
  '一个小偷闯进你家，什么都没偷，只留下了一样东西。是什么？',
  '如果每个人出生自带一首主题曲，你的前奏是什么乐器？',
  '你最想和历史上哪个人一起吃一顿难吃的饭？',
  '如果梦可以快递，你今晚想寄出哪一个？',
  '用三个词形容一种不存在的颜色。',
  '你被允许删除世界上的一个声音，删哪个？',
  '假如时间是一种货币，你会把它花在哪种奢侈品上？',
  '你是一座博物馆的夜班保安，哪件展品最可能半夜偷偷溜走？',
  '如果你的影子能单独请假一天，它会去哪？',
  '给明天的自己留一张便利贴，写什么？',
  '如果可以和任意一个季节谈恋爱，你选哪个？为什么？',
  '你被选为一个新星球的第一位邮递员，第一封信寄给谁？',
  '说一个你认为被严重高估的东西。',
  '如果书可以吃，哪本书是什么味道？',
  '你的人生如果拍成电影，片名是什么？',
  '假如你能听懂植物说话，你家的哪盆植物最爱抱怨？',
  '世界上最无用但最浪漫的发明是什么？',
  '如果你可以给一个历史事件加一段背景音乐，加哪首？',
  '你最想住进哪幅画里？',
  '给失眠写一封分手信，开头一句是什么？',
  '如果只能用一个表情回复所有消息，你选哪个？',
  '你在平行世界里的职业是什么？',
  '把你今天的心情做成一道菜，叫什么名字？',
  '你觉得星星之间会互相八卦吗？最近在聊什么？',
  '如果遗忘可以挑选，你最想忘掉哪部作品、好重新看一遍？',
  '雨天和雪天打了一架，你站哪边？',
  '给你一台只能倒带十秒的机器，你会用在哪？',
  '如果你是一个标点符号，你是哪个？',
  '最适合在凌晨三点做的一件事是什么？',
  '你被允许给全世界放一天假，那天叫什么节？',
  '如果爱情有说明书，第一条注意事项是什么？',
  '你最想偷偷改掉哪本名著的结局？',
  '假如你有一只看不见的宠物，它是什么？',
  '如果能给十年后的我们拍一张照片，画面里有什么？',
];

/** 现场出题：一次出一批存着，转一次用一道，用完再出 */
export async function generateQuestion(char: CharacterProfile, apiConfig: APIConfig): Promise<string> {
  const pool = (loadFootnote().qaPool || []).filter(p => p.charId === char.id);
  if (pool.length) {
    const q = pool[0].q;
    updateFootnote(s => { let done = false; return { ...s, qaPool: (s.qaPool || []).filter(p => done || !(p.charId === char.id && p.q === q && (done = true))) }; });
    return q;
  }
  const recent = loadFootnote().qa.slice(0, 20).map(q => q.question);
  const { text } = await call(char, apiConfig,
    `### 【页脚 · 快问快答转盘】
你来出 8 道天马行空的快问快答题：轻松、好玩、有画面感，两个人都能马上答。每道一句话，30 字以内，彼此别太像。
不要和这些重复：${recent.join(' / ') || '（还没有）'}
一行一道，只输出题目本身，不要编号、引号或解释。`, '出题。', '快问快答出题', 3000);
  const qs = text.split('\n').map(l => l.replace(/^\s*(?:\d+[.、)]|[-*•])\s*/, '').replace(/^["“「]|["”」]$/g, '').trim()).filter(l => l.length > 3).slice(0, 8);
  if (!qs.length) throw new Error('没出成题，再转一次');
  const [first, ...rest] = qs;
  updateFootnote(s => ({ ...s, qaPool: [...(s.qaPool || []), ...rest.map(q => ({ charId: char.id, q: q.slice(0, 80) }))] }));
  return first.slice(0, 80);
}

export async function answerQuestion(char: CharacterProfile, apiConfig: APIConfig, question: string, mine: string, fromBank: boolean): Promise<QaRound> {
  const { text, userName } = await call(char, apiConfig,
    `### 【页脚 · 快问快答】
你和 ${'{{user}}'} 在玩快问快答，同一道题各自作答，然后一起揭晓。
1. 先写你自己的答案：照你的性格和口味，像平时说话一样，一两句，不要被对方的答案带跑（你作答时假装还没看到它）。
2. 再看对方的答案，回一句反应：可以笑、可以吐槽、可以被戳中，一句话。
只输出一个 JSON：{"his":"你的答案","reaction":"你对对方答案的反应"}`,
    `题目：${question}\n{{user}} 的答案（揭晓后才看）：${mine}`, '快问快答作答', 2000);
  const j = parseJson(text);
  const round: QaRound = { id: uid('qa'), charId: char.id, question, fromBank, mine, his: String(j.his || '').slice(0, 300), reaction: String(j.reaction || '').slice(0, 200), createdAt: Date.now() };
  void userName;
  updateFootnote(s => ({ ...s, qa: [round, ...s.qa] }));
  return round;
}

/* ───────── 深夜点播机 ───────── */

export const RADIO_CHANNELS: { id: RadioChannel; name: string; desc: string; task: string }[] = [
  {
    id: 'gossip', name: '历史狗血八卦', desc: '真实历史里的离谱往事，用讲八卦的口气说',
    task: '挑一段真实历史里狗血、离谱的往事（宫廷、文人、科学家、艺术家都行），用你讲八卦的口气说给 {{user}} 听，压低声音、慢慢讲，像睡前闲聊。只讲有史料的事；传说或有争议的地方要说明「据说」。300–500 字。',
  },
  {
    id: 'sonnet', name: '十四行诗', desc: '他念一首十四行，原创或公版名篇',
    task: '给 {{user}} 念一首十四行诗：可以是你自己写的原创中文十四行（写给 ta 也行），也可以是莎士比亚这类已进入公版的名篇（附中文大意）。念完用一两句话低声说说你为什么选它。',
  },
  {
    id: 'patent', name: '催眠专利附录', desc: '一份一本正经又荒诞的助眠专利附录',
    task: '用一本正经的专利文书口气，写一份荒诞又温柔的「助眠装置专利 · 附录」：装置名称、技术领域、实施例 1–3、注意事项。读起来要越来越慢、越来越困，最后一条注意事项是对 {{user}} 说的晚安。300–450 字。',
  },
];

/** 双语电台：每段中文后面跟一个 <语音>外语</语音>，念外语、字幕两种都显示 */
export const parseRadioSegments = (text: string): { zh: string; voice: string }[] => {
  if (!/<语音/.test(text)) {
    return text.split(/\n+/).map(t => t.trim()).filter(Boolean).map(t => ({ zh: t, voice: t }));
  }
  const out: { zh: string; voice: string }[] = [];
  const re = /([\s\S]*?)<语音[^>]*>([\s\S]*?)<\/语音>/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(text))) {
    const zh = m[1].trim(); const v = m[2].trim();
    if (zh || v) out.push({ zh: zh || v, voice: v || zh });
    last = re.lastIndex;
  }
  const tail = text.slice(last).trim();
  if (tail) out.push({ zh: tail, voice: tail });
  return out;
};

export async function playRadio(char: CharacterProfile, apiConfig: APIConfig, channel: RadioChannel, voiceLang = ''): Promise<RadioPiece> {
  const ch = RADIO_CHANNELS.find(c => c.id === channel)!;
  const recent = loadFootnote().radio.filter(r => r.charId === char.id && r.channel === channel).slice(0, 10).map(r => r.title);
  const { text } = await call(char, apiConfig,
    `### 【页脚 · 深夜点播机：${ch.name}】
现在是睡前，你在给 {{user}} 点播。
${ch.task}
这是要念出来的电台：用你自己说话的语气，压低声音、慢一点；写成很多个短段落，每段一到三句话，像一句一句讲给 ta 听。不要写成报告。
不要重复最近讲过的：${recent.join('、') || '（还没有）'}
第一行写一个短标题（10 字以内），空一行后写正文。不要用 Markdown 符号。${voiceLang ? `

### 双语
真正念出来的是${voiceLanguagePromptLabel(voiceLang)}。每一段先写中文（给 ta 看的字幕），紧接着换行写 <语音>这一段的${voiceLanguagePromptLabel(voiceLang)}说法</语音>。外语要自然口语，像你本人在说，不要机翻味；中文和外语意思一致。每段只有一个 <语音> 标签。` : ''}`, '开始吧。', `深夜点播·${ch.name}`, voiceLang ? 9000 : 5000);
  const lines = text.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim().split('\n');
  const title = (lines.shift() || ch.name).replace(/^标题[:：]\s*/, '').trim().slice(0, 30);
  const piece: RadioPiece = { id: uid('rd'), charId: char.id, channel, title, text: lines.join('\n').trim(), createdAt: Date.now(), ...(voiceLang ? { voiceLang } : {}) };
  updateFootnote(s => ({ ...s, radio: [piece, ...s.radio] }));
  return piece;
}
