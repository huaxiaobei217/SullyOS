/**
 * 说话习惯漂移提醒（个人二改）：模型会照着自己最近的回复学，越写越长、越来越爱叮嘱。
 * 看他最近 30 条文字气泡，真漂了才在这一轮提醒一句；没漂什么都不加。
 *  - 气泡长度：人设要短气泡（3～15 字），最近平均超过 22 字、六成以上超过 15 字 → 提醒拆短
 *  - 管家味：叮嘱 / 催她办事的说法在最近 30 条里出现 4 次以上 → 提醒这轮别催
 * 只在手机聊天里用（见面、电话这些不走这里）。
 */
const NAG = /记得|别忘了|赶紧|快去|先去|去把|早点睡|早点休息|记住|乖乖|按时|多喝水|别熬/;

export function buildStyleDriftBlock(recentAssistantTexts: string[], userName: string): string {
  const list = recentAssistantTexts.map(t => String(t || '').trim())
    .filter(t => t && !/^[<[]/.test(t) && !/^https?:\/\//.test(t)).slice(-30);
  if (list.length < 12) return '';
  const lines: string[] = [];
  const lens = list.map(t => [...t.replace(/\s+/g, '')].length);
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  const long = lens.filter(n => n > 15).length / lens.length;
  if (avg > 22 && long > 0.6) lines.push(`你最近的气泡越写越长（平均 ${Math.round(avg)} 个字）。回到你平时的打字习惯：一条 3～15 个字，一个意思拆成两三条短的发`);
  const nags = list.filter(t => NAG.test(t)).length;
  if (nags >= 4) lines.push(`你最近叮嘱、催${userName}办事有点多了（${nags} 次），像管家。这一轮别催也别叮嘱，她自己会弄`);
  if (!lines.length) return '';
  return `### 【这轮注意】\n${lines.map(l => `- ${l}。`).join('\n')}\n这只是说话习惯，不影响你的性格和你们的关系。`;
}
