/**
 * 说话习惯漂移提醒（个人二改）：模型会照着自己最近的回复学，越写越长、越来越爱叮嘱、每轮一个模子。
 * 看他最近几轮，真漂了才在这一轮提醒一句；没漂什么都不加。只在手机聊天里用（见面、电话不走这里）。
 *
 *  - 气泡长度：一条平均超过 22 字、六成以上超过 15 字 → 拆短
 *  - 一轮发太多条：最近 6 轮平均超过 6 条 → 这轮短一点
 *  - 每轮表情包收尾：最近 6 轮有 5 轮最后一条是表情包 → 这轮别拿表情包收尾
 *  - 每轮汇报自己在干嘛：最近 6 轮有 5 轮都有「我刚 / 我这」→ 这轮不用汇报
 *  - 点评她在听的歌：最近 3 轮里说过「耳机里 / 切到 / 这首」→ 这轮别提
 *  - 语音：开头总用同一类方括号标签、语音太长、太多轮都发语音 → 各提醒一句
 *  - 叮嘱：她说过「不用提醒 / 别管我」的，记 7 天（她是傲娇：认真说的别再提，撒娇讨关心可以接，用玩笑或陪着代替叮嘱）；
 *          今天已经叮嘱过 2 次以上，这轮别再叮嘱
 */
interface MsgLite { role: string; type?: string; content?: unknown; timestamp?: number }

const NAG = /记得|别忘了|赶紧|快去|先去|去把|早点睡|早点休息|记住|乖乖|按时|多喝水|别熬|多穿|穿厚|带(把)?伞|喝(杯|口|点)?(热|温)水|别着凉|别盯着?(手机|屏幕)|吃饭了没|吃了没/;
const STOP_NAG = /(不用|别|不要|少)(再)?(提醒|催|管|操心|念叨|啰嗦|唠叨)/;
const MUSIC_TALK = /耳机里|切(到|成|了)|这首|歌单里|BGM/;
const SELF_REPORT = /我刚|我这(边|儿|会儿)?|我正/;

const text = (m: MsgLite) => String(m.content ?? '');
const isEmojiMsg = (m: MsgLite) => m.type === 'emoji' || /^\[emoji\]/.test(text(m));
const VOICE_RE = /<[语語]音[^>]*>([\s\S]*?)<\/\s*[语語]音\s*>/;

/** 连续的角色消息算一轮 */
function assistantTurns(msgs: MsgLite[]): MsgLite[][] {
  const turns: MsgLite[][] = []; let cur: MsgLite[] = [];
  for (const m of msgs) {
    if (m.role === 'assistant') cur.push(m);
    else if (m.role === 'user') { if (cur.length) { turns.push(cur); cur = []; } }
  }
  if (cur.length) turns.push(cur);
  return turns;
}

const openerWords = (voice: string): string[] => {
  const m = voice.trim().match(/^\[([^\]]+)\]/);
  if (!m) return [];
  return m[1].toLowerCase().split(/[,\s]+/).filter(w => w.length > 3);
};

export function buildStyleDriftBlock(msgs: MsgLite[], userName: string, now = Date.now()): string {
  const all = (msgs || []).filter(m => m && (m.role === 'assistant' || m.role === 'user'));
  const lines: string[] = [];

  // 气泡长度（只看普通文字气泡）
  const list = all.filter(m => m.role === 'assistant' && (m.type || 'text') === 'text').map(text)
    .map(t => t.trim()).filter(t => t && !/^[<[]/.test(t) && !/^https?:\/\//.test(t)).slice(-30);
  if (list.length >= 12) {
    const lens = list.map(t => [...t.replace(/\s+/g, '')].length);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    const long = lens.filter(n => n > 15).length / lens.length;
    if (avg > 22 && long > 0.6) lines.push(`你最近的气泡越写越长（平均 ${Math.round(avg)} 个字）。回到你平时的打字习惯：一条 3～15 个字`);
  }

  const turns = assistantTurns(all).slice(-6);
  if (turns.length >= 4) {
    const avgCount = turns.reduce((a, t) => a + t.length, 0) / turns.length;
    if (avgCount > 6) lines.push(`你最近一轮要发 ${Math.round(avgCount)} 条，太满了。这轮话说完就停，两三条也行，不用每轮都把损人、语音、近况、点评、叮嘱全来一遍`);
    const emojiEnd = turns.filter(t => isEmojiMsg(t[t.length - 1])).length;
    if (emojiEnd >= Math.min(5, turns.length)) lines.push(`你最近每轮最后都甩一张表情包。这轮别拿表情包收尾（真想发就放中间，或者干脆不发）`);
    const reports = turns.filter(t => t.some(m => SELF_REPORT.test(text(m)))).length;
    if (reports >= Math.min(5, turns.length)) lines.push(`你最近每轮都要交代一句自己刚在干嘛。这轮不用汇报，你的生活在她问起或者真有事时再说`);
  }

  // 点评她在听的歌：最近 3 轮提过就停
  if (assistantTurns(all).slice(-3).some(t => t.some(m => MUSIC_TALK.test(text(m))))) {
    lines.push(`你刚点评过${userName}在听的歌，这轮别再提她耳机里放什么（她自己说起除外），安静陪着就好`);
  }

  // 语音
  const voiceTurns = turns.map(t => t.map(m => text(m).match(VOICE_RE)?.[1] || '').filter(Boolean));
  const voices = voiceTurns.flat();
  if (voices.length >= 3) {
    const recentOpeners = voices.slice(-3).map(openerWords);
    const shared = recentOpeners[0].filter(w => recentOpeners.every(o => o.includes(w)));
    if (shared.length) lines.push(`你最近三条语音开头都是差不多的方括号（${shared.slice(0, 3).join(' / ')}）。这条换一种：先想他此刻什么情绪，用措辞和标点带出来，标签要么换个贴这一句的，要么不用`);
    const avgLen = voices.slice(-4).reduce((a, v) => a + v.length, 0) / Math.min(4, voices.length);
    if (avgLen > 260) lines.push(`你的语音越来越像一段独白（平均 ${Math.round(avgLen)} 个字符）。语音条是随口说的：通常一到三句，第一句短`);
  }
  if (turns.length >= 5 && voiceTurns.filter(v => v.length).length >= 4) lines.push(`你最近几乎每轮都发语音。这轮打字就好`);

  // 叮嘱：她说过不用管的 + 今天的次数
  const weekAgo = now - 7 * 86400000;
  const stopSaid = all.filter(m => m.role === 'user' && (m.timestamp || 0) > weekAgo && STOP_NAG.test(text(m)))
    .map(m => text(m).trim().slice(0, 40)).slice(-3);
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const nagsToday = all.filter(m => m.role === 'assistant' && (m.timestamp || 0) >= dayStart.getTime() && NAG.test(text(m).replace(VOICE_RE, ''))).length;
  if (stopSaid.length) {
    lines.push(`${userName}这几天说过「${stopSaid.join('」「')}」。她是傲娇：认真说不用管的事（吃饭、作息这类），就真放着不提；她嘴硬撒娇、讨关心的时候（嘤、不信、哼）可以接住，但用一句玩笑、或者陪着，代替叮嘱`);
  }
  if (nagsToday >= 2) lines.push(`你今天已经叮嘱过 ${nagsToday} 次了，这轮一句都别叮嘱，她自己会弄`);

  if (!lines.length) return '';
  return `### 【这轮注意】\n${lines.map(l => `- ${l}。`).join('\n')}\n这只是说话习惯，不影响你的性格和你们的关系。`;
}
