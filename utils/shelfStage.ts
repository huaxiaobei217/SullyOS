/**
 * 书影架 · 演出模式的「场记」（个人二改，思路参考 MoRead 1.5 的演出模式，代码自己写的）
 * 把一章原文编成一拍一拍：旁白、对白（带名牌）、心声、拟声、系统提示、场景分隔、聊天记录、对句海报。
 * 屏幕上的字逐字来自原文，分类和氛围只是元数据；拿不准就当旁白（宁缺毋滥）。
 * 氛围（布景 / 时段 / 天气 / 光源 / 情绪）只从已经演到的旁白里更新，不往后看。
 */

export type BeatKind = 'title' | 'narration' | 'dialogue' | 'thought' | 'sfx' | 'system' | 'break' | 'poster' | 'chat';
export type Scene = 'mountain' | 'sea' | 'river' | 'forest' | 'bamboo' | 'city' | 'indoor' | 'garden' | 'campus' | 'village' | 'desert' | null;
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night' | null;
export type Weather = 'rain' | 'storm' | 'snow' | 'wind' | 'fog' | null;
export type Light = 'candle' | 'fire' | 'lamp' | 'neon' | null;
export type Mood = 'tense' | 'sad' | 'warm' | null;

export interface Atmo { scene: Scene; time: TimeOfDay; weather: Weather; light: Light; mood: Mood; moodLeft: number }
export interface ChatLine { who: string; text: string }
export interface Beat {
  kind: BeatKind;
  text: string;
  /** 对白名牌（拿不准就不给） */
  speaker?: string;
  /** 提示语，比如「他压低声音说」 */
  cue?: string;
  /** 原文第几段（退出时回到这里） */
  para: number;
  /** 聊天记录容器：到这一拍为止累积的消息 */
  chat?: ChatLine[];
  fx?: 'big' | 'shake' | 'slow' | null;
  atmo: Atmo;
}

export const EMPTY_ATMO: Atmo = { scene: null, time: null, weather: null, light: null, mood: null, moodLeft: 0 };

const PRONOUNS = new Set(['他', '她', '它', '我', '你', '您', '他们', '她们', '我们', '你们', '大家', '众人', '对方', '那人', '这人', '有人', '两人', '二人', '少年', '少女', '男人', '女人', '老人', '孩子']);
const SPEECH_VERB = '(?:说|道|问|答|喊|叫|嚷|骂|吼|笑|叹|嘟囔|嘀咕|开口|回答|补充|打断|低语|应)';
const ADVERB = '(?:[\\u4e00-\\u9fa5]{0,4}地|笑着|冷冷|淡淡|轻声|低声|小声|大声|沉声|柔声|忍不住|又|也|才|便|就|却|还|立刻|连忙|赶紧|随口|缓缓)?';

const QUOTE_RE = /“([^”]*)”|「([^」]*)」|"([^"]*)"/g;
const THOUGHT_QUOTE_RE = /‘([^’]*)’|『([^』]*)』/g;
const THINK_WORD = /心想|暗想|心道|心里想|暗自|心中|默念|暗道/;
const SFX_CHARS = /[砰轰啪咚嘭哗咔嗡叮咣嘀嗒呼咻嗖嘶滴铃噗咕吱嘎呜喀唰嘣]/;

const isBreak = (p: string) => /^[\s*＊·•—\-=~～◇◆○●#◎☆★…]{2,}$/.test(p.trim()) || /^[\s]*(?:\*\s*){3,}$/.test(p);
const isSystem = (p: string) => /^\s*【[^】]{1,120}】\s*$/.test(p) || /^\s*\[[^\]]{1,120}\]\s*$/.test(p);
const isSfx = (p: string) => {
  const t = p.trim().replace(/[“”「」"]/g, '');
  if (t.length > 9 || t.length < 1) return false;
  return SFX_CHARS.test(t) && (/[！!—～~]/.test(t) || /(.)\1/.test(t));
};
const CHAT_LINE_RE = /^\s*([^：:“”"「」‘’『』【】\[\]\s]{1,12})\s*[：:]\s*(?![“「"‘『])(.{1,200})$/;
const CHAT_LINE = { test: (p: string) => { const m = p.match(CHAT_LINE_RE); return !!m && !THINK_WORD.test(m[1]) && !new RegExp(SPEECH_VERB + '$').test(m[1]); } };
const isPoster = (p: string) => {
  const m = p.trim().match(/^([^，。！？“”「」,!?]{3,5})[，,]([^，。！？“”「」,!?]{3,5})[。！!]?$/);
  if (!m || m[1].length !== m[2].length) return false;
  if (/[我你他她它们了吗呢吧啊呀]/.test(m[1] + m[2])) return false;
  // 两半要有同位同字（「粗看离谱，细看合理」的「看」）
  for (let i = 0; i < m[1].length; i++) if (m[1][i] === m[2][i]) return true;
  return false;
};

/** 句子切分：句末标点处断开，太碎的合并，太长的再断 */
function splitSentences(text: string, min = 14, max = 70): string[] {
  const raw = text.match(/[^。！？!?…]+(?:[。！？!?]+|…+|$)[”」’』]?/g) || [text];
  const out: string[] = [];
  let buf = '';
  for (const s0 of raw) {
    const s = s0.trim(); if (!s) continue;
    if (!buf) buf = s;
    else if (buf.length < min || (buf + s).length <= Math.min(max, 36)) buf += s;
    else { out.push(buf); buf = s; }
  }
  if (buf) out.push(buf);
  // 太长的按逗号再拆
  return out.flatMap(s => {
    if (s.length <= max) return [s];
    const parts = s.match(/[^，,；;]+[，,；;]?/g) || [s];
    const res: string[] = []; let b = '';
    for (const p of parts) { if ((b + p).length > max && b) { res.push(b); b = p; } else b += p; }
    if (b) res.push(b);
    return res;
  });
}

/* ───── 氛围 ───── */
const RULES: { re: RegExp; apply: (a: Atmo) => void }[] = [
  { re: /暴雨|雷声|雷鸣|闪电|电闪|雷雨|惊雷/, apply: a => { a.weather = 'storm'; } },
  { re: /下雨|雨水|雨声|雨点|雨丝|细雨|小雨|大雨|雨夜|阵雨|淋雨|雨幕|撑伞/, apply: a => { if (a.weather !== 'storm') a.weather = 'rain'; } },
  { re: /下雪|雪花|大雪|积雪|雪地|飘雪|风雪|白雪/, apply: a => { a.weather = 'snow'; } },
  { re: /狂风|寒风|大风|风声|呼啸|北风/, apply: a => { if (!a.weather) a.weather = 'wind'; } },
  { re: /大雾|浓雾|雾气|薄雾|雾中/, apply: a => { a.weather = 'fog'; } },
  { re: /雨停|放晴|天晴|晴朗|万里无云|雨过天晴/, apply: a => { a.weather = null; } },
  { re: /深夜|午夜|夜色|夜里|夜晚|月光|月色|星空|夜幕|半夜|凌晨|今夜|入夜/, apply: a => { a.time = 'night'; } },
  { re: /清晨|黎明|破晓|拂晓|天刚亮|晨光|早晨|一早/, apply: a => { a.time = 'dawn'; } },
  { re: /黄昏|傍晚|夕阳|落日|暮色|晚霞|日落/, apply: a => { a.time = 'dusk'; } },
  { re: /中午|正午|白天|午后|上午|下午|烈日|阳光/, apply: a => { a.time = 'day'; } },
  { re: /大海|海边|海浪|海面|沙滩|海风|浪花|海岸|码头|甲板/, apply: a => { a.scene = 'sea'; } },
  { re: /江边|河边|湖边|湖面|溪水|小溪|江面|河水|河岸|桥下/, apply: a => { a.scene = 'river'; } },
  { re: /竹林|竹影|竹叶/, apply: a => { a.scene = 'bamboo'; } },
  { re: /森林|树林|林子|林间|密林|丛林/, apply: a => { a.scene = 'forest'; } },
  { re: /山顶|山路|山间|山谷|悬崖|山峰|半山|群山|山脚/, apply: a => { a.scene = 'mountain'; } },
  { re: /沙漠|戈壁|沙丘/, apply: a => { a.scene = 'desert'; } },
  { re: /村子|村口|田野|田埂|麦田|乡下|农家/, apply: a => { a.scene = 'village'; } },
  { re: /庭院|院子里|回廊|凉亭|亭子|花园|假山|府中|府里/, apply: a => { a.scene = 'garden'; } },
  { re: /校园|操场|教学楼|学校门口|走廊尽头|社团/, apply: a => { a.scene = 'campus'; } },
  { re: /街道|街上|街头|马路|大楼|车站|地铁|商场|写字楼|路口|巷子|城市|霓虹/, apply: a => { a.scene = 'city'; } },
  { re: /房间|屋里|屋内|室内|客厅|卧室|办公室|教室|厨房|书房|床上|沙发|窗边|门口|宿舍|病房|公寓/, apply: a => { a.scene = 'indoor'; } },
  { re: /烛光|蜡烛|烛火|油灯|灯烛/, apply: a => { a.light = 'candle'; } },
  { re: /篝火|火堆|壁炉|炉火|火光/, apply: a => { a.light = 'fire'; } },
  { re: /台灯|路灯|灯光|灯下|吊灯/, apply: a => { if (!a.light) a.light = 'lamp'; } },
  { re: /霓虹/, apply: a => { a.light = 'neon'; } },
  { re: /熄灭|吹灭|关了灯|关灯|灯灭/, apply: a => { a.light = null; } },
  { re: /心跳加速|紧张|屏住呼吸|冷汗|恐惧|危险|颤抖|毛骨悚然|杀气/, apply: a => { a.mood = 'tense'; a.moodLeft = 14; } },
  { re: /眼泪|哭了|哭泣|悲伤|难过|泪水|哽咽|心碎/, apply: a => { a.mood = 'sad'; a.moodLeft = 14; } },
  { re: /温暖|拥抱|相视一笑|笑了起来|轻笑|温柔/, apply: a => { a.mood = 'warm'; a.moodLeft = 14; } },
];
const NEGATED = (text: string, at: number) => /(?:不|没|没有|未|无|别|不是)$/.test(text.slice(Math.max(0, at - 3), at));
const SIMILE = (text: string, at: number) => /(?:像|仿佛|如同|好似|犹如|宛如|似的|般的)/.test(text.slice(Math.max(0, at - 5), at));

export function updateAtmo(prev: Atmo, narration: string): Atmo {
  const a: Atmo = { ...prev };
  if (a.moodLeft > 0) { a.moodLeft--; if (!a.moodLeft) a.mood = null; }
  for (const r of RULES) {
    const m = r.re.exec(narration);
    if (!m) continue;
    if (NEGATED(narration, m.index) || SIMILE(narration, m.index)) continue;
    r.apply(a);
  }
  return a;
}

/* ───── 说话人词表：只用已经读过的正文 ───── */
export function harvestNames(texts: string[]): Map<string, number> {
  const count = new Map<string, number>();
  const re = new RegExp(`([\\u4e00-\\u9fa5·]{2,6}?)${ADVERB}${SPEECH_VERB}`, 'g');
  for (const t of texts) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(t))) {
      let n = m[1];
      // 去掉前面粘上的虚词（「于是林默说」→ 林默）
      n = n.replace(/^(?:于是|然后|这时|此时|只见|只听|随后|接着|听到|看着|对着|朝着|向|对|和|跟|被|把|让|叫|是|的|了|，)+/, '');
      if (n.length < 2 || n.length > 4 || PRONOUNS.has(n)) continue;
      count.set(n, (count.get(n) || 0) + 1);
    }
  }
  return count;
}

function speakerFrom(cue: string, names: Map<string, number>): string | undefined {
  // 提示语里出现的已知名字（读过的正文里至少当过两次说话人），取离说话动词最近、在它前面的那个
  const verb = new RegExp(SPEECH_VERB).exec(cue);
  const verbAt = verb ? verb.index : cue.length;
  let best: string | undefined; let bestAt = -1;
  for (const [n, c] of names) {
    if (c < 2) continue;
    let at = cue.lastIndexOf(n, verbAt);
    if (at < 0 && !verb) at = cue.indexOf(n);
    if (at >= 0 && (at > bestAt || (at === bestAt && best && n.length > best.length))) { best = n; bestAt = at; }
  }
  if (best) return best;
  return undefined;
}

const fxOf = (t: string): Beat['fx'] => {
  if (/([一-龥])、\1/.test(t)) return 'shake';
  if (/！{2,}|!{2,}|！$/.test(t) && t.length <= 24) return 'big';
  if (/…{2,}|\.{6,}/.test(t)) return 'slow';
  return null;
};

/**
 * 编一章。startAtmo 是上一章结尾的氛围（章首承接）；names 是到这一章为止读过的正文里挖出来的说话人。
 */
export function compileChapter(title: string, paras: string[], names: Map<string, number>, startAtmo: Atmo = EMPTY_ATMO): Beat[] {
  const beats: Beat[] = [];
  let atmo: Atmo = { ...startAtmo };
  let posters = 0;
  beats.push({ kind: 'title', text: title, para: 0, atmo });

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i].trim();
    if (!p) continue;

    if (isBreak(p)) { beats.push({ kind: 'break', text: '', para: i, atmo }); continue; }
    if (isSystem(p)) { beats.push({ kind: 'system', text: p.replace(/^\s*[【[]|[】\]]\s*$/g, ''), para: i, atmo }); continue; }
    if (isSfx(p)) { beats.push({ kind: 'sfx', text: p.replace(/[“”「」"]/g, ''), para: i, fx: 'shake', atmo }); continue; }
    if (posters < 1 && isPoster(p)) { posters++; beats.push({ kind: 'poster', text: p.replace(/[。！!]$/, ''), para: i, atmo }); continue; }

    // 聊天记录：连续两段以上「名字：内容」
    if (CHAT_LINE.test(p) && i + 1 < paras.length && CHAT_LINE.test(paras[i + 1].trim())) {
      const acc: ChatLine[] = [];
      let j = i;
      while (j < paras.length && CHAT_LINE.test(paras[j].trim()) && acc.length < 40) {
        const m = paras[j].trim().match(CHAT_LINE_RE)!;
        acc.push({ who: m[1], text: m[2] });
        beats.push({ kind: 'chat', text: m[2], speaker: m[1], para: j, chat: acc.slice(), atmo });
        j++;
      }
      i = j - 1;
      continue;
    }

    // 有引号：对白（引号外是提示语）
    QUOTE_RE.lastIndex = 0;
    const quotes: { text: string; start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = QUOTE_RE.exec(p))) quotes.push({ text: (m[1] ?? m[2] ?? m[3] ?? '').trim(), start: m.index, end: m.index + m[0].length });
    const quoteChars = quotes.reduce((s, q) => s + q.text.length, 0);
    if (quotes.length && quoteChars >= 2) {
      const outside = (p.slice(0, quotes[0].start) + ' ' + quotes.slice(1).map((q, k) => p.slice(quotes[k].end, q.start)).join(' ') + ' ' + p.slice(quotes[quotes.length - 1].end)).replace(/\s+/g, ' ').trim();
      // 引号外是大段叙述（不是提示语）：叙述单独一拍、更新氛围
      const lead = p.slice(0, quotes[0].start).trim();
      if (lead.length > 26) {
        atmo = updateAtmo(atmo, lead);
        for (const s of splitSentences(lead)) beats.push({ kind: 'narration', text: s, para: i, atmo });
      }
      const cue = outside.length <= 40 ? outside.replace(/^[，,。：:\s]+|[，,：:\s]+$/g, '') : '';
      const thinking = THINK_WORD.test(outside);
      const speaker = thinking ? undefined : speakerFrom(outside, names);
      for (const q of quotes) {
        if (!q.text) continue;
        for (const s of splitSentences(q.text, 6, 80)) {
          beats.push({ kind: thinking ? 'thought' : 'dialogue', text: s, speaker, cue: cue || undefined, para: i, fx: fxOf(s), atmo });
        }
      }
      const tail = p.slice(quotes[quotes.length - 1].end).trim();
      if (tail.length > 26) {
        atmo = updateAtmo(atmo, tail);
        for (const s of splitSentences(tail)) beats.push({ kind: 'narration', text: s, para: i, atmo });
      }
      continue;
    }

    // 心声：‘…’ / 『…』 或者「心想」
    THOUGHT_QUOTE_RE.lastIndex = 0;
    const th = [...p.matchAll(THOUGHT_QUOTE_RE)].map(x => (x[1] ?? x[2] ?? '').trim()).filter(Boolean);
    if (th.length && THINK_WORD.test(p)) {
      for (const t of th) beats.push({ kind: 'thought', text: t, para: i, atmo });
      continue;
    }

    // 旁白
    atmo = updateAtmo(atmo, p);
    for (const s of splitSentences(p)) {
      beats.push({ kind: THINK_WORD.test(s) && s.length < 40 ? 'thought' : 'narration', text: s, para: i, fx: fxOf(s), atmo });
    }
  }
  return beats;
}

/** 上一章结尾的氛围：把上一章最后 40 段的旁白过一遍 */
export function atmoAtEnd(paras: string[]): Atmo {
  let a = { ...EMPTY_ATMO };
  for (const p of paras.slice(-40)) if (!/[“「"]/.test(p)) a = updateAtmo(a, p);
  return { ...a, mood: null, moodLeft: 0 };
}

/** 一拍停留多久（自动播放） */
export const dwellMs = (b: Beat) => {
  if (b.kind === 'title') return 2600;
  if (b.kind === 'break') return 1400;
  if (b.kind === 'sfx' || b.kind === 'poster') return 2200;
  return Math.min(9000, 1300 + b.text.length * 120);
};

/** 声景：氛围 → 白噪音的哪一种（没有合适的就安静） */
export function soundFor(a: Atmo): 'storm' | 'rain' | 'waves' | 'stream' | 'fire' | 'wind' | 'night' | null {
  if (a.weather === 'storm') return 'storm';
  if (a.weather === 'rain') return 'rain';
  if (a.scene === 'sea') return 'waves';
  if (a.light === 'fire') return 'fire';
  if (a.scene === 'river') return 'stream';
  if (a.weather === 'wind' || a.weather === 'snow') return 'wind';
  if (a.time === 'night' && (a.scene === 'forest' || a.scene === 'village' || a.scene === 'mountain' || a.scene === 'garden' || a.scene === 'bamboo')) return 'night';
  return null;
}
