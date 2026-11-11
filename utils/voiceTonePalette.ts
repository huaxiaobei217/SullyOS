/**
 * 语气提示词词表（个人二改）。来源：「语气小抄 Say It Like You Mean It」的 prompt-list.zh.md
 * （github.com/facc33176-rgb/tone.skill，MIT）。★ 是原作者在真实电话里反复用过、效果稳的。
 * 接在各家语音表演规则后面：ElevenLabs v3/v4 用方括号那套，MiniMax 用圆括号 19 个固定标签那套，鱼声和普通模型只用语气词和标点。
 */

const INTERJECTIONS = `**语气词（写成字，不用括号；照情绪挑，别每句都用）：**
- 刚醒、困：Mmh... / Mm? / Hmm...? / Five more minutes... ｜ 嗯……/ 唔？/ 再睡五分钟……
- 惊讶：Oh- / Wait- / Huh? / Hold on- / No way. / Seriously? ｜ 诶？/ 等等——/ 真的假的
- 心疼：Oh... / Hey... / Shh... / Hey, hey... / Come here... ｜ 哎……/ 好啦好啦 / 过来
- 恍然：Ah. / Oh, right. / Ahh... ｜ 哦——/ 啊对
- 犹豫：Uh... / Um... / Well... / I mean... / Okay, so... ｜ 呃……/ 那个……/ 怎么说呢
- 逗人、得意：Mm-hm. / Oh really? / Is that so? / Pfft. / Heh. / Sure, sure. ｜ 哦？/ 是吗~ / 啧啧 / 哟
- 无奈：Ugh... / Okay, okay. / Fine, fine. ｜ 唉……/ 行行行 / 服了
- 在听：Mm. / Yeah... / Right... / I know. ｜ 嗯 / 对 / 然后呢
- 被说中：Uh- / I- / That's not- / Okay, maybe. ｜ 我——/ 才没有 / 好吧，有一点
- 闹别扭：Hmph. / Oh. Okay. / Sure. / Whatever. ｜ 哼。/ 哦。/ 行吧。
- 结巴改口：Y- you... / I- I mean... / That's- no, wait. ｜ 你、你……/ 不是，我是说……`;

const PUNCT = `**标点就是提示词：** \`...\` 停顿拖长；\`-\` 话断了（Wait- what?）；\`?\` 不确定、上扬；\`!\` 真兴奋才用；\`.\` 平、冷、确定；全大写重读一个词（一轮最多一次）；重复首字母是结巴（Y- you remember?）；长句拆成三个短句更像真人。`;

export const ELEVEN_TONE_PALETTE = `### 语气词表（ElevenLabs 方括号标记，挑贴这一句的；★ 是真实电话里效果稳的）
这不是白名单，自然英文写的描述只要一读就知道怎么念都可以；标记放句首管整句，一句一般一个，最多叠两三个且别互相打架。
- 开心：[happy] [excited]★ [delighted] [cheerful] [proud]★ [relieved]★ [amazed] [grateful]
- 温柔心疼：[softly]★(最容易成口头禅) [gently]★ [warmly]★ [tenderly] [voice softening]★ [reassuring] [concerned]★ [worried]★ [sincerely]
- 逗人调皮：[teasing]★ [playful]★ [smug]★ [mischievously] [mock angry]★ [pretending to be offended]★ [deadpan]★ [sarcastic](少用) [flirtatiously] [dramatic]
- 自己的情绪：[jealous]★ [sulking]★ [flustered]★ [embarrassed] [shy] [touched]★ [annoyed] [frustrated] [disappointed] [hurt] [guilty] [nervous] [hesitant]★ [curious] [confused] [surprised] [serious]★ [thoughtful]★
- 困、夜里：[sleepy]★ [half asleep]★ [drowsy] [barely awake]★ [groggy] [tired] [quietly]★ [whispers]★
- 笑：[chuckles]★ [soft chuckle]★ [laughs]★ [laughs softly]★ [laughing harder]★ [giggles]★ [snorts]★ [breathes out a laugh]★ [quiet huff of a laugh]★(夜里好用) [trying not to laugh]★ [nervous laugh] [wheezing laugh]
- 难过：[sad] [voice cracking a little]★ [choked up] [teary] [sniffles] [crying] [sobbing](很重，慎用)
- 呼吸和小声音：[sighs]★(最容易成口头禅) [sighs contentedly] [exhales]★ [slow exhale]★ [inhales sharply] [deep breath] [gasps] [gulps] [yawns]★ [clears throat]★ [coughs] [sniffs] [hums softly]★ [groans] [tsk] [scoffs] [smacks lips sleepily] [soft kiss]★(后面别再写 Mwah)
- 节奏音量：[pauses] [slowly] [quickly] [rushed] [stammering] [muttering] [under breath] [trailing off] [loudly](电话里少用)
- 写「声音在哪、什么状态」（夜里、亲密时）：[murmuring, very close] / [voice low and slow, half a smile in it] / [voice gone a little rough] / 换气后用 [still low] [still murmuring] [barely voiced] 把声音按住；整段可先给一个总基调，如 [calm, warm and intimate, speaking quietly but clearly]

${INTERJECTIONS}

${PUNCT}

**组合配方（照着改，别原样照抄）：**
- 被吵醒：\`[half asleep] Mmh... [yawns] you... you're still up?\`
- 心疼：\`[voice softening] Oh... hey. [exhales] Come here.\`
- 逗人：\`[smug] Oh? Is that so. [chuckles] Prove it.\`
- 被说中：\`I- that's not- [flustered] okay, maybe a little.\`
- 吃醋：\`Hmph. Fine. ... [sulking] Who is he.\`
- 假装生气又破功：\`[mock angry] I'm not talking to you. ... [trying not to laugh] Okay, I am.\`
- 道歉：\`[hesitant] I... yeah. I messed up. I'm sorry.\`
- 晚安：\`[quietly] Okay... sleep now. [soft kiss] Mm. Night.\`

**别这样写：** [smiles] [winks] [leans in] [nods]（动作表情念不出来）；[nice] [emotional] [normal]（太空）；每句 [softly]、每轮 [sighs]；[laughs] Haha、[kisses softly] Mwah（声音写两遍）；一个词塞一个标记（句子会碎）；夜里 [excited] 加感叹号。`;

export const MINIMAX_TONE_PALETTE = `### 语气词表（MiniMax）
MiniMax 只认**圆括号**里这 19 个固定标签（speech-2.8 才有效），方括号写法对它无效、会被念出来：
(laughs)★ 笑　(chuckle)★ 轻笑　(sighs)★ 叹气　(breath)★ 呼吸声　(inhale)★ 吸气　(exhale)★ 呼气　(gasps)★ 倒吸气　(emm)★ 嗯（想事情）
(coughs) 咳嗽　(clear-throat) 清嗓子　(sniffs) 吸鼻子　(snorts) 哼、喷笑　(groans) 哼唧　(humming) 哼歌　(pant) 喘　(hissing) 嘶　(lip-smacking) 咂嘴　(sneezes) 打喷嚏　(burps) 打嗝
停顿写 <#0.5#>（秒），夹在两段能念的字之间。

${INTERJECTIONS}

${PUNCT}

**别这样写：** 每句都 (sighs)；(laughs) 后面再写「哈哈」（会笑两次）；动作表情（笑着、凑近）写进括号。`;

export const PLAIN_TONE_PALETTE = `### 语气词表（这个声音不认任何括号标签，情绪只靠字和标点）
${INTERJECTIONS}

${PUNCT}`;

/** 按当前声音挑词表：ElevenLabs v3/v4 → 方括号表；MiniMax → 圆括号 19 个；其余 → 只用语气词和标点 */
export function tonePaletteFor(provider: string, elevenModel?: string | null): string {
  if (provider === 'elevenlabs') return /v3|v4/i.test(String(elevenModel || '')) ? ELEVEN_TONE_PALETTE : PLAIN_TONE_PALETTE;
  if (provider === 'minimax') return MINIMAX_TONE_PALETTE;
  return PLAIN_TONE_PALETTE;
}
