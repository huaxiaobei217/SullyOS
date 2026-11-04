/**
 * 聊天提示词用：最近两天用户在「页脚」便签墙上贴给角色的纸条。
 * 单独一个文件、不引 ContextBuilder，免得 chatPrompts ↔ context 循环引用。
 */
const CH: Record<string, string> = { gossip: '历史狗血八卦', sonnet: '十四行诗', patent: '催眠专利附录' };

/** 「页脚」里最近发生的事，作为聊天的背景（不进长期记忆，过一阵自然消失） */
export function buildRecentNotesBlock(charId: string, userName: string, now = Date.now()): string {
  let st: any = {};
  try { st = JSON.parse(localStorage.getItem('sully_footnote_v1') || '{}'); } catch { return ''; }
  const u = userName || '对方';
  const lines: string[] = [];
  const notes = (st.cards || []).filter((c: any) => c.charId === charId && c.author === 'user' && now - c.createdAt < 2 * 86400000).slice(0, 3);
  for (const n of notes) {
    const th = (n.thread || []).map((t: any) => `${t.by === 'user' ? u : '你'}：${t.text}`).join(' / ');
    lines.push(`- ${u}在便签墙上贴给你：「${n.note}」${th ? `（下面：${th}）` : ''}`);
  }
  const radio = (st.radio || []).filter((r: any) => r.charId === charId && now - r.createdAt < 12 * 3600000).slice(0, 2);
  for (const r of radio) lines.push(`- 你给 ${u} 深夜点播过一期「${CH[r.channel] || '电台'}」：《${r.title}》`);
  const qa = (st.qa || []).filter((q: any) => q.charId === charId && now - q.createdAt < 24 * 3600000).slice(0, 2);
  for (const q of qa) lines.push(`- 你们玩快问快答：「${q.question}」${u}答「${q.mine}」，你答「${q.his}」`);
  if (!lines.length) return '';
  return `### 【最近在「页脚」里一起做过的事】
${lines.join('\n')}
（这是你们真的一起做过的小事。想提就自然地提一句，不想提也不必特意说。）`;
}
