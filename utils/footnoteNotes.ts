/**
 * 聊天提示词用：最近两天用户在「页脚」便签墙上贴给角色的纸条。
 * 单独一个文件、不引 ContextBuilder，免得 chatPrompts ↔ context 循环引用。
 */
export function buildRecentNotesBlock(charId: string, userName: string, now = Date.now()): string {
  let cards: any[] = [];
  try { cards = JSON.parse(localStorage.getItem('sully_footnote_v1') || '{}').cards || []; } catch { return ''; }
  const notes = cards.filter(c => c.charId === charId && c.author === 'user' && now - c.createdAt < 2 * 86400000).slice(0, 3);
  if (!notes.length) return '';
  return `### 【${userName || '对方'} 最近在「页脚」便签墙上贴给你的纸条】
${notes.map(n => `- ${n.note}${n.reply ? `（你在下面回了：${n.reply}）` : ''}`).join('\n')}
（想提就自然地提一句，不想提也不必特意说。）`;
}
