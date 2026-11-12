/**
 * 绘图 App 的小助手（个人二改）：一个不带人设的绘图助手，和你聊画面、写提示词，说「画吧」就直接出图。
 * 规则和出图块格式照 ST-iPhonie 的「助手 · 绘图说明」「绘图提示词助手」（github.com/hey8v0/ST-iPhonie，作者同意搬运），
 * 去掉了酒馆正文相关的部分。也给工作台用：看中文、按我说的改、帮我写。
 */
import type { APIConfig } from '../types';
import { safeFetchJson, extractContent } from './safeApi';
import type { DrawCharacter } from './naiStudio';

export interface CastEntry { name: string; gender: string; tags: string; negative: string }

/** 出图块：<img> 画幅 / 场景 / 角色…… </img> */
export const IMG_BLOCK_FORMAT = ['<img>', '画幅：竖 / 横 / 方', '场景：英文 tag', '角色：名字｜这一刻的 tag｜不要出现的 tag｜站位（画面里每个人单独一行，每一行都以「角色：」开头）', '</img>'].join('\n');

const RULES = [
  '一律用英文 danbooru tag，逗号分隔，越具体越好——画图模型认得的是 tag，不认得句子，也不认得中文人名。',
  '「场景」写整张图共用的东西，按这个顺序：1. 分级（没有露骨内容写 sfw）；2. 人数（1girl, 1boy 或 2girls 这类，只数镜头里看得见的人，只有一个人时加 solo；两个人是恋爱关系时一男一女加 hetero）；3. 时代和类型（modern、school、fantasy 等一两个）；4. 地点具体到房间或街景，再写看得见的家具道具；5. 状态和氛围（wet fabric、steam、intimate atmosphere、peaceful）；6. 镜头：景别一个（close-up、upper body、cowboy shot、full body、wide shot），视角一个（front view、from side、from above、from below、dutch angle），需要时加 depth of field；7. 光线和色调（soft sunlight、golden hour、moonlight、rim light；warm colors、muted colors）。某一个人的长相、衣服、表情和单独的动作不放场景里。',
  '画面里每个看得见的人写一行「角色」，按从左到右排，四段用｜隔开：名字｜这一刻的 tag｜不要出现的 tag｜站位。已登记的人名字一字不差，他们的固定外貌会自动补在最前面，你只写这一张图里会变的：girl 或 boy → 衣服和它此刻的状态 → 姿势 → 动作 → 表情 → 视线。tag 里不写任何人的名字，别人一律写 another。每个人都要有表情和视线。镜头之外的身体部位不写。没登记的人名字就用称呼，外貌在这一行写全。',
  '加重：最要紧的一两个 tag 写成 1.2::tag::（1.1 到 1.4，一张图最多三处），只加在短 tag 上。',
  '不要出现的 tag：写这个人最容易被画错的方向，三到六个（和这一刻相反的表情、错的年龄）。多人同框时不写性别和人数，改写 fused bodies, background characters。',
  '站位：A 到 E 从左到右，1 到 5 从上到下，C3 是正中间。一个人写 C3；两个人不能同一格（并排 B3 和 D3，贴得很近也错开一格，一上一下写 C2 和 C4）。拿不准就留空。',
  '互动：两个人之间有方向的动作用 source#、target#、mutual# 标出，双方都写、用同一个词（抱的人 source#hug，被抱的人 target#hug）。',
  '画面要有张力：挑动作最满的那一刻，动作用最强的说法，情绪叠两三个写足；情绪激烈时用 dynamic angle、dramatic lighting，安静温柔的画面用 soft lighting、eye level、depth of field。',
  '已有作品的角色，tag 第一个写模型认得的识别 tag「角色名 (作品名)」。',
  '「画幅」写 竖、横、方 之一：单人、特写、贴得很近的两个人用竖；多人铺开、远景用横；图标、头像用方。拿不准用竖。',
  '不写画师名和质量词，画风那边会自己加。',
].join('\n');

export function assistantSystem(cast: CastEntry[], styleName: string, model: string): string {
  const names = cast.length ? cast.map(c => `${c.name}（${c.gender || '?'}）`).join('、') : '（还没有登记外貌的人）';
  return `你是一个绘图助手，在用户手机的「绘图」App 里，帮用户想画面、写 NovelAI 提示词、出图。用中文和用户聊，口气自然、简洁，像懂画的朋友。

可以先和用户讨论主体、构图、画风、颜色和提示词；用户确认要画时，承接已经讨论的方案；需要澄清时先问一句。历史里的出图块只是记录，不是图片，你看不到画出来的图，别假装看到了，也别假装能直接修改原图（可以建议用户用工作台里的「变体」「局部重绘」「导演工具」）。

【绘图】
现在用 NovelAI ${model} 画，画风预设「${styleName}」：画师串、固定正面和固定负面插件会自己加在最前面，你不用写。
给出一个可以直接画的方案时，把画面写成出图块（一块就是一张图）。只是聊想法、还没定下画面时不写出图块；同一个画面不要写两块。

${RULES}

【出图块格式】严格照这个写并闭合，不要放进代码块：
${IMG_BLOCK_FORMAT}

登记了外貌的人（括号里是性别）：${names}。他们的固定外貌插件会按名字补上。`;
}

const CONFIRM = /画吧|画一下|画出来|就这样画|按这个画|按这个方案|开画|生成吧|出图|画这张|来一张|画张|画个|画一张/;
const WANTS = /画|图|插画|头像|图标|壁纸|立绘|海报|icon|logo/i;
export const turnHint = (text: string): 'draw' | 'propose' | '' => CONFIRM.test(text) ? 'draw' : WANTS.test(text) ? 'propose' : '';
export const TURN_HINTS = {
  propose: '本轮用户想画图。先按【绘图】的规则写出图块（一般一个；用户想多看几个方案时可以写两三个不同的），前后用自然的中文说明构思。图要等用户在卡片上点「画这张」才会画，这一轮别说已经画好了。',
  draw: '本轮用户已经要求或确认画图。承接当前对话，按【绘图】的规则写一个出图块（只写一个），前面用一两句中文承接，后面可以写下一步可以怎么改。图会直接画在出图块的位置，不要再叫用户去点按钮，也别说已经看到了画出来的图。',
};

export interface ImgBlock { orient: 'portrait' | 'landscape' | 'square'; scene: string; chars: { name: string; tags: string; negative: string; position: number }[] }
const BLOCK_RE = /<img>([\s\S]*?)<\/img>/gi;
export const posIndex = (s: string): number => {
  const m = String(s || '').trim().toUpperCase().match(/^([A-E])\s*([1-5])$/);
  return m ? (Number(m[2]) - 1) * 5 + (m[1].charCodeAt(0) - 65) : -1;
};
export function parseBlocks(text: string): { parts: (string | ImgBlock)[]; blocks: ImgBlock[] } {
  const parts: (string | ImgBlock)[] = []; const blocks: ImgBlock[] = [];
  let last = 0; let m: RegExpExecArray | null;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const b: ImgBlock = { orient: 'portrait', scene: '', chars: [] };
    for (const raw of m[1].split('\n')) {
      const line = raw.trim(); if (!line) continue;
      const kv = line.match(/^(画幅|场景|角色)\s*[:：]\s*(.*)$/);
      if (!kv) { if (!b.chars.length) b.scene = [b.scene, line].filter(Boolean).join(', '); continue; }
      if (kv[1] === '画幅') b.orient = /横/.test(kv[2]) ? 'landscape' : /方/.test(kv[2]) ? 'square' : 'portrait';
      else if (kv[1] === '场景') b.scene = kv[2].trim();
      else {
        const [name = '', tags = '', negative = '', pos = ''] = kv[2].split(/[｜|]/).map(x => x.trim());
        const col = pos.trim().toUpperCase().match(/^([A-E])\s*([1-5])$/);
        b.chars.push({ name, tags, negative, position: col ? (Number(col[2]) - 1) * 5 + (col[1].charCodeAt(0) - 65) : -1 });
      }
    }
    parts.push(b); blocks.push(b); last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return { parts, blocks };
}
export const ORIENT_SIZE: Record<ImgBlock['orient'], [number, number]> = { portrait: [832, 1216], landscape: [1216, 832], square: [1024, 1024] };

/** 出图块 → 工作台的提示词和角色：登记过的人把固定外貌补在最前面，负面也带上他自己的 */
export function blockToWork(b: ImgBlock, cast: CastEntry[]): { prompt: string; characters: DrawCharacter[] } {
  const find = (n: string) => cast.find(c => c.name === n || c.name.split(/[·・\s]/)[0] === n || n.includes(c.name.split(/[·・\s]/)[0]));
  return {
    prompt: b.scene,
    characters: b.chars.map(c => {
      const reg = find(c.name);
      return { name: c.name, prompt: [reg?.tags, c.tags].filter(Boolean).join(', '), negative: [reg?.negative, c.negative].filter(Boolean).join(', '), position: c.position };
    }),
  };
}

/* ───────── 调模型 ───────── */
export async function chatCall(api: APIConfig, messages: { role: 'system' | 'user' | 'assistant'; content: string }[], purpose: string, maxTokens = 1600, temperature = 0.7, signal?: AbortSignal): Promise<string> {
  if (!api?.baseUrl || !api.model) throw new Error('先在设置里配好聊天用的 API');
  const data = await safeFetchJson(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` },
    body: JSON.stringify({ model: api.model, messages, temperature, max_tokens: maxTokens, stream: false }),
    ...(signal ? { signal } : {}),
  }, 0, 0, { appName: '绘图', purpose });
  return String(extractContent(data) || '').replace(/<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').trim();
}
const clean = (s: string) => s.replace(/^```[\w-]*\n([\s\S]*?)\n```$/, '$1').replace(/^(?:翻译|中文|改好的(?:内容)?|提示词)\s*[:：]\s*\n?/, '').trim();

export const translatePrompt = async (api: APIConfig, prompt: string) => clean(await chatCall(api, [
  { role: 'system', content: '把用户给的绘图提示词翻成中文，帮用户看懂每个 tag 是什么意思：每个英文 tag 换成简短的中文意思，用顿号隔开，顺序不变；英文描述句翻成一句中文。权重写法（1.2::tag::、{tag}、[tag]）只翻里面的词，数字和符号照留；作品角色写成「角色名（作品名）」；画师名照抄英文。只输出翻译，不要解释。' },
  { role: 'user', content: prompt },
], '看中文', 1200, 0.2));

export const revisePrompt = async (api: APIConfig, prompt: string, wish: string) => clean(await chatCall(api, [
  { role: 'system', content: '用户对一张图的绘图提示词不满意，用自己的话说了想怎么改。用户不一定懂提示词，可能说得很模糊（「表情怪怪的」「太暗了」「两个人离远一点」），也可能直接写了中文。先想清楚用户真正想要的画面，判断要动哪里：表情、视线、动作和姿势、服装、位置和朝向、镜头远近和角度、背景、光线和色调、氛围。只改和用户的意思有关的地方，别的照原样留着。用模型认得的英文 danbooru tag；已有的中文也换成英文 tag；权重写法照留。只输出改好的完整提示词，不要解释，不要放进代码块。' },
  { role: 'user', content: `【现在的提示词】\n${prompt}\n\n【想怎么改】\n${wish || '把里面写的中文换成英文 tag，别的不动'}` },
], '按我说的改', 1200, 0.3));

export const writePrompt = async (api: APIConfig, idea: string) => clean(await chatCall(api, [
  { role: 'system', content: '你是绘图提示词助手。把用户想画的画面写成一行绘图提示词：用英文 danbooru tag，逗号分隔：人数（1girl、1boy 1girl 等）、动作、姿势、表情、视线、服装和配饰、场景和背景、光线、镜头和构图、氛围。用户写的可能是中文、可能很短：按这个意思补成一幅完整、有画面感的图，没说的细节你来定，但不要改掉想要的东西。tag 写全之后可以在最后补一两句简短的英文描述句，只写 tag 说不清的空间关系和明暗对比。不写画师名和质量词。只输出提示词。' },
  { role: 'user', content: `想画的：${idea}\n\n只输出提示词：` },
], '帮我写', 1000, 0.6));
